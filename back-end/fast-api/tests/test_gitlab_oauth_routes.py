from __future__ import annotations

import base64
import hashlib
import time
from urllib.parse import parse_qs, urlparse

import pytest
import respx
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import select

from app.auth.dependencies import current_user
from app.db.database import db_session
from app.db.models import IntegrationOAuthState, User, UserIntegration
from app.services.gitlab_oauth_service import GITLAB_PROVIDER
from main import app

TEST_USER = {
    "user_id": "22222222-2222-2222-2222-222222222222",
    "email": "gitlab-oauth-route-test@example.test",
    "name": "GitLab OAuth Route Test",
}


@pytest.fixture
def gitlab_oauth_user() -> dict[str, str]:
    """Create the parent user needed by the integration OAuth state foreign key."""
    now = int(time.time())

    with db_session() as db:
        existing_user = db.scalar(
            select(User).where(User.user_id == TEST_USER["user_id"])
        )
        if existing_user is None:
            db.add(
                User(
                    user_id=TEST_USER["user_id"],
                    google_sub="gitlab-oauth-route-test-subject",
                    email=TEST_USER["email"],
                    email_verified=True,
                    name=TEST_USER["name"],
                    picture=None,
                    created_at=now,
                    updated_at=now,
                )
            )

    return TEST_USER


@pytest.fixture
def client(gitlab_oauth_user: dict[str, str]) -> TestClient:
    async def override_current_user() -> dict[str, str]:
        return gitlab_oauth_user

    app.dependency_overrides[current_user] = override_current_user
    with TestClient(app, follow_redirects=False) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _s256_challenge(code_verifier: str) -> str:
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _start_gitlab_login(client: TestClient) -> tuple[str, str, dict[str, list[str]]]:
    response = client.get("/v1/auth/gitlab/login")

    assert response.status_code == 303, response.text
    assert "gitlab.com/oauth/authorize" in response.headers["location"]
    assert client.cookies.get("gitlab_integration_oauth")

    query = parse_qs(urlparse(response.headers["location"]).query)
    state = query["state"][0]
    return state, response.headers["location"], query


def test_gitlab_login_requires_authenticated_user() -> None:
    app.dependency_overrides.clear()

    with TestClient(app, follow_redirects=False) as unauthenticated_client:
        response = unauthenticated_client.get("/v1/auth/gitlab/login")

    assert response.status_code in {401, 403}


def test_gitlab_login_redirect_uses_mandatory_s256_pkce(
    client: TestClient,
) -> None:
    state, location, query = _start_gitlab_login(client)
    parsed = urlparse(location)

    with db_session() as db:
        stored_state = db.scalar(
            select(IntegrationOAuthState).where(IntegrationOAuthState.state == state)
        )

    assert stored_state is not None
    assert stored_state.user_id == TEST_USER["user_id"]
    assert stored_state.provider == GITLAB_PROVIDER
    assert stored_state.expires_at > int(time.time())
    assert isinstance(stored_state.code_verifier, str)
    assert stored_state.code_verifier

    assert parsed.scheme == "https"
    assert parsed.netloc == "gitlab.com"
    assert parsed.path == "/oauth/authorize"
    assert query["client_id"]
    assert query["redirect_uri"]
    assert query["scope"] == ["read_user"]
    assert query["state"] == [state]
    assert query["response_type"] == ["code"]
    assert query["code_challenge_method"] == ["S256"]
    assert query["code_challenge"] == [_s256_challenge(stored_state.code_verifier)]

    assert stored_state.code_verifier not in location
    assert "code_verifier" not in query
    assert "client_secret" not in query
    assert "access_token" not in query
    assert "refresh_token" not in query
    assert "cookie_nonce" not in query


def test_gitlab_login_sets_scoped_http_only_callback_cookie(
    client: TestClient,
) -> None:
    response = client.get("/v1/auth/gitlab/login")
    set_cookie = response.headers["set-cookie"].lower()

    assert "gitlab_integration_oauth=" in set_cookie
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie
    assert "path=/v1/auth/gitlab" in set_cookie
    assert "max-age=" in set_cookie


@respx.mock
def test_gitlab_callback_exchanges_pkce_fetches_identity_and_encrypts_tokens(
    client: TestClient,
) -> None:
    from app.core.config import settings

    state, _location, _query = _start_gitlab_login(client)
    with db_session() as db:
        stored_state = db.scalar(
            select(IntegrationOAuthState).where(IntegrationOAuthState.state == state)
        )
        assert stored_state is not None
        code_verifier = stored_state.code_verifier

    assert isinstance(code_verifier, str)
    raw_access_token = "test-gitlab-access-token-not-a-real-secret"
    raw_refresh_token = "test-gitlab-refresh-token-not-a-real-secret"
    before_callback = int(time.time())

    token_route = respx.post(settings.GITLAB_TOKEN_URL).mock(
        return_value=Response(
            200,
            json={
                "access_token": raw_access_token,
                "refresh_token": raw_refresh_token,
                "expires_in": 3600,
                "scope": "read_user",
                "token_type": "Bearer",
            },
        )
    )
    user_route = respx.get(settings.GITLAB_USER_URL).mock(
        return_value=Response(200, json={"username": "gitlab-octocat"})
    )

    response = client.get(
        "/v1/auth/gitlab/callback",
        params={"code": "test-authorization-code", "state": state},
    )

    assert response.status_code == 303
    assert response.headers["location"].startswith("http://localhost:3000/")
    assert "integration=gitlab" in response.headers["location"]
    assert "connected=1" in response.headers["location"]
    assert token_route.called
    assert user_route.called

    token_request = parse_qs(token_route.calls[0].request.content.decode("utf-8"))
    assert token_request["client_id"] == [settings.GITLAB_OAUTH_CLIENT_ID]
    assert token_request["client_secret"] == [settings.GITLAB_OAUTH_CLIENT_SECRET]
    assert token_request["redirect_uri"] == [settings.GITLAB_OAUTH_REDIRECT_URI]
    assert token_request["grant_type"] == ["authorization_code"]
    assert token_request["code"] == ["test-authorization-code"]
    assert token_request["code_verifier"] == [code_verifier]

    assert (
        user_route.calls[0].request.headers["authorization"]
        == f"Bearer {raw_access_token}"
    )

    with db_session() as db:
        integration = db.scalar(
            select(UserIntegration).where(
                UserIntegration.user_id == TEST_USER["user_id"],
                UserIntegration.provider == GITLAB_PROVIDER,
            )
        )

    assert integration is not None
    assert integration.username == "gitlab-octocat"
    assert integration.scopes == "read_user"
    assert integration.access_token_ciphertext != raw_access_token
    assert integration.refresh_token_ciphertext != raw_refresh_token
    assert integration.token_expires_at is not None
    assert before_callback + 3590 <= integration.token_expires_at <= int(time.time()) + 3610

    set_cookie = response.headers["set-cookie"].lower()
    assert "gitlab_integration_oauth=" in set_cookie
    assert "max-age=0" in set_cookie or "expires=" in set_cookie


@respx.mock
def test_gitlab_callback_invalid_cookie_does_not_call_gitlab(
    client: TestClient,
) -> None:
    from app.core.config import settings

    state, _location, _query = _start_gitlab_login(client)
    client.cookies.set(
        "gitlab_integration_oauth",
        "tampered.callback.cookie",
        path="/v1/auth/gitlab",
    )

    token_route = respx.post(settings.GITLAB_TOKEN_URL).mock(return_value=Response(500))
    user_route = respx.get(settings.GITLAB_USER_URL).mock(return_value=Response(500))

    response = client.get(
        "/v1/auth/gitlab/callback",
        params={"code": "code", "state": state},
    )

    assert response.status_code == 303
    assert "connected=0" in response.headers["location"]
    assert not token_route.called
    assert not user_route.called


@respx.mock
def test_gitlab_callback_state_replay_fails_before_second_exchange(
    client: TestClient,
) -> None:
    from app.core.config import settings

    state, _location, _query = _start_gitlab_login(client)
    token_route = respx.post(settings.GITLAB_TOKEN_URL).mock(
        return_value=Response(200, json={"access_token": "test-access-token"})
    )
    user_route = respx.get(settings.GITLAB_USER_URL).mock(
        return_value=Response(200, json={"username": "gitlab-octocat"})
    )

    first_response = client.get(
        "/v1/auth/gitlab/callback",
        params={"code": "first-code", "state": state},
    )
    assert first_response.status_code == 303
    assert "connected=1" in first_response.headers["location"]
    assert token_route.call_count == 1
    assert user_route.call_count == 1

    second_response = client.get(
        "/v1/auth/gitlab/callback",
        params={"code": "second-code", "state": state},
    )
    assert second_response.status_code == 303
    assert "connected=0" in second_response.headers["location"]
    assert token_route.call_count == 1
    assert user_route.call_count == 1


@respx.mock
def test_gitlab_callback_provider_error_skips_token_exchange(
    client: TestClient,
) -> None:
    from app.core.config import settings

    _start_gitlab_login(client)
    token_route = respx.post(settings.GITLAB_TOKEN_URL).mock(return_value=Response(500))

    response = client.get(
        "/v1/auth/gitlab/callback",
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


def test_gitlab_callback_redirect_never_reflects_callback_values(
    client: TestClient,
) -> None:
    response = client.get(
        "/v1/auth/gitlab/callback",
        params={
            "error": "access_denied",
            "error_description": "sensitive-text",
            "state": "attacker-controlled-state",
            "redirect_uri": "https://attacker.example/callback",
            "code_verifier": "attacker-controlled-verifier",
        },
    )

    assert response.status_code == 303
    assert response.headers["location"].startswith("http://localhost:3000/")
    assert "attacker.example" not in response.headers["location"]
    assert "sensitive-text" not in response.headers["location"]
    assert "attacker-controlled-state" not in response.headers["location"]
    assert "attacker-controlled-verifier" not in response.headers["location"]
    assert f"integration={GITLAB_PROVIDER}" in response.headers["location"]
