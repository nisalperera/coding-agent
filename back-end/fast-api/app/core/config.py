from __future__ import annotations

import os
from urllib.parse import urlparse

from dotenv import load_dotenv


load_dotenv()


def _require(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _optional(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _as_bool(name: str, default: bool = False) -> bool:
    value = _optional(name, str(default)).lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(f"Invalid boolean environment variable: {name}")


def _validate_http_url(name: str, value: str, *, allow_local_http: bool = False) -> str:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise RuntimeError(f"{name} must be an absolute HTTP(S) URL")

    hostname = (parsed.hostname or "").lower()
    is_local = hostname in {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme != "https" and not (allow_local_http and is_local):
        raise RuntimeError(f"{name} must use HTTPS outside local development")
    return value.rstrip("/")


class Settings:
    APP_ENV: str = _optional("APP_ENV", "development").lower()
    DEBUG: bool = _as_bool("DEBUG", False)

    TAVILY_API_KEY: str = _require("TAVILY_API_KEY")

    GOOGLE_CLIENT_ID: str = _require("GOOGLE_CLIENT_ID")
    GOOGLE_CLIENT_SECRET: str = _require("GOOGLE_CLIENT_SECRET")
    GOOGLE_REDIRECT_URI: str = _require("GOOGLE_REDIRECT_URI")
    GOOGLE_ALLOWED_DOMAIN: str = _optional("GOOGLE_ALLOWED_DOMAIN")

    SESSION_SECRET: str = _require("SESSION_SECRET")
    SESSION_COOKIE_NAME: str = _optional("SESSION_COOKIE_NAME", "session")
    SESSION_TTL_S: int = int(_optional("SESSION_TTL_S", "604800"))
    OAUTH_STATE_TTL_S: int = int(_optional("OAUTH_STATE_TTL_S", "600"))
    COOKIE_SECURE: bool = _as_bool("COOKIE_SECURE", False)

    DATABASE_URL: str = _require("DATABASE_URL")
    DATABASE_POOL_SIZE: int = int(_optional("DATABASE_POOL_SIZE", "5"))
    DATABASE_MAX_OVERFLOW: int = int(_optional("DATABASE_MAX_OVERFLOW", "10"))
    DATABASE_POOL_RECYCLE_S: int = int(_optional("DATABASE_POOL_RECYCLE_S", "1800"))
    DATABASE_CONNECT_TIMEOUT_S: int = int(_optional("DATABASE_CONNECT_TIMEOUT_S", "10"))

    FRONTEND_ORIGIN: str = _validate_http_url(
        "FRONTEND_ORIGIN",
        _require("FRONTEND_ORIGIN"),
        allow_local_http=APP_ENV in {"development", "test"},
    )
    CORS_ALLOW_ORIGINS: list[str] = [
        _validate_http_url(
            "CORS_ALLOW_ORIGINS",
            origin.strip(),
            allow_local_http=APP_ENV in {"development", "test"},
        )
        for origin in _optional("CORS_ALLOW_ORIGINS", FRONTEND_ORIGIN).split(",")
        if origin.strip()
    ]

    INTEGRATION_TOKEN_ENCRYPTION_KEY: str = _require("INTEGRATION_TOKEN_ENCRYPTION_KEY")
    INTEGRATIONS_ENABLED: bool = _as_bool("INTEGRATIONS_ENABLED", True)
    INTEGRATION_OAUTH_STATE_TTL_S: int = int(
        _optional("INTEGRATION_OAUTH_STATE_TTL_S", "600")
    )
    INTEGRATION_OAUTH_STATE_COOKIE_SALT: str = _optional(
        "INTEGRATION_OAUTH_STATE_COOKIE_SALT",
        "integration-oauth-state-v1",
    )

    GITHUB_OAUTH_CLIENT_ID: str = _optional("GITHUB_OAUTH_CLIENT_ID")
    GITHUB_OAUTH_CLIENT_SECRET: str = _optional("GITHUB_OAUTH_CLIENT_SECRET")
    GITHUB_OAUTH_REDIRECT_URI: str = _optional("GITHUB_OAUTH_REDIRECT_URI")
    GITHUB_OAUTH_SCOPES: str = _optional("GITHUB_OAUTH_SCOPES", "read:user,repo")
    GITHUB_AUTHORIZE_URL: str = "https://github.com/login/oauth/authorize"
    GITHUB_TOKEN_URL: str = "https://github.com/login/oauth/access_token"
    GITHUB_USER_URL: str = "https://api.github.com/user"
    GITHUB_OAUTH_STATE_COOKIE_NAME: str = "github_oauth_state"

    GITLAB_OAUTH_CLIENT_ID: str = _optional("GITLAB_OAUTH_CLIENT_ID")
    GITLAB_OAUTH_CLIENT_SECRET: str = _optional("GITLAB_OAUTH_CLIENT_SECRET")
    GITLAB_OAUTH_REDIRECT_URI: str = _optional("GITLAB_OAUTH_REDIRECT_URI")
    GITLAB_OAUTH_SCOPES: str = _optional("GITLAB_OAUTH_SCOPES", "read_user api")
    GITLAB_AUTHORIZE_URL: str = _optional(
        "GITLAB_AUTHORIZE_URL",
        "https://gitlab.com/oauth/authorize",
    )
    GITLAB_TOKEN_URL: str = _optional(
        "GITLAB_TOKEN_URL",
        "https://gitlab.com/oauth/token",
    )
    GITLAB_USER_URL: str = _optional(
        "GITLAB_USER_URL",
        "https://gitlab.com/api/v4/user",
    )
    GITLAB_OAUTH_STATE_COOKIE_NAME: str = "gitlab_oauth_state"

    @classmethod
    def validate(cls) -> None:
        if cls.DATABASE_POOL_SIZE < 1:
            raise RuntimeError("DATABASE_POOL_SIZE must be at least 1")
        if cls.DATABASE_MAX_OVERFLOW < 0:
            raise RuntimeError("DATABASE_MAX_OVERFLOW must be non-negative")
        if cls.DATABASE_POOL_RECYCLE_S < 0:
            raise RuntimeError("DATABASE_POOL_RECYCLE_S must be non-negative")
        if cls.DATABASE_CONNECT_TIMEOUT_S < 1:
            raise RuntimeError("DATABASE_CONNECT_TIMEOUT_S must be at least 1")
        if cls.SESSION_TTL_S < 1 or cls.OAUTH_STATE_TTL_S < 1:
            raise RuntimeError("Session and OAuth state TTLs must be positive")
        if cls.INTEGRATION_OAUTH_STATE_TTL_S < 1:
            raise RuntimeError("INTEGRATION_OAUTH_STATE_TTL_S must be positive")

        local_env = cls.APP_ENV in {"development", "test"}
        for name in (
            "GOOGLE_REDIRECT_URI",
            "GITHUB_OAUTH_REDIRECT_URI",
            "GITLAB_OAUTH_REDIRECT_URI",
        ):
            value = getattr(cls, name)
            if value:
                _validate_http_url(name, value, allow_local_http=local_env)

        for name in (
            "GITLAB_AUTHORIZE_URL",
            "GITLAB_TOKEN_URL",
            "GITLAB_USER_URL",
        ):
            _validate_http_url(name, getattr(cls, name), allow_local_http=local_env)


Settings.validate()
settings = Settings()
