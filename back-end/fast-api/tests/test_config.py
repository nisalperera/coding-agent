from __future__ import annotations

import importlib
import sys
from collections.abc import Iterator

import pytest
from cryptography.fernet import Fernet

CONFIG_MODULE = "app.core.config"


def _base_env() -> dict[str, str]:
    return {
        "SKIP_DOTENV": "true",
        "APP_ENV": "development",
        "DEBUG": "false",
        "TAVILY_API_KEY": "test-tavily-key",
        "GOOGLE_CLIENT_ID": "test-client-id.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "test-google-secret",
        "GOOGLE_REDIRECT_URI": "http://localhost:8000/v1/auth/google/callback",
        "SESSION_SECRET": "test-session-secret",
        "FRONTEND_ORIGIN": "http://localhost:3000",
        "CORS_ALLOW_ORIGINS": "http://localhost:3000,http://127.0.0.1:3000",
        "COOKIE_SECURE": "false",
        "DATABASE_URL": "mysql+pymysql://user:password@mysql:3306/coding_agent",
        "INTEGRATIONS_ENABLED": "true",
        "INTEGRATION_TOKEN_ENCRYPTION_KEY": Fernet.generate_key().decode(),
        "GITHUB_OAUTH_CLIENT_ID": "test-github-client-id",
        "GITHUB_OAUTH_CLIENT_SECRET": "test-github-secret",
        "GITHUB_OAUTH_REDIRECT_URI": "http://localhost:8000/v1/auth/github/callback",
        "GITLAB_OAUTH_CLIENT_ID": "test-gitlab-client-id",
        "GITLAB_OAUTH_CLIENT_SECRET": "test-gitlab-secret",
        "GITLAB_OAUTH_REDIRECT_URI": "http://localhost:8000/v1/auth/gitlab/callback",
        "GITLAB_OAUTH_SCOPES": "read_user",
        "GITLAB_REPOSITORY_WRITE_ENABLED": "false"
    }

def _production_env() -> dict[str, str]:
    return {
        "APP_ENV": "production",
        "COOKIE_SECURE": "true",
        "FRONTEND_ORIGIN": "https://coding.nisalperera.com",
        "CORS_ALLOW_ORIGINS": "https://coding.nisalperera.com",
        "GOOGLE_REDIRECT_URI": "https://api.nisalperera.com/v1/auth/google/callback",
        "GITHUB_OAUTH_REDIRECT_URI": "https://api.nisalperera.com/v1/auth/github/callback",
        "GITLAB_OAUTH_REDIRECT_URI": "https://api.nisalperera.com/v1/auth/gitlab/callback",
    }

@pytest.fixture(autouse=True)
def isolated_config_environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    for name in tuple(sys.modules):
        if name == CONFIG_MODULE:
            del sys.modules[name]

    for name in _base_env():
        monkeypatch.delenv(name, raising=False)
    monkeypatch.delenv("GITLAB_REPOSITORY_WRITE_ENABLED", raising=False)

    yield

    for name in tuple(sys.modules):
        if name == CONFIG_MODULE:
            del sys.modules[name]


def _load_settings(monkeypatch: pytest.MonkeyPatch, **overrides: str | None):
    environment = _base_env()
    environment.update({key: value for key, value in overrides.items() if value is not None})

    for name, value in environment.items():
        monkeypatch.setenv(name, value)

    for name, value in overrides.items():
        if value is None:
            monkeypatch.delenv(name, raising=False)

    module = importlib.import_module(CONFIG_MODULE)
    return module.settings


def _assert_config_error(
    monkeypatch: pytest.MonkeyPatch,
    message: str,
    **overrides: str | None,
) -> None:
    with pytest.raises(RuntimeError, match=message):
        _load_settings(monkeypatch, **overrides)


def test_development_localhost_configuration_loads(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _load_settings(monkeypatch)

    assert settings.APP_ENV == "development"
    assert settings.FRONTEND_ORIGIN == "http://localhost:3000"
    assert settings.CORS_ALLOW_ORIGINS == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


def test_markdown_formatted_cors_origin_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    _assert_config_error(
        monkeypatch,
        "CORS_ALLOW_ORIGINS must be an absolute HTTP\\(S\\) URL",
        CORS_ALLOW_ORIGINS=(
            "http://localhost:3000,"
            "[http://127.0.0.1:3000](http://127.0.0.1:3000)"
        ),
    )


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("FRONTEND_ORIGIN", "http://view.nisalperera.com"),
        ("GOOGLE_REDIRECT_URI", "http://api.nisalperera.com/v1/auth/google/callback"),
        ("GITHUB_OAUTH_REDIRECT_URI", "http://api.nisalperera.com/v1/auth/github/callback"),
        ("GITLAB_OAUTH_REDIRECT_URI", "http://api.nisalperera.com/v1/auth/gitlab/callback"),
    ],
)
def test_production_http_callback_and_frontend_urls_are_rejected(
    monkeypatch: pytest.MonkeyPatch,
    name: str,
    value: str,
) -> None:

    environment = _production_env()
    environment[name] = value

    _assert_config_error(
        monkeypatch,
        f"{name} must use HTTPS outside local development",
        **environment
    )


def test_production_rejects_insecure_cookie_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    environment = _production_env()
    environment["COOKIE_SECURE"] = "false"

    _assert_config_error(
        monkeypatch,
        "COOKIE_SECURE must be true outside development and test",
        **environment
    )


def test_missing_database_url_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    _assert_config_error(
        monkeypatch,
        "Missing required environment variable: DATABASE_URL",
        DATABASE_URL=None,
    )


def test_sqlite_database_url_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    _assert_config_error(
        monkeypatch,
        "DATABASE_URL must use the mysql\\+pymysql SQLAlchemy dialect",
        DATABASE_URL="sqlite:///data/coding_agent.db",
    )


def test_mysql_pymysql_database_url_is_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _load_settings(
        monkeypatch,
        DATABASE_URL="mysql+pymysql://user:password@mysql:3306/coding_agent",
    )

    assert settings.DATABASE_URL.startswith("mysql+pymysql://")


def test_missing_fernet_key_is_rejected_when_integrations_are_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _assert_config_error(
        monkeypatch,
        "Missing required environment variable: INTEGRATION_TOKEN_ENCRYPTION_KEY",
        INTEGRATION_TOKEN_ENCRYPTION_KEY=None,
        INTEGRATIONS_ENABLED="true",
    )


def test_invalid_fernet_key_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    _assert_config_error(
        monkeypatch,
        "INTEGRATION_TOKEN_ENCRYPTION_KEY must be a valid Fernet key",
        INTEGRATION_TOKEN_ENCRYPTION_KEY="not-a-fernet-key",
    )


def test_generated_fernet_key_is_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    key = Fernet.generate_key().decode()

    settings = _load_settings(monkeypatch, INTEGRATION_TOKEN_ENCRYPTION_KEY=key)

    assert settings.INTEGRATION_TOKEN_ENCRYPTION_KEY == key


def test_gitlab_default_scope_is_read_user(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _load_settings(monkeypatch, GITLAB_OAUTH_SCOPES=None)

    assert settings.GITLAB_OAUTH_SCOPES == "read_user"


def test_gitlab_api_scope_requires_explicit_repository_write_enablement(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _assert_config_error(
        monkeypatch,
        "GITLAB_OAUTH_SCOPES may include api only when "
        "GITLAB_REPOSITORY_WRITE_ENABLED is true",
        GITLAB_OAUTH_SCOPES="read_user api",
        GITLAB_REPOSITORY_WRITE_ENABLED="false",
    )


def test_gitlab_api_scope_is_accepted_when_repository_writes_are_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _load_settings(
        monkeypatch,
        GITLAB_OAUTH_SCOPES="read_user api",
        GITLAB_REPOSITORY_WRITE_ENABLED="true",
    )

    assert settings.GITLAB_OAUTH_SCOPES == "read_user api"


def test_gitlab_scope_csv_is_normalized(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _load_settings(
        monkeypatch,
        GITLAB_OAUTH_SCOPES="read_user,api",
        GITLAB_REPOSITORY_WRITE_ENABLED="true",
    )

    assert settings.GITLAB_OAUTH_SCOPES == "read_user api"


def test_gitlab_duplicate_scope_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    _assert_config_error(
        monkeypatch,
        "GITLAB_OAUTH_SCOPES must not contain duplicate scopes",
        GITLAB_OAUTH_SCOPES="read_user read_user",
    )


def test_gitlab_unsupported_scope_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    _assert_config_error(
        monkeypatch,
        "GITLAB_OAUTH_SCOPES contains unsupported scope\\(s\\): sudo",
        GITLAB_OAUTH_SCOPES="read_user sudo",
    )
