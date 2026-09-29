from __future__ import annotations

import time
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
import respx
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.auth.dependencies import current_user
from app.db.database import db_session
from app.db.models import User
from app.services.github_oauth_service import GitHubOAuthError
from app.tools import dispatch
from app.tools.dispatch import ProviderNotConnectedError
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


class FakeResponse:
    """Small httpx-like response double for OAuth service tests."""

    def __init__(
        self,
        payload: dict[str, Any],
        *,
        status_code: int = 200,
    ) -> None:
        self._payload = payload
        self.status_code = status_code

    def json(self) -> dict[str, Any]:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("POST", "https://example.invalid")
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError(
                f"HTTP {self.status_code}",
                request=request,
                response=response,
            )


class FakeGitHubClient:
    """Async HTTP client double that records requests without network access."""

    def __init__(
        self,
        *,
        token_response: FakeResponse | None = None,
        user_response: FakeResponse | None = None,
    ) -> None:
        self.token_response = token_response or FakeResponse(
            {"access_token": "test-access-token"}
        )
        self.user_response = user_response or FakeResponse({"login": "octocat"})
        self.post_calls: list[dict[str, Any]] = []
        self.get_calls: list[dict[str, Any]] = []

    async def post(self, url: str, **kwargs: Any) -> FakeResponse:
        self.post_calls.append({"url": url, **kwargs})
        return self.token_response

    async def get(self, url: str, **kwargs: Any) -> FakeResponse:
        self.get_calls.append({"url": url, **kwargs})
        return self.user_response


@pytest.mark.asyncio
async def test_dispatch_requires_connected_github(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    called = False

    async def missing_integration(user_id: str) -> str:
        raise GitHubOAuthError("credentials unavailable")

    async def fake_github_tool(**kwargs: Any) -> dict[str, bool]:
        nonlocal called
        called = True
        return {"ok": True}

    monkeypatch.setattr(
        dispatch,
        "get_github_access_token",
        missing_integration,
    )
    monkeypatch.setitem(
        dispatch.FUNCS,
        "github_list_repositories",
        fake_github_tool,
    )
    monkeypatch.setattr(
        dispatch,
        "GITHUB_TOOL_NAMES",
        {"github_list_repositories"},
    )

    with pytest.raises(ProviderNotConnectedError) as exc_info:
        await dispatch.call_repo_tool(
            "github_list_repositories",
            {},
            "00000000-0000-0000-0000-000000000106",
        )

    assert exc_info.value.provider == "github"
    assert called is False


@pytest.mark.asyncio
async def test_dispatch_passes_token_only_to_internal_tool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    received_kwargs: dict[str, Any] = {}

    async def connected_integration(user_id: str) -> str:
        return "test-access-token"

    async def fake_github_tool(**kwargs: Any) -> dict[str, bool]:
        received_kwargs.update(kwargs)
        return {"ok": True}

    monkeypatch.setattr(
        dispatch,
        "get_github_access_token",
        connected_integration,
    )
    monkeypatch.setitem(
        dispatch.FUNCS,
        "github_list_repositories",
        fake_github_tool,
    )
    monkeypatch.setattr(
        dispatch,
        "GITHUB_TOOL_NAMES",
        {"github_list_repositories"},
    )

    result = await dispatch.call_repo_tool(
        "github_list_repositories",
        {"owner": "octocat"},
        "00000000-0000-0000-0000-000000000107",
    )

    assert result == {"ok": True}
    assert received_kwargs["owner"] == "octocat"
    assert received_kwargs["github_token"] == "test-access-token"
    assert "test-access-token" not in str(result)


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


@respx.mock
def test_github_callback_storage_failure_redirects_safely(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.api import integration as integration_api
    from app.core.config import settings
    from app.services.github_oauth_service import GitHubOAuthError

    state = _start_github_login(client)

    token_route = respx.post(settings.GITHUB_TOKEN_URL).mock(
        return_value=httpx.Response(
            200,
            json={"access_token": "test-access-token"},
        )
    )
    user_route = respx.get(settings.GITHUB_USER_URL).mock(
        return_value=httpx.Response(
            200,
            json={"login": "octocat"},
        )
    )

    async def failing_store_github_integration(
        *,
        user_id: str,
        access_token: str,
        username: str,
    ) -> None:
        raise GitHubOAuthError("test-only storage failure")

    monkeypatch.setattr(
        integration_api,
        "store_github_integration",
        failing_store_github_integration,
    )

    response = client.get(
        "/v1/auth/github/callback",
        params={
            "code": "test-code",
            "state": state,
        },
    )

    assert response.status_code == 303
    assert response.headers["location"].startswith("http://localhost:3000/")
    assert "integration=github" in response.headers["location"]
    assert "connected=0" in response.headers["location"]

    assert token_route.called
    assert user_route.called

    assert "test-only" not in response.headers["location"]
    assert "storage" not in response.headers["location"].lower()

    set_cookie = response.headers["set-cookie"].lower()
    assert "github_integration_oauth=" in set_cookie
    assert "max-age=0" in set_cookie or "expires=" in set_cookie
