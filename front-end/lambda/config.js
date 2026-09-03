// front-end/config.js
//
// Runtime configuration for Nisal's Coding Agent front-end.
// These placeholders are substituted at deploy time by CI — see the
// "Inject runtime config" step in .github/workflows/deploy.yml and the
// deploy-frontend job in .gitlab-ci.yml — using live CloudFormation stack
// outputs (LAMBDA_FUNCTION_URL) and pipeline secrets (everything else).
// Do NOT hardcode real values here; this file is checked into git as a
// template only.
window.APP_CONFIG = {
  LAMBDA_URL: "__LAMBDA_FUNCTION_URL__",
  COGNITO_DOMAIN: "__COGNITO_DOMAIN__",
  COGNITO_CLIENT_ID: "__COGNITO_CLIENT_ID__",
  GITHUB_OAUTH_CLIENT_ID: "__GITHUB_OAUTH_CLIENT_ID__",
  GITLAB_OAUTH_CLIENT_ID: "__GITLAB_OAUTH_CLIENT_ID__",
};
