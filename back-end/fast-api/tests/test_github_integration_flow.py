from __future__ import annotations

from typing import Any

import httpx
import pytest

from app.core.crypto import TokenEncryptionError
from app.services import github_oauth_service
from app.services.github_oauth_service import GitHubOAuthError
from app.tools import dispatch


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
async def test_callback_requires_code_without_network(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = FakeGitHubClient()

    status, payload = await github_oauth_service.handle_github_oauth_callback(
        client,
        {"redirect_uri": "http://localhost:8000/callback"},
        "00000000-0000-0000-0000-000000000101",
    )

    assert status == 400
    assert payload == {"error": "missing_github_oauth_code"}
    assert client.post_calls == []
    assert client.get_calls == []


@pytest.mark.asyncio
async def test_callback_requires_redirect_uri_without_network(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = FakeGitHubClient()

    status, payload = await github_oauth_service.handle_github_oauth_callback(
        client,
        {"code": "test-code"},
        "00000000-0000-0000-0000-000000000102",
    )

    assert status == 400
    assert payload == {"error": "missing_github_oauth_redirect_uri"}
    assert client.post_calls == []
    assert client.get_calls == []


@pytest.mark.asyncio
async def test_callback_stores_token_and_returns_public_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored: dict[str, str] = {}

    def fake_store(user_id: str, access_token: str, username: str) -> None:
        stored["user_id"] = user_id
        stored["access_token"] = access_token
        stored["username"] = username

    monkeypatch.setattr(github_oauth_service, "_store_github_integration", fake_store)
    client = FakeGitHubClient()

    status, payload = await github_oauth_service.handle_github_oauth_callback(
        client,
        {
            "code": "test-code",
            "redirect_uri": "http://localhost:8000/callback",
        },
        "00000000-0000-0000-0000-000000000103",
    )

    assert status == 200
    assert payload == {
        "connected": True,
        "provider": "github",
        "username": "octocat",
    }
    assert stored == {
        "user_id": "00000000-0000-0000-0000-000000000103",
        "access_token": "test-access-token",
        "username": "octocat",
    }
    assert len(client.post_calls) == 1
    assert len(client.get_calls) == 1
    assert "access_token" not in payload
    assert "test-access-token" not in str(payload)


@pytest.mark.asyncio
async def test_callback_hides_provider_error_details() -> None:
    client = FakeGitHubClient(
        token_response=FakeResponse(
            {"error": "bad_verification_code"},
            status_code=400,
        )
    )

    status, payload = await github_oauth_service.handle_github_oauth_callback(
        client,
        {
            "code": "bad-code",
            "redirect_uri": "http://localhost:8000/callback",
        },
        "00000000-0000-0000-0000-000000000104",
    )

    assert status == 400
    assert payload == {"error": "github_oauth_failed"}
    assert "bad_verification_code" not in str(payload)


@pytest.mark.asyncio
async def test_callback_hides_storage_error_details(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def failing_store(user_id: str, access_token: str, username: str) -> None:
        raise TokenEncryptionError("test-only encryption failure")

    monkeypatch.setattr(
        github_oauth_service,
        "_store_github_integration",
        failing_store,
    )
    client = FakeGitHubClient()

    status, payload = await github_oauth_service.handle_github_oauth_callback(
        client,
        {
            "code": "test-code",
            "redirect_uri": "http://localhost:8000/callback",
        },
        "00000000-0000-0000-0000-000000000105",
    )

    assert status == 500
    assert payload == {"error": "github_integration_storage_failed"}
    assert "encryption failure" not in str(payload)


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

    result = await dispatch.call_repo_tool(
    "github_list_repositories",
    {},
    "00000000-0000-0000-0000-000000000106",
)

    assert result == {
        "error": "github_integration_required",
        "message": "Connect your GitHub account before using GitHub repository tools.",
    }
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
