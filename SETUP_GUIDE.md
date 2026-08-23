# Step-by-Step Setup Guide

This is the **complete, dependency-ordered** walkthrough for standing up the coding
agent from a blank AWS account to a live, working deployment. Follow the steps in
order, several later steps genuinely cannot be done before earlier ones (e.g. you
cannot register a GitHub OAuth App's callback URL before the front-end has a real
CloudFront URL, which doesn't exist until after the first deploy).

**Prerequisites:** an AWS account with CLI credentials configured, a GitHub account,
a GitLab account, a Google Cloud project, and (optionally) a domain already
registered in Route 53.

---

## Step 1: Networking — VPC, subnet, security groups

The Lambda function and the EC2 GPU host must share a VPC so Lambda can reach the
model server over a private IP. If you don't already have a suitable VPC, create one:

```bash
aws ec2 create-vpc --cidr-block 10.0.0.0/16 --query 'Vpc.VpcId' --output text
# → save as VPC_ID

aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.1.0/24 \
  --query 'Subnet.SubnetId' --output text
# → save as SUBNET_ID (this becomes the SubnetId SAM parameter)

aws ec2 create-security-group --group-name coding-agent-sg \
  --description "Coding agent: Lambda <-> EC2 model server" --vpc-id $VPC_ID \
  --query 'GroupId' --output text
# → save as SECURITY_GROUP_ID (this becomes the SecurityGroupId SAM parameter)

# Allow the security group to reach itself on Ollama's default port (Lambda -> EC2)
aws ec2 authorize-security-group-ingress \
  --group-id $SECURITY_GROUP_ID \
  --protocol tcp --port 11434 \
  --source-group $SECURITY_GROUP_ID
```

You'll also need outbound internet access from this subnet for Cognito JWKS lookups,
Tavily, GitHub, and GitLab API calls — either a NAT Gateway (Step 1.1) or, for a
cheaper personal setup, a small NAT instance.

### Step 1.1: NAT Gateway (or NAT instance) for outbound internet access

```bash
aws ec2 create-internet-gateway --query 'InternetGateway.InternetGatewayId' --output text
# → IGW_ID
aws ec2 attach-internet-gateway --vpc-id $VPC_ID --internet-gateway-id $IGW_ID

aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.2.0/24 \
  --query 'Subnet.SubnetId' --output text
# → PUBLIC_SUBNET_ID (must be a separate, public subnet for the NAT Gateway itself)

aws ec2 allocate-address --domain vpc --query 'AllocationId' --output text
# → EIP_ALLOC_ID

aws ec2 create-nat-gateway --subnet-id $PUBLIC_SUBNET_ID \
  --allocation-id $EIP_ALLOC_ID --query 'NatGateway.NatGatewayId' --output text
# → NAT_GW_ID

# Route the private subnet's default route through the NAT Gateway
aws ec2 create-route-table --vpc-id $VPC_ID --query 'RouteTable.RouteTableId' --output text
# → PRIVATE_RT_ID
aws ec2 create-route --route-table-id $PRIVATE_RT_ID \
  --destination-cidr-block 0.0.0.0/0 --nat-gateway-id $NAT_GW_ID
aws ec2 associate-route-table --subnet-id $SUBNET_ID --route-table-id $PRIVATE_RT_ID
```

Budget for this: a NAT Gateway costs ~$0.045/hour (~$33/month) plus data processing,
running continuously regardless of usage. For a personal project, a small self-managed
NAT instance (`t3.nano`, ~$3-5/month) is a cheaper substitute — trade AWS-managed HA
for lower cost, which is fine for a single-user setup.

---

## Step 2: Launch the EC2 GPU instance and serve Qwen2.5-Coder-14B with Ollama

> **Why not vLLM / why not `Qwen3-Coder-14B-Instruct-AWQ`:** that exact model name
> doesn't exist — Qwen's Coder line only ships as MoE checkpoints (30B-A3B,
> 480B-A35B), never as a dense 14B, so vLLM had nothing valid to load. It also
> wouldn't have fit a T4 either way (MoE checkpoints load every expert's weights into
> VRAM regardless of how few are "active"). We're serving the real,
> officially-published **`qwen2.5-coder:14b`** model via **Ollama** instead — Ollama
> runs on llama.cpp under the hood, manages GGUF quantization for you, and (unlike
> vLLM's Marlin AWQ kernels, which need Ampere or newer) has no dependency on kernel
> features the T4's Turing architecture (compute capability 7.5) lacks.

```bash
aws ec2 run-instances \
  --image-id ami-0abcdef1234567890 \
  --instance-type g4dn.xlarge \
  --key-name your-keypair \
  --subnet-id $SUBNET_ID \
  --security-group-ids $SECURITY_GROUP_ID \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":50,"VolumeType":"gp3"}}]' \
  --query 'Instances[0].InstanceId' --output text
# → EC2_INSTANCE_ID (this becomes the Ec2InstanceId SAM parameter)
```

Use the **Deep Learning Base OSS Nvidia Driver AMI** (Ubuntu) rather than a full
"Deep Learning AMI (Ubuntu) with Conda" — the Conda variant pre-loads several
multi-GB ML framework environments (PyTorch, TensorFlow, etc.) that Ollama has no use
for, and often already uses 30-45GB of root volume before you've installed anything.
The Base OSS variant ships just the NVIDIA driver + CUDA (Ollama bundles everything
else it needs) and typically uses only 15-25GB, comfortably leaving room on a **50GB**
root volume for the OS, Ollama's own binary, and logs. The model itself does **not**
count against this root volume at all — see the NVMe note below.

Once running, SSH in:

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

This installs Ollama and registers it as a systemd service (`ollama.service`) that
starts automatically — but binds to `127.0.0.1:11434` by default, which Lambda can't
reach across the VPC. Expose it on all interfaces:

```bash
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/override.conf <<'EOF'
[Service]
Environment="OLLAMA_HOST=0.0.0.0:11434"
EOF
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

Pull and warm the model (downloads and quantizes-on-fetch automatically — no manual
`--quantization`/`--dtype` flags to pick). This uses Ollama's **default** model
directory (no `OLLAMA_MODELS` override) — for the systemd service that's
`/usr/share/ollama/.ollama/models`, which on a Deep Learning AMI happens to live on
the **NVMe instance store**, not the 50GB root EBS volume, since `g4dn.xlarge` mounts
its 125GB local NVMe SSD there. So this download doesn't compete with the root
volume's 50GB at all:

```bash
ollama pull qwen2.5-coder:14b
```

Sanity-check that it's actually using the GPU (run this, then check `nvidia-smi` in a
second SSH session for GPU utilization):

```bash
ollama run qwen2.5-coder:14b "print('hello world')"
```

> **NVMe instance-store caveat:** whatever directory Ollama's models end up on, if
> it's backed by NVMe instance storage rather than EBS, its contents are wiped
> whenever the instance is **stopped** (not just terminated; a reboot is fine, a
> stop/start cycle is not). This repo's Lambda only ever **starts** a stopped
> instance in `ensure_backend_ready()`, it never stops one — but a cost-saving cron
> job or manual stop would still wipe it, forcing a ~9GB re-pull on the next start and
> adding several minutes to that cold start on top of the usual EC2-boot +
> Ollama-startup wait. Run `df -h $(ollama_default_models_dir)` (or just check where
> `/usr/share/ollama/.ollama` resolves to on your specific AMI) if you want to confirm
> whether you're on NVMe or EBS before relying on this behavior.

Note the instance's **private** IP — that becomes (parameter/env var name kept as-is
for compatibility with the existing SAM parameter and CI/CD secret — it now points at
Ollama's OpenAI-compatible API, not vLLM):

```
VLLM_ENDPOINT=http://<private-ip>:11434/v1
```

Notes:
- The `qwen2.5-coder:14b` tag defaults to a 4-bit (Q4_K_M) GGUF quantization at
  roughly **9GB**, comfortably inside the T4's 16GB VRAM with room for KV cache at a
  reasonable context length. If you want more headroom (e.g. for longer contexts or
  concurrent requests), `ollama pull qwen2.5-coder:7b` (~5GB) is the safer fallback.
- No separate `--tool-call-parser`/`--chat-template` flags are needed — Ollama bakes
  each model's chat template in, and Qwen2.5-Coder supports tool/function calling
  through Ollama's `/v1/chat/completions` `tools` parameter the same way it did
  through vLLM's.
- The security group ingress rule in Step 1 now opens port **11434** (Ollama's
  default), not vLLM's 8000 — Lambda's ENI still reaches it via the same
  self-referencing security group, no other change needed there.
- Handy compatibility bonus: Ollama's root endpoint (`GET http://<ip>:11434/`) returns
  HTTP 200 with the plain-text body `"Ollama is running"`. `lambda_function.py`'s
  `is_vllm_ready()` only checks `resp.status == 200` and never parses the body, so the
  existing health-check logic keeps working with **no backend code changes** — just
  point `VLLM_HEALTH_ENDPOINT` at `http://<private-ip>:11434/` instead of a `/health`
  path.
- The Lambda's own runtime EC2 permissions (`ec2:DescribeInstances`,
  `ec2:StartInstances`) are granted via `template.yaml`'s `ChatFunction` resource, not
  here — you don't need to attach anything extra to this instance's own IAM role for
  the agent's auto-start/stop feature to work.
- **If you'd rather run raw llama.cpp** instead of Ollama (e.g. for finer control over
  quantization or build flags), the same private-IP-and-port pattern applies: build
  `llama.cpp`, download a `qwen2.5-coder-14b-instruct` GGUF from Hugging Face, and run
  `./llama-server -m <path-to-gguf> --host 0.0.0.0 --port 11434`. `llama-server`
  exposes both an OpenAI-compatible `/v1/chat/completions` endpoint and a real
  `/health` endpoint directly analogous to vLLM's, so `VLLM_HEALTH_ENDPOINT` would stay
  on a `/health` suffix in that case rather than Ollama's plain `/`.

---

## Step 2.1: (Optional) Open WebUI — a management dashboard for Ollama

[Open WebUI](https://github.com/open-webui/open-webui) gives you a browser-based
dashboard on top of the Ollama instance from Step 2: browse/pull/delete models, and
run test chats against `qwen2.5-coder:14b` directly, without going through the agent
or `curl`. It's optional and entirely separate from the Lambda→Ollama chat path — the
agent keeps talking to Ollama's `/v1/chat/completions` exactly as before.

Two access paths are documented: **Tailscale** (Step 2.1.2's bind + `/ollama/dashboard`
redirect below — the recommended path if you already run Tailscale on this host and
your client) or **SSM Session Manager port-forwarding** (Step 2.1.3/2.1.4 — works with
no extra software beyond the AWS CLI, but requires a manual tunnel each time and no
browser-address-bar shortcut).

### Step 2.1.1: Install Docker on the EC2 host

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
```

### Step 2.1.2: Run Open WebUI

```bash
docker run -d \
  --name open-webui \
  --restart always \
  --add-host=host.docker.internal:host-gateway \
  -e OLLAMA_BASE_URL=http://host.docker.internal:11434 \
  -p 3000:8080 \
  -v open-webui:/app/backend/data \
  ghcr.io/open-webui/open-webui:main
```

Note `-p 3000:8080` binds to **all interfaces**, not just `localhost`. This is safe
specifically because Tailscale traffic arrives over its own virtual interface
(`tailscale0`), not through the VPC's regular ENI — the security group from Step 1
still blocks anyone reaching port 3000 over the normal VPC/internet path, since there's
no ingress rule for it there. Only devices on the same tailnet, or anything already
inside the VPC, can reach port 3000 at all.

> **If you're not using Tailscale**, bind to `127.0.0.1:3000:8080` instead (localhost
> only) and use the SSM tunnel in Step 2.1.3/2.1.4 to reach it — don't leave port 3000
> open on all interfaces without either Tailscale or an SSM tunnel gatekeeping access.

### Step 2.1.2a: Tailscale — reach the dashboard directly from your browser

If this EC2 host and your client machine are already joined to the same Tailscale
account (tailnet), no tunnel or port-forward is needed — Tailscale gives the instance
a stable, mesh-routable address that your browser can reach directly, without opening
anything to the public internet or even touching the VPC's security group:

```bash
tailscale status
# → note the instance's Tailscale IP (100.x.y.z) or MagicDNS hostname
```

Set that value as the `OllamaDashboardHost` SAM parameter (Steps 8/11.3) and redeploy;
`back-end/lambda_function.py` then serves a `GET /ollama/dashboard` route on the
Lambda Function URL that redirects straight to `http://<tailscale-address>:3000`. This
route intentionally skips Cognito auth — a plain browser navigation can't carry an
`Authorization` header — relying instead on Tailscale's own network-level access
control (only tailnet members can reach the target at all) plus Open WebUI's own login
as a second layer. Leaving `OllamaDashboardHost` blank disables the route (it 404s).

### Step 2.1.3: (No Tailscale) Give the instance permission to accept SSM sessions

Skip this and 2.1.4 if you used Tailscale above. Otherwise: the private subnet from
Step 1 has no direct inbound path (that's the point), so reaching `localhost:3000` on
the instance requires AWS Systems Manager Session Manager instead of a normal SSH
port-forward. Attach an SSM-capable role to the already-running instance:

```bash
aws iam create-role --role-name coding-agent-ec2-ssm-role \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'

aws iam attach-role-policy --role-name coding-agent-ec2-ssm-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore

aws iam create-instance-profile --instance-profile-name coding-agent-ec2-ssm-profile
aws iam add-role-to-instance-profile \
  --instance-profile-name coding-agent-ec2-ssm-profile \
  --role-name coding-agent-ec2-ssm-role

aws ec2 associate-iam-instance-profile \
  --instance-id $EC2_INSTANCE_ID \
  --iam-instance-profile Name=coding-agent-ec2-ssm-profile
```

This doesn't require relaunching the instance or touching `template.yaml` — it's a
separate IAM role attached directly to the EC2 host, unrelated to the Lambda's own
IAM permissions. Most current Deep Learning AMIs ship the SSM Agent preinstalled; if
`aws ssm describe-instance-information` doesn't list your instance a minute or two
after attaching the profile, install it manually (`sudo snap install amazon-ssm-agent
--classic` on Ubuntu) and retry.

### Step 2.1.4: (No Tailscale) Port-forward to it and open the dashboard

```bash
aws ssm start-session \
  --target $EC2_INSTANCE_ID \
  --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["3000"],"localPortNumber":["3000"]}'
```

Leave that running, then open `http://localhost:3000` in your browser. First run asks
you to create a local admin account (stored in the `open-webui` Docker volume on the
instance, unrelated to Cognito/GitHub/GitLab auth) — that's Open WebUI's own account
system, not the coding agent's.

> **If you already have SSH access configured to this host** (e.g. via a bastion or
> VPN into the VPC), a plain `ssh -L 3000:localhost:3000 ...` tunnel works identically
> and you can skip Step 2.1.3 entirely.

---

## Step 3: IAM — OIDC deploy roles for GitHub Actions and GitLab CI

This must exist before either CI pipeline can run `sam deploy`.

### Step 3.1: GitHub Actions

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

Trust policy (`github-trust-policy.json`):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::YOUR_AWS_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike": { "token.actions.githubusercontent.com:sub": "repo:YOUR_GITHUB_ORG/YOUR_REPO_NAME:ref:refs/heads/main" }
    }
  }]
}
```

```bash
aws iam create-role --role-name github-actions-deploy-role \
  --assume-role-policy-document file://github-trust-policy.json

aws iam attach-role-policy --role-name github-actions-deploy-role --policy-arn arn:aws:iam::aws:policy/AWSCloudFormationFullAccess
aws iam attach-role-policy --role-name github-actions-deploy-role --policy-arn arn:aws:iam::aws:policy/AWSLambda_FullAccess
aws iam attach-role-policy --role-name github-actions-deploy-role --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess
aws iam attach-role-policy --role-name github-actions-deploy-role --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess
aws iam attach-role-policy --role-name github-actions-deploy-role --policy-arn arn:aws:iam::aws:policy/CloudFrontFullAccess
aws iam attach-role-policy --role-name github-actions-deploy-role --policy-arn arn:aws:iam::aws:policy/IAMFullAccess
```

If you plan to use the optional custom domain (Step 12), also attach
`AWSCertificateManagerFullAccess` and `AmazonRoute53FullAccess`.

```bash
aws iam get-role --role-name github-actions-deploy-role --query 'Role.Arn' --output text
# → save this as the AWS_DEPLOY_ROLE_ARN GitHub secret (Step 9)
```

### Step 3.2: GitLab CI

```bash
aws iam create-open-id-connect-provider \
  --url https://gitlab.com \
  --client-id-list https://gitlab.com \
  --thumbprint-list $(openssl s_client -servername gitlab.com -showcerts -connect gitlab.com:443 2>/dev/null | openssl x509 -fingerprint -sha1 -noout | sed 's/.*=//;s/://g' | tr 'A-F' 'a-f')
```

Trust policy (`gitlab-trust-policy.json`):

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::YOUR_AWS_ACCOUNT_ID:oidc-provider/gitlab.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "gitlab.com:aud": "https://gitlab.com" },
      "StringLike": { "gitlab.com:sub": "project_path:YOUR_GITLAB_NAMESPACE/YOUR_PROJECT_NAME:ref_type:branch:ref:main" }
    }
  }]
}
```

```bash
aws iam create-role --role-name gitlab-ci-deploy-role \
  --assume-role-policy-document file://gitlab-trust-policy.json

aws iam attach-role-policy --role-name gitlab-ci-deploy-role --policy-arn arn:aws:iam::aws:policy/AWSCloudFormationFullAccess
aws iam attach-role-policy --role-name gitlab-ci-deploy-role --policy-arn arn:aws:iam::aws:policy/AWSLambda_FullAccess
aws iam attach-role-policy --role-name gitlab-ci-deploy-role --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess
aws iam attach-role-policy --role-name gitlab-ci-deploy-role --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess
aws iam attach-role-policy --role-name gitlab-ci-deploy-role --policy-arn arn:aws:iam::aws:policy/CloudFrontFullAccess
aws iam attach-role-policy --role-name gitlab-ci-deploy-role --policy-arn arn:aws:iam::aws:policy/IAMFullAccess
```

Both roles use broad managed policies to get started quickly. **Before production**,
replace them with the least-privilege inline policy in Step 13.

---

## Step 4: Amazon Cognito — user pool, Google sign-in, app client

GitHub is **never** federated through Cognito — see the callout at the end of this
step for why. Only Google + native Cognito accounts are supported identity providers.

```bash
aws cognito-idp create-user-pool \
  --pool-name coding-agent-pool \
  --auto-verified-attributes email
# → USER_POOL_ID
```

### Step 4.1: Register Google as an identity provider

Create the Google OAuth Client first (Google Cloud Console → APIs & Services →
Credentials → Create Credentials → OAuth client ID, application type "Web
application"). Its Authorized redirect URI must be:

```
https://coding-agent-pool.auth.us-east-1.amazoncognito.com/oauth2/idpresponse
```

```bash
aws cognito-idp create-identity-provider \
  --user-pool-id $USER_POOL_ID \
  --provider-name Google \
  --provider-type Google \
  --provider-details '{
    "client_id": "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
    "client_secret": "YOUR_GOOGLE_CLIENT_SECRET",
    "authorize_scopes": "profile email openid"
  }' \
  --attribute-mapping '{"email": "email", "name": "name"}'
```

### Step 4.2: Create the app client

```bash
aws cognito-idp create-user-pool-client \
  --user-pool-id $USER_POOL_ID \
  --client-name coding-agent-client \
  --no-generate-secret \
  --supported-identity-providers COGNITO Google \
  --allowed-o-auth-flows code \
  --allowed-o-auth-scopes openid email profile \
  --allowed-o-auth-flows-user-pool-client \
  --callback-urls '["http://localhost:8765/callback"]' \
  --logout-urls '["http://localhost:8765/logout"]' \
  --query 'UserPoolClient.ClientId' --output text
# → COGNITO_CLIENT_ID
```

The callback/logout URLs use `localhost` placeholders here because the real
front-end URL doesn't exist yet (it's a CloudFront output from Step 8). You'll update
these with `update-user-pool-client` in Step 10.

### Step 4.3: Set up the Hosted UI domain

```bash
aws cognito-idp create-user-pool-domain \
  --domain coding-agent-pool \
  --user-pool-id $USER_POOL_ID
# → COGNITO_DOMAIN = https://coding-agent-pool.auth.us-east-1.amazoncognito.com
```

> **Why GitHub isn't here:** Cognito unconditionally validates any OIDC identity
> provider by fetching `<oidc_issuer>/.well-known/openid-configuration`. GitHub's
> OAuth implementation doesn't expose this endpoint, so `create-identity-provider`
> for GitHub always fails with `InvalidParameterException: Unable to contact
> well-known endpoint` — no combination of parameters fixes this. GitHub repository
> access is handled entirely by the separate "Connect GitHub" flow in Step 11.1 instead.

---

## Step 5: Shared GitHub/GitLab repo-management tokens

These are the tokens `github_push_file`/`gitlab_push_file` use — shared across all
users of the deployed agent, distinct from the per-user OAuth flows in Step 11.

**GitHub**: github.com → Settings → Developer settings → Personal access tokens →
Fine-grained tokens → generate one scoped to your target repositories with Contents
(read/write), Pull requests (read/write), and Issues (read/write).

**GitLab**: gitlab.com → your project → Settings → Access Tokens → generate one with
the `api` scope.

Optionally store both in Secrets Manager:

```bash
aws secretsmanager create-secret --name coding-agent/github-token --secret-string "YOUR_GITHUB_PAT"
aws secretsmanager create-secret --name coding-agent/gitlab-token --secret-string "YOUR_GITLAB_TOKEN"
```

---

## Step 6: DynamoDB tables (optional — SAM creates these automatically in Step 8)

You don't need to run this manually; `template.yaml` declares both tables and
`sam deploy` creates them. It's included here only if you want to inspect the table
shape or pre-create it for some other reason.

```bash
aws dynamodb create-table \
  --table-name pending-actions \
  --attribute-definitions AttributeName=action_id,AttributeType=S \
  --key-schema AttributeName=action_id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

aws dynamodb wait table-exists --table-name pending-actions

aws dynamodb update-time-to-live \
  --table-name pending-actions \
  --time-to-live-specification "Enabled=true,AttributeName=expires_at"
```

`create-table` has no `--time-to-live-specification` flag — TTL is always a separate
`update-time-to-live` call via the CLI (CloudFormation, which `template.yaml` uses,
supports setting it in one shot).

The `user-integrations` table (per-user OAuth tokens, Step 11) needs no manual
creation either — same story, handled by `template.yaml`.

---

## Step 7: Tavily API key

Sign up at [app.tavily.com](https://app.tavily.com) and copy the API key from the
dashboard. This powers the agent's `web_search` tool.

---

## Step 8: First deploy (SAM) — with placeholder GitHub OAuth values

At this point you have everything a first deploy needs *except* the GitHub OAuth App
credentials (Step 11.1), because that App's callback URL requires the CloudFront URL
this very deploy is about to create. Use placeholder values for those two parameters
now; you'll redeploy with real ones in Step 11.3.

```bash
sam build --use-container

sam deploy \
  --stack-name coding-agent-stack \
  --capabilities CAPABILITY_IAM \
  --resolve-s3 \
  --parameter-overrides \
    VllmEndpoint=http://<ec2-private-ip>:11434/v1 \
    UserPoolId=$USER_POOL_ID \
    TavilyApiKey=YOUR_TAVILY_API_KEY \
    SubnetId=$SUBNET_ID \
    SecurityGroupId=$SECURITY_GROUP_ID \
    Ec2InstanceId=$EC2_INSTANCE_ID \
    GitHubToken=YOUR_GITHUB_PAT \
    GitLabToken=YOUR_GITLAB_PAT \
    GitHubOAuthClientId=placeholder \
    GitHubOAuthClientSecret=placeholder \
    OllamaDashboardHost=YOUR_TAILSCALE_IP_OR_HOSTNAME
```

`OllamaDashboardHost` is optional — omit it (or leave the default empty string) if
you're not using the Step 2.1 Open WebUI dashboard yet; the `/ollama/dashboard` route
just 404s until it's set.

The `VllmEndpoint` parameter name is unchanged from the vLLM setup for compatibility
with the CI/CD secret names in Step 13 — it now points at Ollama's port (`11434`)
instead of vLLM's (`8000`); see Step 2's callout.

This creates: the `ChatFunction` Lambda + Function URL, both DynamoDB tables, and the
front-end's `FrontendBucket` + `FrontendOriginAccessControl` + `FrontendDistribution`
+ `FrontendBucketPolicy` (S3 fully private, served only via CloudFront with HTTPS
enforced).

---

## Step 9: Retrieve stack outputs

```bash
aws cloudformation describe-stacks --stack-name coding-agent-stack \
  --query "Stacks[0].Outputs" --output table
```

You need three of these outputs for the next steps:

- `FunctionUrl` — the Lambda chat endpoint
- `FrontendUrl` — the CloudFront (or custom domain) URL, always `https://`
- `FrontendBucketName` / `FrontendDistributionId` — for manual front-end syncs if needed

---

## Step 10: Update the Cognito app client with the real front-end URL

```bash
aws cognito-idp update-user-pool-client \
  --user-pool-id $USER_POOL_ID \
  --client-id $COGNITO_CLIENT_ID \
  --supported-identity-providers COGNITO Google \
  --allowed-o-auth-flows code \
  --allowed-o-auth-scopes openid email profile \
  --allowed-o-auth-flows-user-pool-client \
  --callback-urls '["https://<FrontendUrl-from-step-9>/callback","http://localhost:8765/callback"]' \
  --logout-urls '["https://<FrontendUrl-from-step-9>/logout","http://localhost:8765/logout"]'
```

---

## Step 11: Register the per-user "Connect GitHub"/"Connect GitLab" OAuth integrations

These are separate from Cognito sign-in (Step 4) and let an already-signed-in user
additionally authorize the agent against their own GitHub/GitLab account.

### Step 11.1: GitHub OAuth App

1. **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**.
2. **Authorization callback URL**: `<FrontendUrl-from-step-9>/callback/github`.
3. Copy the **Client ID** and **Client Secret**.

### Step 11.2: GitLab OAuth application

1. **GitLab → User Settings → Applications**.
2. **Redirect URI**: `<FrontendUrl-from-step-9>/callback/gitlab`.
3. **Scopes**: `api`, `read_repository`, `write_repository`. Leave "Confidential"
   **unchecked** (public/native client — GitLab supports full PKCE with no secret).
4. Copy the **Application ID** (no secret to store).

### Step 11.3: Redeploy with the real GitHub OAuth credentials

```bash
sam deploy \
  --stack-name coding-agent-stack \
  --capabilities CAPABILITY_IAM \
  --resolve-s3 \
  --parameter-overrides \
    VllmEndpoint=http://<ec2-private-ip>:11434/v1 \
    UserPoolId=$USER_POOL_ID \
    TavilyApiKey=YOUR_TAVILY_API_KEY \
    SubnetId=$SUBNET_ID \
    SecurityGroupId=$SECURITY_GROUP_ID \
    Ec2InstanceId=$EC2_INSTANCE_ID \
    GitHubToken=YOUR_GITHUB_PAT \
    GitLabToken=YOUR_GITLAB_PAT \
    GitHubOAuthClientId=YOUR_REAL_GITHUB_OAUTH_CLIENT_ID \
    GitHubOAuthClientSecret=YOUR_REAL_GITHUB_OAUTH_CLIENT_SECRET \
    OllamaDashboardHost=YOUR_TAILSCALE_IP_OR_HOSTNAME
```

The GitLab Application ID doesn't go into this SAM deploy at all — it only needs to
reach `front-end/config.js` (Step 14), since GitLab's flow is entirely client-side.

---

## Step 12: (Optional) Custom domain via an existing Route 53 hosted zone

Skip this step entirely if you're fine with the default `*.cloudfront.net` address.

```bash
aws route53 list-hosted-zones-by-name --dns-name yourdomain.com \
  --query "HostedZones[0].Id" --output text
# → strip the "/hostedzone/" prefix → HOSTED_ZONE_ID
```

Add `DomainName=agent.yourdomain.com` and `HostedZoneId=$HOSTED_ZONE_ID` to the
`sam deploy --parameter-overrides` list from Step 11.3 and redeploy. This creates:

- `FrontendCertificate` — an ACM cert, DNS-validated automatically against your
  hosted zone (CloudFormation writes the validation record itself — no manual steps).
- `FrontendDistribution.Aliases`/`ViewerCertificate` — the distribution accepts the
  custom domain.
- `FrontendDnsRecord` — a Route 53 alias `A` record pointing your domain at
  CloudFront.

HTTPS is enforced everywhere (`ViewerProtocolPolicy: redirect-to-https`) regardless of
whether you use a custom domain — there is no HTTP-only mode. If you add a custom
domain after already registering the OAuth callback URLs in Steps 10/11, update those
callback URLs to the new domain and redeploy.

---

## Step 13: CI/CD secrets — GitHub Actions & GitLab CI

Set these so future `git push` to `main` auto-deploys via `.github/workflows/deploy.yml`
/ `.gitlab-ci.yml`.

GitHub rejects secret names starting with `GITHUB_` (reserved for its own
auto-generated token), so a few names differ between the two platforms:

| GitHub secret | GitLab CI variable | Value (from which step) |
|---|---|---|
| `AWS_DEPLOY_ROLE_ARN` | `AWS_DEPLOY_ROLE_ARN` | Step 3 role ARN |
| `VLLM_ENDPOINT` | `VLLM_ENDPOINT` | Step 2 — now Ollama's `:11434/v1`, name kept for compatibility |
| `COGNITO_USER_POOL_ID` | `COGNITO_USER_POOL_ID` | Step 4 |
| `TAVILY_API_KEY` | `TAVILY_API_KEY` | Step 7 |
| `VPC_SUBNET_ID` | `VPC_SUBNET_ID` | Step 1 |
| `VPC_SECURITY_GROUP_ID` | `VPC_SECURITY_GROUP_ID` | Step 1 |
| `EC2_INSTANCE_ID` | `EC2_INSTANCE_ID` | Step 2 |
| `GH_TOKEN` | `GITHUB_TOKEN` | Step 5 |
| `GITLAB_TOKEN` | `GITLAB_TOKEN` | Step 5 |
| `GH_OAUTH_CLIENT_ID` | `GITHUB_OAUTH_CLIENT_ID` | Step 11.1 |
| `GH_OAUTH_CLIENT_SECRET` | `GITHUB_OAUTH_CLIENT_SECRET` | Step 11.1 |
| `GITLAB_OAUTH_CLIENT_ID` | `GITLAB_OAUTH_CLIENT_ID` | Step 11.2 |
| `COGNITO_DOMAIN` | `COGNITO_DOMAIN` | Step 4.3 |
| `COGNITO_CLIENT_ID` | `COGNITO_CLIENT_ID` | Step 4.2 |
| `OLLAMA_DASHBOARD_HOST` (optional) | `OLLAMA_DASHBOARD_HOST` (optional) | Step 2.1.2a |
| `FRONTEND_DOMAIN_NAME` (optional) | `FRONTEND_DOMAIN_NAME` (optional) | Step 12 |
| `FRONTEND_HOSTED_ZONE_ID` (optional) | `FRONTEND_HOSTED_ZONE_ID` (optional) | Step 12 |

`FRONTEND_BUCKET`/`CLOUDFRONT_DISTRIBUTION_ID` are **not** secrets — CI resolves both
dynamically from stack outputs every deploy. Mark every secret above masked/protected.

---

## Step 14: Push to `main` and verify CI/CD

```bash
git push origin main
```

Watch the pipeline: `test` → `deploy` (SAM stack) → `deploy-frontend` (injects
`config.js` placeholders and syncs to S3 + invalidates CloudFront). `deploy-frontend`
depends on `deploy` succeeding first, since it reads that job's stack outputs.

---

## Step 15: Smoke test

1. Open `FrontendUrl` from Step 9 in a browser — confirm HTTPS, no certificate warning.
2. **Sign in with Google** — confirms Cognito + PKCE flow.
3. **Connect GitHub** and **Connect GitLab** from the header — confirms both OAuth
   integrations independently of Cognito.
4. Send a chat message — confirms Lambda → EC2 auto-start (if stopped) → Ollama →
   streamed response end-to-end.
5. Attach a small file and send it — confirms the file upload path.
6. If you set `OllamaDashboardHost`, visit `<FunctionUrl>/ollama/dashboard` — confirms
   it redirects to Open WebUI over Tailscale.

---

## Step 16: (Optional) Least-privilege IAM policy for the deploy role

Once everything above works end-to-end, replace the broad managed policies from
Step 3 with a scoped inline policy before treating this as production-ready.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFormationStackManagement",
      "Effect": "Allow",
      "Action": [
        "cloudformation:CreateStack", "cloudformation:UpdateStack", "cloudformation:DeleteStack",
        "cloudformation:DescribeStacks", "cloudformation:DescribeStackEvents",
        "cloudformation:DescribeStackResource", "cloudformation:DescribeStackResources",
        "cloudformation:GetTemplate", "cloudformation:ListStackResources",
        "cloudformation:CreateChangeSet", "cloudformation:DescribeChangeSet",
        "cloudformation:ExecuteChangeSet", "cloudformation:DeleteChangeSet",
        "cloudformation:ValidateTemplate"
      ],
      "Resource": "arn:aws:cloudformation:<REGION>:<ACCOUNT_ID>:stack/coding-agent-stack/*"
    },
    {
      "Sid": "SamArtifactsAndFrontendBucket",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket", "s3:GetBucketLocation", "s3:GetBucketPolicy", "s3:PutBucketPolicy",
        "s3:PutBucketPublicAccessBlock", "s3:PutEncryptionConfiguration",
        "s3:ListBucket", "s3:GetObject", "s3:PutObject", "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::aws-sam-cli-managed-*", "arn:aws:s3:::aws-sam-cli-managed-*/*",
        "arn:aws:s3:::coding-agent-frontend-*", "arn:aws:s3:::coding-agent-frontend-*/*"
      ]
    },
    {
      "Sid": "LambdaFunctionAndUrl",
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration",
        "lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:DeleteFunction",
        "lambda:TagResource", "lambda:UntagResource",
        "lambda:CreateFunctionUrlConfig", "lambda:UpdateFunctionUrlConfig",
        "lambda:GetFunctionUrlConfig", "lambda:DeleteFunctionUrlConfig",
        "lambda:AddPermission", "lambda:RemovePermission", "lambda:GetPolicy"
      ],
      "Resource": "arn:aws:lambda:<REGION>:<ACCOUNT_ID>:function:perplexity-clone-chat"
    },
    {
      "Sid": "DynamoDbTables",
      "Effect": "Allow",
      "Action": [
        "dynamodb:CreateTable", "dynamodb:DeleteTable", "dynamodb:DescribeTable",
        "dynamodb:UpdateTable", "dynamodb:UpdateTimeToLive",
        "dynamodb:TagResource", "dynamodb:UntagResource"
      ],
      "Resource": [
        "arn:aws:dynamodb:<REGION>:<ACCOUNT_ID>:table/pending-actions",
        "arn:aws:dynamodb:<REGION>:<ACCOUNT_ID>:table/user-integrations"
      ]
    },
    {
      "Sid": "CloudFrontDistributionAndOac",
      "Effect": "Allow",
      "Action": [
        "cloudfront:CreateDistribution", "cloudfront:UpdateDistribution", "cloudfront:DeleteDistribution",
        "cloudfront:GetDistribution", "cloudfront:GetDistributionConfig",
        "cloudfront:TagResource", "cloudfront:UntagResource",
        "cloudfront:CreateOriginAccessControl", "cloudfront:GetOriginAccessControl",
        "cloudfront:UpdateOriginAccessControl", "cloudfront:DeleteOriginAccessControl",
        "cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AcmCertificateForCustomDomain",
      "Effect": "Allow",
      "Action": [
        "acm:RequestCertificate", "acm:DescribeCertificate", "acm:DeleteCertificate",
        "acm:AddTagsToCertificate", "acm:ListTagsForCertificate"
      ],
      "Resource": "*"
    },
    {
      "Sid": "Route53AliasRecordForCustomDomain",
      "Effect": "Allow",
      "Action": [
        "route53:ChangeResourceRecordSets", "route53:GetHostedZone",
        "route53:ListResourceRecordSets", "route53:GetChange"
      ],
      "Resource": ["arn:aws:route53:::hostedzone/*", "arn:aws:route53:::change/*"]
    },
    {
      "Sid": "LambdaExecutionRoleManagement",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:TagRole", "iam:UntagRole",
        "iam:AttachRolePolicy", "iam:DetachRolePolicy",
        "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy"
      ],
      "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/coding-agent-stack-*"
    },
    {
      "Sid": "PassLambdaExecutionRoleToLambdaOnly",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/coding-agent-stack-*",
      "Condition": { "StringEquals": { "iam:PassedToService": "lambda.amazonaws.com" } }
    }
  ]
}
```

```bash
aws iam put-role-policy --role-name github-actions-deploy-role \
  --policy-name coding-agent-deploy-least-privilege \
  --policy-document file://deploy-role-least-privilege.json
# then detach the managed policies from Step 3 once verified working
```

Repeat for `gitlab-ci-deploy-role`. Key protections in this policy: every action is
scoped to this stack's specific resources (no `s3:*`/`iam:*` on `*`), and
`iam:PassRole` is restricted with `iam:PassedToService: lambda.amazonaws.com` so the
deploy role can't be tricked into handing a privileged role to an unrelated service.

---

## Step 17: (Optional) CLI setup

```bash
pip install -r requirements.txt
export GITHUB_TOKEN=your_github_pat
export GITLAB_TOKEN=your_gitlab_token
python cli_agent.py login
python cli_agent.py "Open a PR on my-org/my-repo adding a fix for the divide-by-zero bug"
python cli_agent.py logout
```

Tokens are stored via the OS keyring, never written to plaintext files.

---

*Cross-reference: `config_guide.md` is a short index into this document. The
repo-management tools reference table and the security/production checklists live
there, since they're not setup steps.*
