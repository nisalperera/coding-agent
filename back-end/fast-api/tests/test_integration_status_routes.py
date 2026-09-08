from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth.dependencies import current_user
from app.db.database import db_session
from app.db.integrations_repository import integrations_repository
from app.db.models import User
from main import app

TEST_USER = {
    "user_id": "33333333-3333-3333-3333-333333333333",
    "email": "integration-status-route-test@example.test",
    "name": "Integration Status Route Test",
}

OTHER_USER = {
    "user_id": "44444444-4444-4444-4444-444444444444",
    "email": "integration-status-other-user@example.test",
    "name": "Integration Status Other User",
}


def _ensure_user(user: dict[str, str], google_sub: str) -> None:
    now = int(time.time())

    with db_session() as db:
        existing_user = db.scalar(
            select(User).where(User.user_id == user["user_id"])
        )

        if existing_user is None:
            db.add(
                User(
                    user_id=user["user_id"],
                    google_sub=google_sub,
                    email=user["email"],
                    email_verified=True,
                    name=user["name"],
                    picture=None,
                    created_at=now,
                    updated_at=now,
                )
            )


@pytest.fixture
def integration_status_user() -> dict[str, str]:
    _ensure_user(TEST_USER, "integration-status-route-test-subject")
    return TEST_USER


@pytest.fixture
def other_integration_status_user() -> dict[str, str]:
    _ensure_user(OTHER_USER, "integration-status-other-user-subject")
    return OTHER_USER


@pytest.fixture
def client(integration_status_user: dict[str, str]) -> TestClient:
    async def override_current_user() -> dict[str, str]:
        return integration_status_user

    app.dependency_overrides[current_user] = override_current_user

    with TestClient(app, follow_redirects=False) as test_client:
        yield test_client

    app.dependency_overrides.clear()


def _store_integration(
    *,
    user_id: str,
    provider: str,
    username: str,
) -> None:
    with db_session() as db:
        integrations_repository.create_or_update(
            db,
            user_id=user_id,
            provider=provider,
            access_token=f"test-{provider}-access-token-not-a-real-secret",
            refresh_token=(
                f"test-{provider}-refresh-token-not-a-real-secret"
            ),
            token_expires_at=int(time.time()) + 3600,
            username=username,
            scopes="read_user",
        )


def test_integration_status_requires_authenticated_user() -> None:
    app.dependency_overrides.clear()

    with TestClient(app, follow_redirects=False) as unauthenticated_client:
        response = unauthenticated_client.get("/v1/integrations/status")

    assert response.status_code in {401, 403}


def test_integration_status_returns_both_disconnected_defaults(
    client: TestClient,
) -> None:
    response = client.get("/v1/integrations/status")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "integrations": {
            "github": {
                "connected": False,
                "username": None,
                "connected_at": None,
            },
            "gitlab": {
                "connected": False,
                "username": None,
                "connected_at": None,
            },
        }
    }


def test_integration_status_returns_only_safe_connected_metadata(
    client: TestClient,
    integration_status_user: dict[str, str],
) -> None:
    _store_integration(
        user_id=integration_status_user["user_id"],
        provider="github",
        username="octocat",
    )
    _store_integration(
        user_id=integration_status_user["user_id"],
        provider="gitlab",
        username="gitlab-octocat",
    )

    response = client.get("/v1/integrations/status")

    assert response.status_code == 200, response.text
    payload = response.json()

    assert set(payload) == {"integrations"}
    assert set(payload["integrations"]) == {"github", "gitlab"}

    github = payload["integrations"]["github"]
    gitlab = payload["integrations"]["gitlab"]

    assert github["connected"] is True
    assert github["username"] == "octocat"
    assert isinstance(github["connected_at"], int)

    assert gitlab["connected"] is True
    assert gitlab["username"] == "gitlab-octocat"
    assert isinstance(gitlab["connected_at"], int)

    forbidden_fields = {
        "access_token",
        "refresh_token",
        "access_token_ciphertext",
        "refresh_token_ciphertext",
        "token_expires_at",
        "scopes",
        "code",
        "state",
        "cookie_nonce",
        "code_verifier",
        "client_id",
        "client_secret",
        "redirect_uri",
    }

    for provider_status in (github, gitlab):
        assert set(provider_status) == {
            "connected",
            "username",
            "connected_at",
        }
        assert forbidden_fields.isdisjoint(provider_status)


def test_integration_status_is_scoped_to_authenticated_user(
    client: TestClient,
    integration_status_user: dict[str, str],
    other_integration_status_user: dict[str, str],
) -> None:
    _store_integration(
        user_id=other_integration_status_user["user_id"],
        provider="github",
        username="other-user-octocat",
    )

    response = client.get("/v1/integrations/status")

    assert response.status_code == 200, response.text
    assert response.json() == {
        "integrations": {
            "github": {
                "connected": False,
                "username": None,
                "connected_at": None,
            },
            "gitlab": {
                "connected": False,
                "username": None,
                "connected_at": None,
            },
        }
    }

    with db_session() as db:
        other_status = integrations_repository.get_public_status_by_user_and_provider(
            db,
            user_id=other_integration_status_user["user_id"],
            provider="github",
        )

    assert other_status.connected is True
    assert other_status.username == "other-user-octocat"