"""
Centralized application configuration.

Runs entirely on a local machine: no AWS SDK, no Cognito, no EC2, no
DynamoDB anywhere in this project. The LLM backend is a locally (or LAN)
hosted vLLM server, and all persistence (users, sessions, OAuth state,
GitHub integrations, pending human-in-the-loop actions) is a single SQLite
database on disk.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent.parent


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


class Settings:
    VLLM_ENDPOINT: str = os.environ.get("VLLM_ENDPOINT", "http://localhost:8000/v1/chat/completions")
    VLLM_HEALTH_ENDPOINT: str = os.environ.get(
        "VLLM_HEALTH_ENDPOINT", VLLM_ENDPOINT.rsplit("/v1/", 1)[0] + "/health"
    )
    MODEL_NAME: str = os.environ.get("MODEL_NAME", "Qwen/Qwen3-Coder-14B-Instruct-AWQ")

    STARTUP_BUDGET_S: int = int(os.environ.get("STARTUP_BUDGET_S", "120"))
    POLL_INTERVAL_S: float = float(os.environ.get("POLL_INTERVAL_S", "3"))
    RETRY_AFTER_S: int = int(os.environ.get("RETRY_AFTER_S", "120"))

    RATE_LIMIT_MAX_REQUESTS: int = int(os.environ.get("RATE_LIMIT_MAX_REQUESTS", "20"))
    RATE_LIMIT_WINDOW_S: int = int(os.environ.get("RATE_LIMIT_WINDOW_S", "60"))

    HTTP_TIMEOUT_S: float = float(os.environ.get("HTTP_TIMEOUT_S", "30"))

    TAVILY_API_KEY: str = _require("TAVILY_API_KEY")

    GOOGLE_CLIENT_ID: str = _require("GOOGLE_CLIENT_ID")
    GOOGLE_CLIENT_SECRET: str = _require("GOOGLE_CLIENT_SECRET")
    GOOGLE_REDIRECT_URI: str = _require("GOOGLE_REDIRECT_URI")
    GOOGLE_ALLOWED_EMAIL_DOMAIN: str = os.environ.get("GOOGLE_ALLOWED_EMAIL_DOMAIN", "")
    GOOGLE_DISCOVERY_URL: str = "https://accounts.google.com/.well-known/openid-configuration"

    SESSION_SECRET: str = _require("SESSION_SECRET")
    SESSION_TTL_S: int = int(os.environ.get("SESSION_TTL_S", str(7 * 24 * 60 * 60)))
    OAUTH_STATE_TTL_S: int = int(os.environ.get("OAUTH_STATE_TTL_S", "600"))
    OAUTH_STATE_COOKIE_NAME: str = "google_oauth_state"
    OAUTH_STATE_COOKIE_SALT: str = "google-oauth-state-v1"
    SESSION_COOKIE_NAME: str = "agent_session"
    COOKIE_SECURE: bool = os.environ.get("COOKIE_SECURE", "true").lower() == "true"

    GITHUB_OAUTH_CLIENT_ID: str = os.environ.get("GITHUB_OAUTH_CLIENT_ID", "")
    GITHUB_OAUTH_CLIENT_SECRET: str = os.environ.get("GITHUB_OAUTH_CLIENT_SECRET", "")
    GITHUB_TOKEN_URL: str = "https://github.com/login/oauth/access_token"
    GITHUB_USER_URL: str = "https://api.github.com/user"

    GITHUB_TOKEN: str = os.environ.get("GITHUB_TOKEN", "")
    GITLAB_TOKEN: str = os.environ.get("GITLAB_TOKEN", "")
    GITHUB_API: str = "https://api.github.com"
    GITLAB_API: str = "https://gitlab.com/api/v4"

    SQLITE_DB_PATH: Path = Path(os.environ.get("SQLITE_DB_PATH", str(BASE_DIR / "data" / "app.db")))

    CORS_ALLOW_ORIGINS: list[str] = [
        origin.strip()
        for origin in os.environ.get("CORS_ALLOW_ORIGINS", "http://localhost:5500").split(",")
        if origin.strip()
    ]

    APP_NAME: str = "Coding Agent API"
    APP_ENV: str = os.environ.get("APP_ENV", "development")


settings = Settings()
