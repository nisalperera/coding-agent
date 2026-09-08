from __future__ import annotations

import time
from urllib.parse import parse_qs, urlparse

import pytest
import respx
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import select

from app.auth.dependencies import current_user
from app.db.database import db_session
from app.db.models import IntegrationOAuthState, User
from app.services.github_oauth_service import GITHUB_PROVIDER
from main import app

TEST_USER = {
    "user_id": "11111111-1111-1111-1111-111111111111",
    "email": "github-oauth-route-test@example.test",
    "name": "GitHub OAuth Route Test",
}


@pytest.fixture
def client(github_oauth_user: dict[str, str]) -> TestClient:
    async def override_current_user() -> dict[str, str]:
        return github_oauth_user

    app.dependency_overrides[current_user] = override_current_user

    with TestClient(app, follow_redirects=False) as test_client:
        yield test_client

    app.dependency_overrides.clear()


@pytest.fixture
def github_oauth_user() -> dict[str, str]:
    """
    Create the parent MySQL user required by the integration OAuth state
    foreign-key relationship.
    """
    now = int(time.time())

    with db_session() as db:
        existing_user = db.scalar(
            select(User).where(User.user_id == TEST_USER["user_id"])
        )

        if existing_user is None:
            db.add(
                User(
                    user_id=TEST_USER["user_id"],
                    google_sub="github-oauth-route-test-subject",
                    email=TEST_USER["email"],
                    name=TEST_USER["name"],
                    picture=None,
                    created_at=now,
                    updated_at=now,
                )
            )

    return TEST_USER


def _start_github_login(client: TestClient) -> str:
    response = client.get("/v1/auth/github/login")

    assert response.status_code == 303
    assert "github.com/login/oauth/authorize" in response.headers["location"]

    location = response.headers["location"]
    query = parse_qs(urlparse(location).query)
    state = query["state"][0]

    assert state
    assert client.cookies.get("github_integration_oauth")

    return state


def test_github_login_requires_authenticated_user() -> None:
    app.dependency_overrides.clear()

    with TestClient(app, follow_redirects=False) as unauthenticated_client:
        response = unauthenticated_client.get("/v1/auth/github/login")

    assert response.status_code in {401, 403}


def test_github_login_redirect_contains_backend_controlled_parameters(
    client: TestClient,
) -> None:
    response = client.get("/v1/auth/github/login")

    assert response.status_code == 303, response.text

    parsed = urlparse(response.headers["location"])
    query = parse_qs(parsed.query)

    state = query["state"][0]

    with db_session() as db:
        stored_state = db.scalar(
            select(IntegrationOAuthState).where(IntegrationOAuthState.state == state)
        )

    assert stored_state is not None
    assert stored_state.user_id == TEST_USER["user_id"]
    assert stored_state.provider == "github"
    assert stored_state.expires_at > int(time.time())
    assert stored_state.code_verifier is None

    assert parsed.scheme == "https"
    assert parsed.netloc == "github.com"
    assert parsed.path == "/login/oauth/authorize"

    assert query["client_id"]
    assert query["redirect_uri"]
    assert query["scope"]
    assert query["state"]

    assert "code" not in query
    assert "access_token" not in query
    assert "refresh_token" not in query
    assert "client_secret" not in query
    assert "code_verifier" not in query


def test_github_login_sets_http_only_callback_cookie(
    client: TestClient,
) -> None:
    response = client.get("/v1/auth/github/login")

    set_cookie = response.headers["set-cookie"].lower()

    assert "github_integration_oauth=" in set_cookie
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie
    assert "path=/v1/auth/github" in set_cookie
    assert "max-age=" in set_cookie


@respx.mock
def test_github_callback_success_exchanges_and_stores_integration(
    client: TestClient,
) -> None:
    from app.core.config import settings

    state = _start_github_login(client)
    raw_access_token = "test-github-access-token-not-a-real-secret"

    token_route = respx.post(settings.GITHUB_TOKEN_URL).mock(
        return_value=Response(
            200,
            json={
                "access_token": raw_access_token,
                "scope": "read:user repo",
                "token_type": "bearer",
            },
        )
    )
    user_route = respx.get(settings.GITHUB_USER_URL).mock(
        return_value=Response(
            200,
            json={"login": "octocat"},
        )
    )

    response = client.get(
        "/v1/auth/github/callback",
        params={
            "code": "test-authorization-code",
            "state": state,
        },
    )

    assert response.status_code == 303
    assert response.headers["location"].startswith("http://localhost:3000/")
    assert "integration=github" in response.headers["location"]
    assert "connected=1" in response.headers["location"]

    assert token_route.called
    assert user_route.called

    token_request_body = token_route.calls[0].request.content.decode("utf-8")
    assert "client_id=" in token_request_body
    assert "client_secret=" in token_request_body
    assert "redirect_uri=" in token_request_body
    assert "code=test-authorization-code" in token_request_body

    user_request = user_route.calls[0].request
    assert user_request.headers["authorization"] == f"Bearer {raw_access_token}"

    set_cookie = response.headers["set-cookie"].lower()
    assert "github_integration_oauth=" in set_cookie
    assert "max-age=0" in set_cookie or "expires=" in set_cookie


@respx.mock
def test_github_callback_invalid_cookie_does_not_call_github(
    client: TestClient,
) -> None:
    from app.core.config import settings

    state = _start_github_login(client)

    client.cookies.set(
        "github_integration_oauth",
        "tampered.callback.cookie",
        path="/v1/auth/github",
    )

    token_route = respx.post(settings.GITHUB_TOKEN_URL).mock(return_value=Response(500))
    user_route = respx.get(settings.GITHUB_USER_URL).mock(return_value=Response(500))

    response = client.get(
        "/v1/auth/github/callback",
        params={
            "code": "code",
            "state": state,
        },
    )

    assert response.status_code == 303
    assert "connected=0" in response.headers["location"]
    assert not token_route.called
    assert not user_route.called


@respx.mock
def test_github_callback_state_replay_fails_before_second_exchange(
    client: TestClient,
) -> None:
    from app.core.config import settings

    state = _start_github_login(client)

    token_route = respx.post(settings.GITHUB_TOKEN_URL).mock(
        return_value=Response(
            200,
            json={"access_token": "test-access-token"},
        )
    )
    user_route = respx.get(settings.GITHUB_USER_URL).mock(
        return_value=Response(
            200,
            json={"login": "octocat"},
        )
    )

    first_response = client.get(
        "/v1/auth/github/callback",
        params={
            "code": "first-code",
            "state": state,
        },
    )

    assert first_response.status_code == 303
    assert "connected=1" in first_response.headers["location"]
    assert token_route.call_count == 1
    assert user_route.call_count == 1

    second_response = client.get(
        "/v1/auth/github/callback",
        params={
            "code": "second-code",
            "state": state,
        },
    )

    assert second_response.status_code == 303
    assert "connected=0" in second_response.headers["location"]
    assert token_route.call_count == 1
    assert user_route.call_count == 1


@respx.mock
def test_github_callback_provider_error_skips_token_exchange(
    client: TestClient,
) -> None:
    from app.core.config import settings

    _start_github_login(client)

    token_route = respx.post(settings.GITHUB_TOKEN_URL).mock(return_value=Response(500))

    response = client.get(
        "/v1/auth/github/callback",
        params={
            "error": "access_denied",
            "error_description": "Do not leak this provider value",
        },
    )

    assert response.status_code == 303
    assert "connected=0" in response.headers["location"]
    assert "access_denied" not in response.headers["location"]
    assert "error_description" not in response.headers["location"]
    assert not token_route.called


@respx.mock
def test_github_callback_requires_nonempty_github_login(
    client: TestClient,
) -> None:
    from app.core.config import settings

    state = _start_github_login(client)

    respx.post(settings.GITHUB_TOKEN_URL).mock(
        return_value=Response(
            200,
            json={"access_token": "test-access-token"},
        )
    )
    respx.get(settings.GITHUB_USER_URL).mock(
        return_value=Response(
            200,
            json={"login": ""},
        )
    )

    response = client.get(
        "/v1/auth/github/callback",
        params={
            "code": "code",
            "state": state,
        },
    )

    assert response.status_code == 303
    assert "connected=0" in response.headers["location"]


def test_legacy_github_callback_action_is_rejected(
    client: TestClient,
) -> None:
    response = client.post(
        "/v1/actions",
        json={
            "action": "github_oauth_callback",
            "code": "browser-supplied-code",
            "state": "browser-supplied-state",
            "redirect_uri": "https://attacker.example/callback",
        },
    )

    assert response.status_code in {400, 422}


def test_github_callback_redirect_never_reflects_callback_values(
    client: TestClient,
) -> None:
    response = client.get(
        "/v1/auth/github/callback",
        params={
            "error": "access_denied",
            "error_description": "sensitive-text",
            "state": "attacker-controlled-state",
            "redirect_uri": "https://attacker.example/callback",
        },
    )

    assert response.status_code == 303
    assert response.headers["location"].startswith("http://localhost:3000/")
    assert "attacker.example" not in response.headers["location"]
    assert "sensitive-text" not in response.headers["location"]
    assert "attacker-controlled-state" not in response.headers["location"]
    assert f"integration={GITHUB_PROVIDER}" in response.headers["location"]


def test_debug_github_oauth_settings() -> None:
    from app.core.config import settings

    names = (
        "APP_ENV",
        "INTEGRATIONS_ENABLED",
        "FRONTEND_ORIGIN",
        "COOKIE_SECURE",
        "GITHUB_AUTHORIZE_URL",
        "GITHUB_TOKEN_URL",
        "GITHUB_USER_URL",
        "GITHUB_OAUTH_REDIRECT_URI",
        "GITHUB_OAUTH_SCOPES",
        "INTEGRATION_OAUTH_STATE_COOKIE_SALT",
        "INTEGRATION_OAUTH_STATE_TTL_S",
    )

    for name in names:
        print(f"{name}: {getattr(settings, name, '<MISSING>')!r}")

    for name in (
        "SESSION_SECRET",
        "GITHUB_OAUTH_CLIENT_ID",
        "GITHUB_OAUTH_CLIENT_SECRET",
    ):
        value = getattr(settings, name, None)
        print(f"{name}_PRESENT: {isinstance(value, str) and bool(value.strip())}")
