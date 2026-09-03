// front-end/config.js
//
// Runtime configuration for the Coding Agent front-end.
// These placeholders are substituted at deploy/container-build time (see
// docker-entrypoint substitution in Dockerfile, or your CI "inject config"
// step) — never hardcode real values here; this file is checked into git
// as a template only.
//
// BACKEND_URL must point at the FastAPI service (see back-end/main.py).
// There is no Cognito, no Lambda Function URL, and no CloudFormation output
// to inject anymore — this is a plain HTTP(S) origin for the FastAPI app,
// e.g. "https://api.example.com" or "http://localhost:" in development.

window.APP_CONFIG = {
  BACKEND_URL: process.env.BACKEND_URL,
  GITHUB_OAUTH_CLIENT_ID: process.env.GITHUB_OAUTH_CLIENT_ID,
  GITLAB_OAUTH_CLIENT_ID: process.env.GITLAB_OAUTH_CLIENT_ID,
};
