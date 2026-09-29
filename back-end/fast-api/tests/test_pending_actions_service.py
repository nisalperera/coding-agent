from __future__ import annotations

import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.services import pending_actions_service
from app.tools.dispatch import ProviderNotConnectedError


def _action_request(
    *,
    action_id: str = "action-1",
    decision: str = "approve",
) -> SimpleNamespace:
    return SimpleNamespace(
        action="action_pending",
        action_id=action_id,
        decision=decision,
    )


@pytest.mark.asyncio
async def test_create_pending_action_rejects_provider_token_arguments() -> None:
    with pytest.raises(ValueError):
        await pending_actions_service.create_pending_action_record(
            user_id="user-1",
            tool_name="github_create_issue",
            args={
                "owner": "example-owner",
                "repo": "example-repo",
                "title": "Issue",
                "github_token": "browser-supplied-value",
            },
            trace_id="trace-1",
        )


@pytest.mark.asyncio
async def test_owner_approval_dispatches_with_action_owner_user_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    item = {
        "user_id": "owner-user",
        "tool_name": "github_create_issue",
        "args": {
            "owner": "example-owner",
            "repo": "example-repo",
            "title": "Issue",
        },
        "expires_at": int(time.time()) + 60,
    }
    observed: dict[str, object] = {}

    monkeypatch.setattr(
        pending_actions_service,
        "get_pending_action",
        lambda _: item,
    )
    monkeypatch.setattr(
        pending_actions_service,
        "delete_pending_action",
        lambda _: True,
    )

    async def fake_call_tool(
        tool_name: str,
        args: dict[str, object],
        user_id: str,
    ) -> str:
        observed["tool_name"] = tool_name
        observed["args"] = args
        observed["user_id"] = user_id
        return "approved tool completed"

    monkeypatch.setattr(
        pending_actions_service,
        "call_tool",
        fake_call_tool,
    )

    result = await pending_actions_service.handle_pending_action(
        _action_request(),
        user_id="owner-user",
        trace_id="trace-1",
    )

    assert result == {"result": "approved tool completed"}
    assert observed == {
        "tool_name": "github_create_issue",
        "args": {
            "owner": "example-owner",
            "repo": "example-repo",
            "title": "Issue",
        },
        "user_id": "owner-user",
    }


@pytest.mark.asyncio
async def test_non_owner_cannot_approve_pending_action(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    item = {
        "user_id": "owner-user",
        "tool_name": "github_create_issue",
        "args": {
            "owner": "example-owner",
            "repo": "example-repo",
            "title": "Issue",
        },
        "expires_at": int(time.time()) + 60,
    }
    call_tool_mock = AsyncMock()

    monkeypatch.setattr(
        pending_actions_service,
        "get_pending_action",
        lambda _: item,
    )
    monkeypatch.setattr(
        pending_actions_service,
        "call_tool",
        call_tool_mock,
    )

    with pytest.raises(HTTPException) as exc_info:
        await pending_actions_service.handle_pending_action(
            _action_request(),
            user_id="other-user",
            trace_id="trace-1",
        )

    assert exc_info.value.status_code == 403
    call_tool_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_expired_pending_action_is_deleted_and_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    item = {
        "user_id": "owner-user",
        "tool_name": "github_create_issue",
        "args": {
            "owner": "example-owner",
            "repo": "example-repo",
            "title": "Issue",
        },
        "expires_at": int(time.time()) - 1,
    }
    deleted_action_ids: list[str] = []

    monkeypatch.setattr(
        pending_actions_service,
        "get_pending_action",
        lambda _: item,
    )
    monkeypatch.setattr(
        pending_actions_service,
        "delete_pending_action",
        lambda action_id: deleted_action_ids.append(action_id) or True,
    )

    with pytest.raises(HTTPException) as exc_info:
        await pending_actions_service.handle_pending_action(
            _action_request(action_id="expired-action"),
            user_id="owner-user",
            trace_id="trace-1",
        )

    assert exc_info.value.status_code == 410
    assert deleted_action_ids == ["expired-action"]


@pytest.mark.asyncio
async def test_denied_pending_action_is_deleted_without_tool_execution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    item = {
        "user_id": "owner-user",
        "tool_name": "github_create_issue",
        "args": {
            "owner": "example-owner",
            "repo": "example-repo",
            "title": "Issue",
        },
        "expires_at": int(time.time()) + 60,
    }
    call_tool_mock = AsyncMock()
    deleted_action_ids: list[str] = []

    monkeypatch.setattr(
        pending_actions_service,
        "get_pending_action",
        lambda _: item,
    )
    monkeypatch.setattr(
        pending_actions_service,
        "delete_pending_action",
        lambda action_id: deleted_action_ids.append(action_id) or True,
    )
    monkeypatch.setattr(
        pending_actions_service,
        "call_tool",
        call_tool_mock,
    )

    result = await pending_actions_service.handle_pending_action(
        _action_request(decision="deny"),
        user_id="owner-user",
        trace_id="trace-1",
    )

    assert result == {"result": "User denied this action."}
    assert deleted_action_ids == ["action-1"]
    call_tool_mock.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["github", "gitlab"])
async def test_provider_not_connected_returns_normalized_result_and_deletes_action(
    monkeypatch: pytest.MonkeyPatch,
    provider: str,
) -> None:
    item = {
        "user_id": "owner-user",
        "tool_name": f"{provider}_create_issue",
        "args": (
            {
                "owner": "example-owner",
                "repo": "example-repo",
                "title": "Issue",
            }
            if provider == "github"
            else {
                "project_id": "group/project",
                "title": "Issue",
            }
        ),
        "expires_at": int(time.time()) + 60,
    }
    deleted_action_ids: list[str] = []

    monkeypatch.setattr(
        pending_actions_service,
        "get_pending_action",
        lambda _: item,
    )
    monkeypatch.setattr(
        pending_actions_service,
        "delete_pending_action",
        lambda action_id: deleted_action_ids.append(action_id) or True,
    )

    async def provider_not_connected(
        tool_name: str,
        args: dict[str, object],
        user_id: str,
    ) -> str:
        raise ProviderNotConnectedError(provider)

    monkeypatch.setattr(
        pending_actions_service,
        "call_tool",
        provider_not_connected,
    )

    result = await pending_actions_service.handle_pending_action(
        _action_request(),
        user_id="owner-user",
        trace_id="trace-1",
    )

    assert result == {
        "error": "provider_not_connected",
        "provider": provider,
    }
    assert deleted_action_ids == ["action-1"]


@pytest.mark.asyncio
async def test_legacy_token_bearing_pending_action_is_not_executed_and_is_deleted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    item = {
        "user_id": "owner-user",
        "tool_name": "gitlab_create_issue",
        "args": {
            "project_id": "group/project",
            "title": "Issue",
            "gitlab_token": "legacy-persisted-value",
        },
        "expires_at": int(time.time()) + 60,
    }
    call_tool_mock = AsyncMock()
    deleted_action_ids: list[str] = []

    monkeypatch.setattr(
        pending_actions_service,
        "get_pending_action",
        lambda _: item,
    )
    monkeypatch.setattr(
        pending_actions_service,
        "delete_pending_action",
        lambda action_id: deleted_action_ids.append(action_id) or True,
    )
    monkeypatch.setattr(
        pending_actions_service,
        "call_tool",
        call_tool_mock,
    )

    result = await pending_actions_service.handle_pending_action(
        _action_request(),
        user_id="owner-user",
        trace_id="trace-1",
    )

    assert result == {"error": "tool_execution_failed"}
    assert deleted_action_ids == ["action-1"]
    call_tool_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_generic_pending_action_failure_is_normalized_and_deleted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    item = {
        "user_id": "owner-user",
        "tool_name": "github_create_issue",
        "args": {
            "owner": "example-owner",
            "repo": "example-repo",
            "title": "Issue",
        },
        "expires_at": int(time.time()) + 60,
    }
    deleted_action_ids: list[str] = []

    monkeypatch.setattr(
        pending_actions_service,
        "get_pending_action",
        lambda _: item,
    )
    monkeypatch.setattr(
        pending_actions_service,
        "delete_pending_action",
        lambda action_id: deleted_action_ids.append(action_id) or True,
    )

    async def failing_tool(
        tool_name: str,
        args: dict[str, object],
        user_id: str,
    ) -> str:
        raise RuntimeError("internal implementation detail")

    monkeypatch.setattr(
        pending_actions_service,
        "call_tool",
        failing_tool,
    )

    result = await pending_actions_service.handle_pending_action(
        _action_request(),
        user_id="owner-user",
        trace_id="trace-1",
    )

    assert result == {"error": "tool_execution_failed"}
    assert deleted_action_ids == ["action-1"]