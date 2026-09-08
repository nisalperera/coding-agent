from __future__ import annotations

import pytest

from app.services.github_oauth_service import GitHubOAuthError
from app.services.gitlab_oauth_service import GitLabOAuthError
from app.tools import dispatch
from app.tools.dispatch import ProviderNotConnectedError


@pytest.fixture
def github_tool_name() -> str:
    return next(iter(dispatch.GITHUB_TOOL_NAMES))


@pytest.fixture
def gitlab_tool_name() -> str:
    return next(iter(dispatch.GITLAB_TOOL_NAMES))


@pytest.mark.asyncio
async def test_github_tool_uses_authenticated_users_internal_credential(
    monkeypatch: pytest.MonkeyPatch,
    github_tool_name: str,
) -> None:
    user_id = "user-github"
    expected_token = "test-only-github-credential"
    observed: dict[str, object] = {}

    async def fake_get_github_access_token(received_user_id: str) -> str:
        observed["credential_user_id"] = received_user_id
        return expected_token

    def fake_github_tool(**kwargs: object) -> str:
        observed["tool_kwargs"] = kwargs
        return "github tool completed"

    monkeypatch.setattr(
        dispatch,
        "get_github_access_token",
        fake_get_github_access_token,
    )
    monkeypatch.setitem(
        dispatch.FUNCS,
        github_tool_name,
        fake_github_tool,
    )

    result = await dispatch.call_tool(
        github_tool_name,
        {"owner": "example-owner", "repo": "example-repo", "title": "Issue"},
        user_id,
    )

    assert result == "github tool completed"
    assert observed["credential_user_id"] == user_id
    assert observed["tool_kwargs"] == {
        "owner": "example-owner",
        "repo": "example-repo",
        "title": "Issue",
        "github_token": expected_token,
    }


@pytest.mark.asyncio
async def test_gitlab_tool_uses_authenticated_users_internal_credential(
    monkeypatch: pytest.MonkeyPatch,
    gitlab_tool_name: str,
) -> None:
    user_id = "user-gitlab"
    expected_token = "test-only-gitlab-credential"
    observed: dict[str, object] = {}

    async def fake_get_gitlab_access_token(received_user_id: str) -> str:
        observed["credential_user_id"] = received_user_id
        return expected_token

    def fake_gitlab_tool(**kwargs: object) -> str:
        observed["tool_kwargs"] = kwargs
        return "gitlab tool completed"

    monkeypatch.setattr(
        dispatch,
        "get_gitlab_access_token",
        fake_get_gitlab_access_token,
    )
    monkeypatch.setitem(
        dispatch.FUNCS,
        gitlab_tool_name,
        fake_gitlab_tool,
    )

    result = await dispatch.call_tool(
        gitlab_tool_name,
        {
            "project_id": "group/project",
            "title": "Issue",
        },
        user_id,
    )

    assert result == "gitlab tool completed"
    assert observed["credential_user_id"] == user_id
    assert observed["tool_kwargs"] == {
        "project_id": "group/project",
        "title": "Issue",
        "gitlab_token": expected_token,
    }


@pytest.mark.asyncio
async def test_github_missing_integration_raises_normalized_error(
    monkeypatch: pytest.MonkeyPatch,
    github_tool_name: str,
) -> None:
    async def missing_github_integration(_: str) -> str:
        raise GitHubOAuthError("internal credential lookup detail")

    monkeypatch.setattr(
        dispatch,
        "get_github_access_token",
        missing_github_integration,
    )

    with pytest.raises(ProviderNotConnectedError) as exc_info:
        await dispatch.call_tool(
            github_tool_name,
            {
                "owner": "example-owner",
                "repo": "example-repo",
                "title": "Issue",
            },
            "user-without-github",
        )

    assert exc_info.value.provider == "github"


@pytest.mark.asyncio
async def test_gitlab_missing_integration_raises_normalized_error(
    monkeypatch: pytest.MonkeyPatch,
    gitlab_tool_name: str,
) -> None:
    async def missing_gitlab_integration(_: str) -> str:
        raise GitLabOAuthError("internal credential lookup detail")

    monkeypatch.setattr(
        dispatch,
        "get_gitlab_access_token",
        missing_gitlab_integration,
    )

    with pytest.raises(ProviderNotConnectedError) as exc_info:
        await dispatch.call_tool(
            gitlab_tool_name,
            {
                "project_id": "group/project",
                "title": "Issue",
            },
            "user-without-gitlab",
        )

    assert exc_info.value.provider == "gitlab"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("tool_name", "arguments"),
    [
        (
            "github_create_issue",
            {
                "owner": "example-owner",
                "repo": "example-repo",
                "title": "Issue",
                "github_token": "browser-supplied-value",
            },
        ),
        (
            "gitlab_create_issue",
            {
                "project_id": "group/project",
                "title": "Issue",
                "gitlab_token": "browser-supplied-value",
            },
        ),
        (
            "web_search",
            {
                "query": "example",
                "access_token": "browser-supplied-value",
            },
        ),
    ],
)
async def test_dispatch_rejects_credential_shaped_arguments(
    tool_name: str,
    arguments: dict[str, str],
) -> None:
    with pytest.raises(ValueError):
        await dispatch.call_tool(
            tool_name,
            arguments,
            "authenticated-user",
        )


@pytest.mark.asyncio
async def test_dispatch_uses_only_requested_authenticated_user(
    monkeypatch: pytest.MonkeyPatch,
    github_tool_name: str,
) -> None:
    requested_user_id = "user-a"
    other_user_id = "user-b"
    observed_user_ids: list[str] = []

    async def fake_get_github_access_token(received_user_id: str) -> str:
        observed_user_ids.append(received_user_id)
        if received_user_id != requested_user_id:
            raise AssertionError("Credential lookup used an unexpected user")
        return "test-only-github-credential"

    monkeypatch.setattr(
        dispatch,
        "get_github_access_token",
        fake_get_github_access_token,
    )
    monkeypatch.setitem(
        dispatch.FUNCS,
        github_tool_name,
        lambda **_: "github tool completed",
    )

    result = await dispatch.call_tool(
        github_tool_name,
        {
            "owner": "example-owner",
            "repo": "example-repo",
            "title": "Issue",
        },
        requested_user_id,
    )

    assert result == "github tool completed"
    assert observed_user_ids == [requested_user_id]
    assert other_user_id not in observed_user_ids
