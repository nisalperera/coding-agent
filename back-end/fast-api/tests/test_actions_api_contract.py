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
    "user_id": "55555555-5555-5555-5555-555555555555",
    "email": "actions-contract-test@example.test",
    "name": "Actions Contract Test",
}

OTHER_USER = {
    "user_id": "66666666-6666-6666-6666-666666666666",
    "email": "actions-contract-other-user@example.test",
    "name": "Actions Contract Other User",
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
def actions_user() -> dict[str, str]:
    _ensure_user(TEST_USER, "actions-contract-test-subject")
    return TEST_USER


@pytest.fixture
def other_actions_user() -> dict[str, str]:
    _ensure_user(OTHER_USER, "actions-contract-other-user-subject")
    return OTHER_USER


@pytest.fixture
def client(actions_user: dict[str, str]) -> TestClient:
    async def override_current_user() -> dict[str, str]:
        return actions_user

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


def _integration_exists(*, user_id: str, provider: str) -> bool:
    with db_session() as db:
        return (
            integrations_repository.get_by_user_and_provider(
                db,
                user_id=user_id,
                provider=provider,
            )
            is not None
        )


def test_actions_requires_authenticated_user() -> None:
    app.dependency_overrides.clear()

    with TestClient(app, follow_redirects=False) as unauthenticated_client:
        response = unauthenticated_client.post(
            "/v1/actions",
            json={
                "action": "disconnect_integration",
                "provider": "github",
            },
        )

    assert response.status_code in {401, 403}


@pytest.mark.parametrize(
    "field_name",
    [
        "github_token",
        "gitlab_token",
        "access_token",
        "refresh_token",
        "code",
        "state",
        "redirect_uri",
        "client_id",
        "client_secret",
        "code_verifier",
    ],
)
def test_actions_rejects_browser_credential_and_oauth_fields(
    client: TestClient,
    field_name: str,
) -> None:
    response = client.post(
        "/v1/actions",
        json={
            "action": "disconnect_integration",
            "provider": "github",
            field_name: "browser-supplied-value",
        },
    )

    assert response.status_code == 422, response.text


def test_actions_rejects_retired_github_oauth_callback_action(
    client: TestClient,
) -> None:
    response = client.post(
        "/v1/actions",
        json={
            "action": "github_oauth_callback",
            "code": "browser-code",
            "state": "browser-state",
        },
    )

    assert response.status_code == 422, response.text


@pytest.mark.parametrize("provider", ["github", "gitlab"])
def test_disconnect_removes_only_authenticated_users_integration(
    client: TestClient,
    actions_user: dict[str, str],
    other_actions_user: dict[str, str],
    provider: str,
) -> None:
    _store_integration(
        user_id=actions_user["user_id"],
        provider=provider,
        username=f"current-{provider}-user",
    )
    _store_integration(
        user_id=other_actions_user["user_id"],
        provider=provider,
        username=f"other-{provider}-user",
    )

    response = client.post(
        "/v1/actions",
        json={
            "action": "disconnect_integration",
            "provider": provider,
        },
    )

    assert response.status_code == 200, response.text
    assert response.json() == {
        "provider": provider,
        "connected": False,
    }

    assert not _integration_exists(
        user_id=actions_user["user_id"],
        provider=provider,
    )
    assert _integration_exists(
        user_id=other_actions_user["user_id"],
        provider=provider,
    )


def test_disconnect_rejects_unknown_provider(
    client: TestClient,
) -> None:
    response = client.post(
        "/v1/actions",
        json={
            "action": "disconnect_integration",
            "provider": "bitbucket",
        },
    )

    assert response.status_code == 422, response.text


def test_disconnect_rejects_pending_action_fields(
    client: TestClient,
) -> None:
    response = client.post(
        "/v1/actions",
        json={
            "action": "disconnect_integration",
            "provider": "github",
            "action_id": "11111111-1111-1111-1111-111111111111",
        },
    )

    assert response.status_code == 422, response.text


def test_pending_action_rejects_integration_provider_field(
    client: TestClient,
) -> None:
    response = client.post(
        "/v1/actions",
        json={
            "action": "action_pending",
            "action_id": "11111111-1111-1111-1111-111111111111",
            "decision": "approve",
            "provider": "github",
        },
    )

    assert response.status_code == 422, response.text