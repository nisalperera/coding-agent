# AWS Configuration Guide [FINAL]

Complete setup steps for deploying the Qwen3-Coder-14B serving stack: vLLM on a T4 EC2
instance, an authenticated Lambda-based web app, and a CLI coding agent, following
OWASP LLM Top 10 (2026), OWASP API Security Top 10, and the Twelve-Factor App methodology.
Includes GitHub/GitLab repo-management tools (branches, commits, PRs/MRs, issues via REST APIs).

---

## 1. Serve Qwen3-Coder 14B on the T4 EC2 instance

```bash
pip install vllm

vllm serve Qwen/Qwen3-Coder-14B-Instruct-AWQ \
  --quantization awq \
  --gpu-memory-utilization 0.85 \
  --max-model-len 8192 \
  --dtype float16 \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder
```

Notes:
- T4 (Turing, compute capability 7.5) supports AWQ, GPTQ, Marlin, INT8 W8A8, GGUF,
  and bitsandbytes quantization kernels. FP8 is NOT supported on T4.
- `--tool-call-parser qwen3_coder` is mandatory for structured tool calls.
- Confirm the security group attached to this EC2 instance allows inbound traffic on
  port 8000 from the Lambda function's security group only (not `0.0.0.0/0`).

---

## 2. Create the Cognito User Pool

```bash
aws cognito-idp create-user-pool \
  --pool-name coding-agent-pool \
  --auto-verified-attributes email
```

### 2.1 Register Google as an identity provider

```bash
aws cognito-idp create-identity-provider \
  --user-pool-id us-east-1_xxxxxxx \
  --provider-name Google \
  --provider-type Google \
  --provider-details '{
    "client_id": "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
    "client_secret": "YOUR_GOOGLE_CLIENT_SECRET",
    "authorize_scopes": "profile email openid"
  }' \
  --attribute-mapping '{"email": "email", "name": "name"}'
```

### 2.2 Register GitHub as an OIDC identity provider

```bash
aws cognito-idp create-identity-provider \
  --user-pool-id us-east-1_xxxxxxx \
  --provider-name GitHub \
  --provider-type OIDC \
  --provider-details '{
    "client_id": "YOUR_GITHUB_CLIENT_ID",
    "client_secret": "YOUR_GITHUB_CLIENT_SECRET",
    "authorize_scopes": "openid user:email",
    "oidc_issuer": "https://github.com",
    "authorize_url": "https://github.com/login/oauth/authorize",
    "token_url": "https://github.com/login/oauth/access_token",
    "attributes_url": "https://api.github.com/user"
  }' \
  --attribute-mapping '{"email": "email", "username": "login"}'
```

Note: GitHub's OAuth implementation does not fully comply with OIDC discovery. Test early.

> This GitHub identity provider is only used to let a user **sign in to the coding
> agent itself** via Cognito Hosted UI. It is separate from the per-user "Connect
> GitHub" repository-authorization feature covered in Section 16 — that flow uses its
> own, independent GitHub OAuth App and never touches Cognito.

### 2.3 Create the app client (public client, PKCE-ready)

```bash
aws cognito-idp create-user-pool-client \
  --user-pool-id us-east-1_xxxxxxx \
  --client-name coding-agent-client \
  --no-generate-secret \
  --supported-identity-providers COGNITO Google GitHub \
  --allowed-o-auth-flows code \
  --allowed-o-auth-scopes openid email profile \
  --allowed-o-auth-flows-user-pool-client \
  --callback-urls '["https://yourapp.com/callback","http://localhost:8765/callback"]' \
  --logout-urls '["https://yourapp.com/logout","http://localhost:8765/logout"]'
```

### 2.4 Set up the Cognito Hosted UI domain

```bash
aws cognito-idp create-user-pool-domain \
  --domain coding-agent-pool \
  --user-pool-id us-east-1_xxxxxxx
```

---

## 3. Create the DynamoDB table for human-in-the-loop pending actions

```bash
aws dynamodb create-table \
  --table-name pending-actions \
  --attribute-definitions AttributeName=action_id,AttributeType=S \
  --key-schema AttributeName=action_id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --time-to-live-specification "Enabled=true, AttributeName=expires_at"
```

---

## 4. GitHub / GitLab repo-management tokens

The agent can create branches, commit files, open pull/merge requests, and create issues
via REST API endpoints only (never shell `git`/`gh`/`glab` commands). It cannot create or
delete repositories — that capability is intentionally excluded.

### 4.1 GitHub personal access token

Create a fine-grained PAT scoped to the specific repositories the agent should touch, with:
- Contents: Read and write (branches and file commits)
- Pull requests: Read and write
- Issues: Read and write

### 4.2 GitLab personal/project access token

Create a project access token with the `api` scope, scoped to specific projects.

### 4.3 Store both as secrets

```bash
aws secretsmanager create-secret \
  --name coding-agent/github-token --secret-string "YOUR_GITHUB_PAT"

aws secretsmanager create-secret \
  --name coding-agent/gitlab-token --secret-string "YOUR_GITLAB_TOKEN"
```

Reference via `{{resolve:secretsmanager:...}}` in `template.yaml` and pass as
`GitHubToken` / `GitLabToken` parameters at deploy time.

> These are the **shared, service-level** tokens used by the existing `github_push_file`
> / `gitlab_push_file` tools. They are independent of the per-user "Connect GitHub" /
> "Connect GitLab" OAuth flow described in Sections 16–17, which lets individual signed-in
> users additionally authorize the agent against their own accounts.

---

## 5. Deploy the Lambda function (SAM)

```bash
sam build
sam deploy --guided
```

Prompted for: `VllmEndpoint`, `UserPoolId`, `TavilyApiKey`, `SubnetId`, `SecurityGroupId`,
`Ec2InstanceId`, `GitHubToken`, `GitLabToken`, `GitHubOAuthClientId`, `GitHubOAuthClientSecret`
(see Section 16). This same `sam deploy` now also provisions the front-end's S3 bucket and
CloudFront distribution (Section 15) — there is nothing left to create manually for hosting.
The Lambda Function URL is never hand-edited into `index.html`; it is injected automatically
into `front-end/config.js` by the CI/CD front-end deploy job.

---

## 6. Networking checklist (Lambda to EC2 over VPC)

- [ ] Lambda `VpcConfig` points to the same VPC as the T4 instance.
- [ ] Lambda security group allowed as inbound source on EC2 security group, port 8000.
- [ ] NAT Gateway or VPC endpoints exist for Cognito JWKS, DynamoDB, EC2 API, and outbound
      HTTPS access to api.github.com / gitlab.com.

---

## 7. Rate limiting and quotas (OWASP API Security)

```bash
aws dynamodb create-table \
  --table-name rate-limits \
  --attribute-definitions AttributeName=user_id,AttributeType=S \
  --key-schema AttributeName=user_id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

Replace the in-memory `check_rate_limit` function with reads/writes against this table.

---

## 8. CLI setup

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

## 9. Repo-management tools reference

| Tool | Platform | Endpoint used | Risky (needs approval)? |
|---|---|---|---|
| `github_create_branch` | GitHub | `POST /repos/{owner}/{repo}/git/refs` | Yes |
| `github_push_file` | GitHub | `PUT /repos/{owner}/{repo}/contents/{path}` | Yes |
| `github_open_pull_request` | GitHub | `POST /repos/{owner}/{repo}/pulls` | Yes |
| `github_create_issue` | GitHub | `POST /repos/{owner}/{repo}/issues` | Yes |
| `gitlab_create_branch` | GitLab | `POST /projects/:id/repository/branches` | Yes |
| `gitlab_push_file` | GitLab | `POST or PUT /projects/:id/repository/files/:path` | Yes |
| `gitlab_open_merge_request` | GitLab | `POST /projects/:id/merge_requests` | Yes |
| `gitlab_create_issue` | GitLab | `POST /projects/:id/issues` | Yes |

All eight tools are treated as risky and routed through the same human-in-the-loop
confirmation flow as `write_file`/`run_shell`. Repository creation and deletion are not
implemented by design.

---

## 10. Security and standards checklist applied

- [x] OAuth 2.0 Authorization Code + PKCE
- [x] Cognito JWT verification on every Lambda request
- [x] Per-user rate limiting (OWASP API Security)
- [x] Object-level authorization via `owns_conversation()` (OWASP API Security — BOLA)
- [x] Human-in-the-loop approval for all mutating tools, including repo-management tools
      (OWASP LLM Top 10 — Excessive Agency)
- [x] Structured JSON logging with trace IDs
- [x] All config/tokens via environment variables / Secrets Manager
- [x] Lambda response streaming for real-time token output
- [x] EC2 auto-start with bounded 2-minute startup budget and progress/retry UX
- [x] Repo-management tools use REST API endpoints only, never shell git/gh/glab commands
- [x] Per-user GitHub/GitLab OAuth tokens stored server-side in DynamoDB, never in the browser
      for GitHub (client secret never leaves the Lambda); GitLab uses browser-side PKCE with
      no client secret, appropriate for a public client
- [x] Front-end S3 bucket is fully private (all four Public Access Block settings enabled);
      served only via CloudFront using Origin Access Control (OAC), never a public bucket policy

---

## 11. Known gaps to close before production

- GitHub OIDC compliance with Cognito needs manual verification.
- In-memory rate limiting must move to DynamoDB for multi-instance correctness.
- GitHub/GitLab tokens currently use broad PAT scopes; narrow to fine-grained,
  repo-specific tokens before production use.
- Add OpenTelemetry exporter configuration for full distributed tracing.
- Per-user GitHub OAuth tokens (Section 16) currently have no refresh/expiry handling and
  no scoped revocation endpoint exposed to the user beyond clearing local browser storage.
- CloudFront currently serves its default `*.cloudfront.net` domain with the default
  certificate; add a custom domain + ACM certificate before production.

---

## 12. GitHub Actions OIDC setup (no static AWS credentials)

### 12.1 Create the OIDC identity provider in AWS

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

### 12.2 Trust policy (save as `github-trust-policy.json`)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::YOUR_AWS_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
        "StringLike": { "token.actions.githubusercontent.com:sub": "repo:YOUR_GITHUB_ORG/YOUR_REPO_NAME:ref:refs/heads/main" }
      }
    }
  ]
}
```

### 12.3 Create the IAM role and attach deploy permissions

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

`CloudFrontFullAccess` is required so the `deploy` job can create/update the
`FrontendDistribution` and the `deploy-frontend` job can call
`cloudfront create-invalidation` (Section 15). Replace these broad policies with a
least-privilege custom policy before production.

### 12.4 Get the role ARN and add it to GitHub Secrets

```bash
aws iam get-role --role-name github-actions-deploy-role --query 'Role.Arn' --output text
```

Add as `AWS_DEPLOY_ROLE_ARN`, plus: `VLLM_ENDPOINT`, `COGNITO_USER_POOL_ID`,
`TAVILY_API_KEY`, `VPC_SUBNET_ID`, `VPC_SECURITY_GROUP_ID`, `EC2_INSTANCE_ID`,
`GITHUB_TOKEN`, `GITLAB_TOKEN`, and the additional front-end/OAuth secrets listed in
Section 18.

---

## 13. GitLab CI OIDC setup (no static AWS credentials)

### 13.1 Create the OIDC identity provider in AWS

```bash
aws iam create-open-id-connect-provider \
  --url https://gitlab.com \
  --client-id-list https://gitlab.com \
  --thumbprint-list $(openssl s_client -servername gitlab.com -showcerts -connect gitlab.com:443 2>/dev/null | openssl x509 -fingerprint -sha1 -noout | sed 's/.*=//;s/://g' | tr 'A-F' 'a-f')
```

### 13.2 Trust policy (save as `gitlab-trust-policy.json`)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "Federated": "arn:aws:iam::YOUR_AWS_ACCOUNT_ID:oidc-provider/gitlab.com" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": { "gitlab.com:aud": "https://gitlab.com" },
        "StringLike": { "gitlab.com:sub": "project_path:YOUR_GITLAB_NAMESPACE/YOUR_PROJECT_NAME:ref_type:branch:ref:main" }
      }
    }
  ]
}
```

### 13.3 Create the IAM role and attach deploy permissions

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

### 13.4 `.gitlab-ci.yml` OIDC deploy job

Already implemented in the accompanying `.gitlab-ci.yml`, using `id_tokens` and
`sts assume-role-with-web-identity`. This same pattern is reused by the `deploy-frontend`
job (Section 15) with its own `role-session-name` for auditability.

### 13.5 Required GitLab CI/CD variables

`AWS_DEPLOY_ROLE_ARN`, `VLLM_ENDPOINT`, `COGNITO_USER_POOL_ID`, `TAVILY_API_KEY`,
`VPC_SUBNET_ID`, `VPC_SECURITY_GROUP_ID`, `EC2_INSTANCE_ID`, `GITHUB_TOKEN`,
`GITLAB_TOKEN` — mark as masked/protected. See Section 18 for the additional
front-end/OAuth variables.

---

## 14. CI/CD security checklist

- [ ] GitHub OIDC trust policy scoped to `refs/heads/main` only
- [ ] GitLab OIDC trust policy scoped to `ref_type:branch:ref:main` only
- [ ] No static AWS access keys stored in either GitHub Secrets or GitLab CI/CD Variables
- [ ] Deploy role permissions narrowed to least-privilege before production
- [ ] Test stage (lint + pytest) must pass before deploy stage runs
- [ ] Sensitive parameters (including GITHUB_TOKEN/GITLAB_TOKEN and the new
      GITHUB_OAUTH_CLIENT_SECRET) marked as masked/protected
- [ ] `deploy-frontend` runs only after `deploy` succeeds (`needs: deploy`), since it reads
      the S3 bucket name and CloudFront distribution ID from that stack's outputs

---

## 15. Front-end deployment (S3 + CloudFront, defined in template.yaml)

`front-end/` contains three static files with no build step:

- `index.html` — markup only.
- `app.js` — all application logic (Cognito PKCE login, GitHub/GitLab "Connect" flows,
  file upload, chat). Static and cacheable; never contains secrets.
- `config.js` — a small `window.APP_CONFIG` object holding placeholder tokens
  (`__LAMBDA_FUNCTION_URL__`, `__COGNITO_DOMAIN__`, `__COGNITO_CLIENT_ID__`,
  `__GITHUB_OAUTH_CLIENT_ID__`, `__GITLAB_OAUTH_CLIENT_ID__`) that CI substitutes with
  real values at deploy time via `sed`.

Hosting infrastructure is now IaC-managed in `template.yaml`, so nothing needs to be
created by hand:

- `FrontendBucket` — a fully private S3 bucket (all four Public Access Block settings
  enabled, SSE-S3 encryption). It is never addressed directly by browsers.
- `FrontendOriginAccessControl` + `FrontendBucketPolicy` — CloudFront reaches the bucket
  using an Origin Access Control (OAC) signed request; the bucket policy only trusts the
  specific `FrontendDistribution` ARN.
- `FrontendDistribution` — a CloudFront distribution with `DefaultRootObject: index.html`
  and `CustomErrorResponses` mapping both 403 and 404 back to `/index.html` with a 200
  status, so client-side routes like `/callback`, `/callback/github`, and
  `/callback/gitlab` resolve to the single-page app instead of an S3 error page.

`sam deploy` (Section 5) creates/updates all of the above automatically. The stack then
exposes three outputs consumed by CI:

- `FrontendBucketName`
- `FrontendDistributionId`
- `FrontendUrl` (the `https://<distribution>.cloudfront.net` address to share with users)

Both `.github/workflows/deploy.yml` and `.gitlab-ci.yml` run a `deploy-frontend` job
(after `deploy` succeeds) that:
1. Reads `FrontendBucketName`/`FrontendDistributionId` from the stack outputs above.
2. Substitutes all five `config.js` placeholders using CI secrets/variables.
3. Runs `aws s3 sync front-end/ s3://$BUCKET_NAME/ --delete`.
4. Runs `aws cloudfront create-invalidation --distribution-id $DISTRIBUTION_ID --paths "/*"`.

There is no `FRONTEND_BUCKET` or `CLOUDFRONT_DISTRIBUTION_ID` secret to manage anymore —
both are resolved dynamically from the stack at deploy time.

---

## 16. GitHub OAuth App setup (per-user "Connect GitHub")

This is separate from the Cognito GitHub identity provider in Section 2.2. It lets an
already-signed-in user additionally authorize the agent to read/write their own GitHub
repositories, independent of the shared `GitHubToken` PAT in Section 4.

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Set **Authorization callback URL** to `https://<your-cloudfront-domain>/callback/github`
   (use the `FrontendUrl` stack output from Section 15, or your custom domain).
3. Request scopes `repo` and `read:user` (set at authorize-time by the front-end, not
   here).
4. Copy the generated **Client ID** and **Client Secret**.
5. The `UserIntegrationsTable` DynamoDB table that stores per-user tokens is already
   declared in `template.yaml` and created automatically by `sam deploy` — no manual
   `aws dynamodb create-table` step is needed.
6. Pass the client ID/secret as SAM parameters:

```bash
sam deploy --parameter-overrides \
  ... \
  GitHubOAuthClientId=YOUR_GITHUB_OAUTH_CLIENT_ID \
  GitHubOAuthClientSecret=YOUR_GITHUB_OAUTH_CLIENT_SECRET
```

The code-for-token exchange happens server-side in `back-end/github_oauth.py`
(`handle_github_oauth_callback`), invoked from `lambda_function.py` via the
`{"action": "github_oauth_callback"}` request — the client secret never reaches the
browser.

---

## 17. GitLab OAuth application setup (per-user "Connect GitLab")

1. Go to **GitLab → User Settings → Applications**.
2. Set **Redirect URI** to `https://<your-cloudfront-domain>/callback/gitlab`.
3. Under **Scopes**, select `api`, `read_repository`, and `write_repository`.
4. Leave "Confidential" **unchecked** — this must be a public/native client so the
   front-end can complete the full Authorization Code + PKCE exchange directly against
   `https://gitlab.com/oauth/token` without a client secret.
5. Copy the generated **Application ID** (there is no secret to store).
6. Add it to your CI secrets as `GITLAB_OAUTH_CLIENT_ID` — it only needs to reach
   `front-end/config.js` (Section 15); the back-end Lambda does not need it.

---

## 18. Consolidated secrets / variables reference

| Name | Used by | Notes |
|---|---|---|
| `AWS_DEPLOY_ROLE_ARN` | GitHub Actions + GitLab CI | OIDC deploy role, no static keys |
| `VLLM_ENDPOINT` | `deploy` job (SAM param) | |
| `COGNITO_USER_POOL_ID` | `deploy` job (SAM param `UserPoolId`) | |
| `TAVILY_API_KEY` | `deploy` job (SAM param) | |
| `VPC_SUBNET_ID` / `VPC_SECURITY_GROUP_ID` | `deploy` job (SAM params) | |
| `EC2_INSTANCE_ID` | `deploy` job (SAM param) | |
| `GITHUB_TOKEN` / `GITLAB_TOKEN` | `deploy` job (SAM params) | Shared service-level PATs, Section 4 |
| `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` | `deploy` job (SAM params) + `deploy-frontend` job | Per-user "Connect GitHub", Section 16 |
| `GITLAB_OAUTH_CLIENT_ID` | `deploy-frontend` job only | Per-user "Connect GitLab", Section 17 (no secret needed) |
| `COGNITO_DOMAIN` / `COGNITO_CLIENT_ID` | `deploy-frontend` job | Cognito Hosted UI, Section 2 |

`FRONTEND_BUCKET` and `CLOUDFRONT_DISTRIBUTION_ID` are **no longer secrets** — both are
now CloudFormation-managed (`FrontendBucket`, `FrontendDistribution` in `template.yaml`,
Section 15) and resolved dynamically by CI from the stack outputs.

Mark every secret above as masked/protected in both GitHub and GitLab.

---
