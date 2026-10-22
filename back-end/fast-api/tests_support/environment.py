"""Set test-only values before importing application configuration."""
import base64
import hashlib
import os
from .sandbox import validate_environment

def configure_environment():
    targets = validate_environment(os.environ)
    key = base64.urlsafe_b64encode(hashlib.sha256(("r0:" + targets.token).encode()).digest()).decode()
    values = {
        "SKIP_DOTENV": "true", "APP_ENV": "test", "DEBUG": "false",
        "DATABASE_URL": targets.database_url, "MONGODB_URI": targets.mongodb_uri,
        "MONGODB_DATABASE": "coding_agent_test", "DATABASE_POOL_SIZE": "5",
        "DATABASE_MAX_OVERFLOW": "10", "DATABASE_POOL_RECYCLE_S": "1800",
        "DATABASE_CONNECT_TIMEOUT_S": "5", "HTTP_TIMEOUT_S": "10",
        "FRONTEND_ORIGIN": "http://localhost:3000",
        "CORS_ALLOW_ORIGINS": "http://localhost:3000,http://127.0.0.1:3000",
        "COOKIE_SECURE": "false", "SESSION_SECRET": "r0-test-session-" + targets.token,
        "SESSION_COOKIE_NAME": "test-session", "SESSION_TTL_S": "604800",
        "OAUTH_STATE_TTL_S": "600", "OAUTH_STATE_COOKIE_SALT": "google-oauth-state-v1",
        "INTEGRATIONS_ENABLED": "true", "INTEGRATION_OAUTH_STATE_TTL_S": "600",
        "INTEGRATION_OAUTH_STATE_COOKIE_SALT": "integration-oauth-state-v1",
        "INTEGRATION_TOKEN_ENCRYPTION_KEY": key,
        "TAVILY_API_KEY": "test-tavily-key",
        "GOOGLE_CLIENT_ID": "test-client-id.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "test-google-secret",
        "GOOGLE_REDIRECT_URI": "http://localhost:8000/v1/auth/google/callback",
        "GOOGLE_ALLOWED_DOMAIN": "", "GOOGLE_ALLOWED_EMAIL_DOMAIN": "",
        "GITHUB_OAUTH_CLIENT_ID": "test-github-client-id",
        "GITHUB_OAUTH_CLIENT_SECRET": "test-github-client-secret",
        "GITHUB_OAUTH_REDIRECT_URI": "https://testserver/v1/auth/github/callback",
        "GITHUB_OAUTH_SCOPES": "read:user,repo",
        "GITHUB_AUTHORIZE_URL": "https://github.com/login/oauth/authorize",
        "GITHUB_TOKEN_URL": "https://github.com/login/oauth/access_token",
        "GITHUB_USER_URL": "https://api.github.com/user",
        "GITLAB_OAUTH_CLIENT_ID": "test-gitlab-client-id",
        "GITLAB_OAUTH_CLIENT_SECRET": "test-gitlab-client-secret",
        "GITLAB_OAUTH_REDIRECT_URI": "https://testserver/v1/auth/gitlab/callback",
        "GITLAB_OAUTH_SCOPES": "read_user", "GITLAB_REPOSITORY_WRITE_ENABLED": "false",
        "GITLAB_AUTHORIZE_URL": "https://gitlab.com/oauth/authorize",
        "GITLAB_TOKEN_URL": "https://gitlab.com/oauth/token",
        "GITLAB_USER_URL": "https://gitlab.com/api/v4/user",
        "JWT_SECRET": "r0-test-jwt-" + targets.token, "JWT_ALGORITHM": "HS256",
        "JWT_EXPIRES_MINUTES": "60", "VLLM_MODEL": "Test-Model",
        "VLLM_ENDPOINT": "http://localhost:8080/v1/chat/completions",
        "VLLM_HEALTH_ENDPOINT": "http://localhost:8080/health",
        "POST_LOGIN_REDIRECT_URL": "http://localhost:3000/",
        "OPERATOR_USER_IDS": "", "ALLOW_LEGACY_PROVIDER_TOKEN_FALLBACK": "false",
        "GITHUB_TOKEN": "", "GITLAB_TOKEN": "", "PYTEST_ADDOPTS": "",
    }
    os.environ.update(values)
    return targets
