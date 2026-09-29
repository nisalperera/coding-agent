from __future__ import annotations

import os
import time
from collections.abc import Iterator

import pytest
from cryptography.fernet import Fernet

# Configure deterministic test-only settings before importing app modules.
# Tests must not load developer-local .env values or shell-provided credentials.
os.environ["SKIP_DOTENV"] = "true"
os.environ["APP_ENV"] = "test"
os.environ["DEBUG"] = "false"

# Browser, cookie, session, and OAuth configuration.
os.environ["FRONTEND_ORIGIN"] = "http://localhost:3000"
os.environ["CORS_ALLOW_ORIGINS"] = "http://localhost:3000,http://127.0.0.1:3000"
os.environ["COOKIE_SECURE"] = "false"

os.environ["SESSION_SECRET"] = "test-session-secret-only-not-for-production-0123456789"
os.environ["SESSION_COOKIE_NAME"] = "test-session"
os.environ["SESSION_TTL_S"] = "604800"

os.environ["OAUTH_STATE_TTL_S"] = "600"
os.environ["OAUTH_STATE_COOKIE_SALT"] = "google-oauth-state-v1"

# Integration OAuth callback-cookie signing:
# SESSION_SECRET is the signing secret.
# INTEGRATION_OAUTH_STATE_COOKIE_SALT is a stable purpose-separation salt.
os.environ["INTEGRATIONS_ENABLED"] = "true"
os.environ["INTEGRATION_OAUTH_STATE_TTL_S"] = "600"
os.environ["INTEGRATION_OAUTH_STATE_COOKIE_SALT"] = "integration-oauth-state-v1"
os.environ["INTEGRATION_TOKEN_ENCRYPTION_KEY"] = Fernet.generate_key().decode("utf-8")

# Test database configuration. This must point only to a disposable MySQL
# database used by the existing cleanup fixture and test environment.
os.environ["DATABASE_URL"] = (
    "mysql+pymysql://coding_agent:coding_agent@localhost:3306/coding_agent"
)
os.environ["DATABASE_POOL_SIZE"] = "5"
os.environ["DATABASE_MAX_OVERFLOW"] = "10"
os.environ["DATABASE_POOL_RECYCLE_S"] = "1800"
os.environ["DATABASE_CONNECT_TIMEOUT_S"] = "10"

# Existing external-service test configuration.
os.environ["TAVILY_API_KEY"] = "test-tavily-key"

# Google login OAuth test configuration.
os.environ["GOOGLE_CLIENT_ID"] = "test-client-id.apps.googleusercontent.com"
os.environ["GOOGLE_CLIENT_SECRET"] = "test-google-secret"
os.environ["GOOGLE_REDIRECT_URI"] = "http://localhost:8000/v1/auth/google/callback"
os.environ["GOOGLE_ALLOWED_DOMAIN"] = ""

# GitHub OAuth test configuration.
# These are fake values used only in mocked route and HTTP-client tests.
os.environ["GITHUB_OAUTH_CLIENT_ID"] = "test-github-client-id"
os.environ["GITHUB_OAUTH_CLIENT_SECRET"] = "test-github-client-secret"
os.environ["GITHUB_OAUTH_REDIRECT_URI"] = "https://testserver/v1/auth/github/callback"
os.environ["GITHUB_OAUTH_SCOPES"] = "read:user,repo"
os.environ["GITHUB_AUTHORIZE_URL"] = "https://github.com/login/oauth/authorize"
os.environ["GITHUB_TOKEN_URL"] = "https://github.com/login/oauth/access_token"
os.environ["GITHUB_USER_URL"] = "https://api.github.com/user"

# GitLab OAuth test configuration.
os.environ["GITLAB_OAUTH_CLIENT_ID"] = "test-gitlab-client-id"
os.environ["GITLAB_OAUTH_CLIENT_SECRET"] = "test-gitlab-client-secret"
os.environ["GITLAB_OAUTH_REDIRECT_URI"] = "https://testserver/v1/auth/gitlab/callback"
os.environ["GITLAB_OAUTH_SCOPES"] = "read_user"
os.environ["GITLAB_REPOSITORY_WRITE_ENABLED"] = "false"
os.environ["GITLAB_AUTHORIZE_URL"] = "https://gitlab.com/oauth/authorize"
os.environ["GITLAB_TOKEN_URL"] = "https://gitlab.com/oauth/token"
os.environ["GITLAB_USER_URL"] = "https://gitlab.com/api/v4/user"

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.db.database import SessionLocal
from app.db.models import (
    IntegrationOAuthState,
    OAuthState,
    PendingAction,
    SessionRecord,
    User,
    UserIntegration,
)


@pytest.fixture
def db() -> Iterator[Session]:
    """
    Provide a transaction-aware SQLAlchemy session for the disposable MySQL test database.
    """
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@pytest.fixture(autouse=True)
def clean_database() -> Iterator[None]:
    """
    Clear transactional tables before every test.

    This fixture must remain restricted to the disposable MySQL database
    configured for tests. Never point DATABASE_URL at a development or
    production database while running pytest.
    """
    session = SessionLocal()
    try:
        session.execute(delete(IntegrationOAuthState))
        session.execute(delete(OAuthState))
        session.execute(delete(PendingAction))
        session.execute(delete(UserIntegration))
        session.execute(delete(SessionRecord))
        session.execute(delete(User))
        session.commit()

        yield
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def now() -> int:
    return int(time.time())


@pytest.fixture
def google_claims() -> dict[str, object]:
    return {
        "sub": "google-subject-123",
        "email": "engineer@example.com",
        "email_verified": True,
        "name": "Test Engineer",
        "picture": "https://example.test/avatar.png",
    }
