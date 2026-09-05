from __future__ import annotations

import os
import time
import pytest

from collections.abc import Iterator

from cryptography.fernet import Fernet

from sqlalchemy import delete
from sqlalchemy.orm import Session


from app.db.database import SessionLocal
from app.db.models import (
    IntegrationOAuthState,
    OAuthState,
    PendingAction,
    SessionRecord,
    User,
    UserIntegration
)


os.environ["SKIP_DOTENV"] = "true"
os.environ["APP_ENV"] = "test"
os.environ["DEBUG"] = "false"

os.environ.setdefault("TAVILY_API_KEY", "test-tavily-key")

os.environ.setdefault(
    "GOOGLE_CLIENT_ID",
    "test-client-id.apps.googleusercontent.com",
)
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test-google-secret")
os.environ.setdefault(
    "GOOGLE_REDIRECT_URI",
    "http://localhost:8000/v1/auth/google/callback",
)

os.environ.setdefault("SESSION_SECRET", "test-session-secret")
os.environ.setdefault("FRONTEND_ORIGIN", "http://localhost:3000")
os.environ.setdefault(
    "CORS_ALLOW_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000",
)
os.environ.setdefault("COOKIE_SECURE", "false")

os.environ.setdefault(
    "DATABASE_URL",
    "mysql+pymysql://user:password@mysql:3306/coding_agent",
)

os.environ["INTEGRATIONS_ENABLED"] = "true"
os.environ["INTEGRATION_TOKEN_ENCRYPTION_KEY"] = Fernet.generate_key().decode()

os.environ.setdefault("GITHUB_OAUTH_CLIENT_ID", "test-github-client-id")
os.environ.setdefault("GITHUB_OAUTH_CLIENT_SECRET", "test-github-secret")
os.environ.setdefault(
    "GITHUB_OAUTH_REDIRECT_URI",
    "http://localhost:8000/v1/auth/github/callback",
)

os.environ.setdefault("GITLAB_OAUTH_CLIENT_ID", "test-gitlab-client-id")
os.environ.setdefault("GITLAB_OAUTH_CLIENT_SECRET", "test-gitlab-secret")
os.environ.setdefault(
    "GITLAB_OAUTH_REDIRECT_URI",
    "http://localhost:8000/v1/auth/gitlab/callback",
)
os.environ["GITLAB_OAUTH_SCOPES"] = "read_user"
os.environ["GITLAB_REPOSITORY_WRITE_ENABLED"] = "false"

@pytest.fixture
def db() -> Iterator[Session]:
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
    """Keep this fixture restricted to the disposable MySQL test database."""
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
