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

The Lambda function and the EC2 GPU host must share a VPC so Lambda can reach vLLM
over a private IP. If you don't already have a suitable VPC, create one:

```bash
aws ec2 create-vpc --cidr-block 10.0.0.0/16 --query 'Vpc.VpcId' --output text
# → save as VPC_ID

aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block 10.0.1.0/24 \
  --query 'Subnet.SubnetId' --output text
# → save as SUBNET_ID (this becomes the SubnetId SAM parameter)

aws ec2 create-security-group --group-name coding-agent-sg \
  --description "Coding agent: Lambda <-> EC2 vLLM" --vpc-id $VPC_ID \
  --query 'GroupId' --output text
# → save as SECURITY_GROUP_ID (this becomes the SecurityGroupId SAM parameter)

# Allow the security group to reach itself on vLLM's port (Lambda -> EC2)
aws ec2 authorize-security-group-ingress \
  --group-id $SECURITY_GROUP_ID \
  --protocol tcp --port 8000 \
  --source-group $SECURITY_GROUP_ID
```

You'll also need outbound internet access from this subnet for Cognito JWKS lookups,
Tavily, GitHub, and GitLab API calls — either a NAT Gateway (Step 1a) or, for a
cheaper personal setup, a small NAT instance.

### Step 1a: NAT Gateway (or NAT instance) for outbound internet access

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

## Step 2: Launch the EC2 GPU instance and serve Qwen3-Coder-14B

```bash
aws ec2 run-instances \
  --image-id ami-0abcdef1234567890 \
  --instance-type g4dn.xlarge \
  --key-name your-keypair \
  --subnet-id $SUBNET_ID \
  --security-group-ids $SECURITY_GROUP_ID \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":100,"VolumeType":"gp3"}}]' \
  --query 'Instances[0].InstanceId' --output text
# → EC2_INSTANCE_ID (this becomes the Ec2InstanceId SAM parameter)
```

Use a Deep Learning AMI (Ubuntu, with NVIDIA drivers + CUDA preinstalled) rather than
a bare Ubuntu AMI, to avoid manually installing GPU drivers. Once running, SSH in and
serve the model:

```bash
pip install vllm

vllm serve Qwen/Qwen3-Coder-14B-Instruct-AWQ \
  --quantization awq \
  --gpu-memory-utilization 0.85 \
  --max-model-len 8192 \
  --dtype float16 \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder \
  --host 0.0.0.0 --port 8000
```

Note the instance's **private** IP — that becomes:

```
VLLM_ENDPOINT=http://<private-ip>:8000/v1
```

Notes:
- T4 (Turing, compute capability 7.5) supports AWQ, GPTQ, Marlin, INT8 W8A8, GGUF, and
  bitsandbytes quantization kernels. FP8 is NOT supported on T4.
- `--tool-call-parser qwen3_coder` is mandatory for structured tool calls.
- The security group from Step 1 already permits inbound port 8000 from itself
  (Lambda's ENI shares this security group), so no `0.0.0.0/0` rule is needed.
- The Lambda's own runtime EC2 permissions (`ec2:DescribeInstances`,
  `ec2:StartInstances`) are granted via `template.yaml`'s `ChatFunction` resource, not
  here — you don't need to attach anything extra to this instance's own IAM role for
  the agent's auto-start/stop feature to work.

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
> access is handled entirely by the separate "Connect GitHub" flow in Step 11a instead.

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
credentials (Step 11a), because that App's callback URL requires the CloudFront URL
this very deploy is about to create. Use placeholder values for those two parameters
now; you'll redeploy with real ones in Step 11c.

```bash
sam build --use-container

sam deploy \
  --stack-name coding-agent-stack \
  --capabilities CAPABILITY_IAM \
  --resolve-s3 \
  --parameter-overrides \
    VllmEndpoint=http://<ec2-private-ip>:8000/v1 \
    UserPoolId=$USER_POOL_ID \
    TavilyApiKey=YOUR_TAVILY_API_KEY \
    SubnetId=$SUBNET_ID \
    SecurityGroupId=$SECURITY_GROUP_ID \
    Ec2InstanceId=$EC2_INSTANCE_ID \
    GitHubToken=YOUR_GITHUB_PAT \
    GitLabToken=YOUR_GITLAB_PAT \
    GitHubOAuthClientId=placeholder \
    GitHubOAuthClientSecret=placeholder
```

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
    VllmEndpoint=http://<ec2-private-ip>:8000/v1 \
    UserPoolId=$USER_POOL_ID \
    TavilyApiKey=YOUR_TAVILY_API_KEY \
    SubnetId=$SUBNET_ID \
    SecurityGroupId=$SECURITY_GROUP_ID \
    Ec2InstanceId=$EC2_INSTANCE_ID \
    GitHubToken=YOUR_GITHUB_PAT \
    GitLabToken=YOUR_GITLAB_PAT \
    GitHubOAuthClientId=YOUR_REAL_GITHUB_OAUTH_CLIENT_ID \
    GitHubOAuthClientSecret=YOUR_REAL_GITHUB_OAUTH_CLIENT_SECRET
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
`sam deploy --parameter-overrides` list from Step 11c and redeploy. This creates:

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
| `VLLM_ENDPOINT` | `VLLM_ENDPOINT` | Step 2 |
| `COGNITO_USER_POOL_ID` | `COGNITO_USER_POOL_ID` | Step 4 |
| `TAVILY_API_KEY` | `TAVILY_API_KEY` | Step 7 |
| `VPC_SUBNET_ID` | `VPC_SUBNET_ID` | Step 1 |
| `VPC_SECURITY_GROUP_ID` | `VPC_SECURITY_GROUP_ID` | Step 1 |
| `EC2_INSTANCE_ID` | `EC2_INSTANCE_ID` | Step 2 |
| `GH_TOKEN` | `GITHUB_TOKEN` | Step 5 |
| `GITLAB_TOKEN` | `GITLAB_TOKEN` | Step 5 |
| `GH_OAUTH_CLIENT_ID` | `GITHUB_OAUTH_CLIENT_ID` | Step 11a |
| `GH_OAUTH_CLIENT_SECRET` | `GITHUB_OAUTH_CLIENT_SECRET` | Step 11a |
| `GITLAB_OAUTH_CLIENT_ID` | `GITLAB_OAUTH_CLIENT_ID` | Step 11b |
| `COGNITO_DOMAIN` | `COGNITO_DOMAIN` | Step 4c |
| `COGNITO_CLIENT_ID` | `COGNITO_CLIENT_ID` | Step 4b |
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
4. Send a chat message — confirms Lambda → EC2 auto-start (if stopped) → vLLM → streamed
   response end-to-end.
5. Attach a small file and send it — confirms the file upload path.

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
