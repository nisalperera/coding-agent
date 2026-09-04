# coding-agent

A personal coding agent that runs on AWS — combining a self-hosted Qwen3-Coder-14B model
(vLLM on a T4 EC2 instance), an authenticated serverless web app, and a terminal-native
CLI agent, with human-in-the-loop approval for any risky action (file writes, shell
commands, and GitHub/GitLab repo changes).

## Project layout

```
back-end/     Lambda handler, repo tools, and GitHub OAuth token exchange
cli/          Terminal-native coding agent + local auth flow
front-end/    Static chat UI (index.html + app.js + config.js), deployed to S3
template.yaml SAM/CloudFormation stack: Lambda, DynamoDB, Function URL
.github/      GitHub Actions CI/CD (test → deploy → deploy-frontend)
.gitlab-ci.yml GitLab CI/CD mirror of the same three stages
```

## Getting started

See [`config_guide.md`](./config_guide.md) for the complete setup: Cognito login
(Google/GitHub), per-user "Connect GitHub"/"Connect GitLab" repository authorization,
the vLLM serving setup, DynamoDB tables, and the OIDC-based CI/CD pipelines for both
GitHub Actions and GitLab CI.

## Local FastAPI deployment

The `feature/fastapi-mysql-oauth` branch adds a self-hosted local/LAN deployment
target alongside the AWS stack. It runs:

- `back-end/fast-api/main.py` as the FastAPI backend.
- MySQL with SQLAlchemy and Alembic for users, sessions, OAuth state, integrations,
  and pending actions.
- Direct Google OpenID Connect with server-side sessions instead of Cognito.
- A local or LAN-accessible OpenAI-compatible vLLM server.
- Per-user GitHub/GitLab provider OAuth, with legacy shared tokens available only when
  `ALLOW_LEGACY_PROVIDER_TOKEN_FALLBACK=true` is explicitly configured for development.

From `back-end/fast-api`, configure the local environment, apply the schema, and start
the service:

```bash
alembic upgrade head
uvicorn main:app --host 127.0.0.1 --port 8000
```

Provider access and refresh tokens will be encrypted before storage by the local
integration repository using `INTEGRATION_TOKEN_ENCRYPTION_KEY`; generate a Fernet key
with:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Do not commit the key. Keep a separate, stable key for each environment while any token
ciphertext encrypted with it remains stored. See the
[local deployment section in `config_guide.md`](./config_guide.md#local-deployment-this-branch-only)
for the architecture, database migration, and key-rotation details.
