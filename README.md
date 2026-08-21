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
