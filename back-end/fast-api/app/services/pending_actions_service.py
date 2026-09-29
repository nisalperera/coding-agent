"""
Human-in-the-loop approval workflow for risky tool calls.

Pending actions are persisted through the application database repository.
Provider credentials are never stored in pending-action payloads. When an
approved provider tool executes, app.tools.dispatch resolves the credential
only from the authenticated action owner's encrypted integration record.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any

from fastapi import HTTPException

from app.core.logging import log_event
from app.db.pending_actions_repository import (
    create_pending_action,
    delete_pending_action,
    get_pending_action,
)
from app.schemas import ActionRequest
from app.tools.dispatch import ProviderNotConnectedError, call_tool

_FORBIDDEN_PENDING_ACTION_ARGUMENTS = frozenset(
    {
        "github_token",
        "gitlab_token",
        "access_token",
        "refresh_token",
        "client_secret",
        "code",
        "state",
        "code_verifier",
    }
)


def _validate_pending_action_arguments(args: dict[str, Any]) -> None:
    """
    Reject credentials and OAuth callback material from pending-action input.

    Chat request schemas and dispatch.py already provide primary protection.
    This check protects the persistence boundary against stale records, future
    callers, CLI callers, and direct service invocation.
    """
    if not isinstance(args, dict):
        raise TypeError("Pending-action arguments must be an object")

    forbidden_arguments = _FORBIDDEN_PENDING_ACTION_ARGUMENTS.intersection(args)
    if forbidden_arguments:
        raise ValueError(
            "Credential and OAuth callback arguments are not accepted in pending actions"
        )


async def create_pending_action_record(
    user_id: str,
    tool_name: str,
    args: dict[str, Any],
    trace_id: str,
) -> str:
    """
    Create an authenticated user-owned pending action without credentials.

    The action is later retrieved and authorized against the same user ID
    before an approval decision can be applied.
    """
    if not isinstance(user_id, str) or not user_id:
        raise ValueError("Authenticated user ID is required")

    if not isinstance(tool_name, str) or not tool_name:
        raise ValueError("Tool name is required")

    _validate_pending_action_arguments(args)

    action_id = str(uuid.uuid4())
    await asyncio.to_thread(
        create_pending_action,
        action_id,
        user_id,
        tool_name,
        args,
    )

    log_event(
        logging.INFO,
        "pending_action_created",
        user_id=user_id,
        tool=tool_name,
        trace_id=trace_id,
    )
    return action_id


async def handle_pending_action(
    body: ActionRequest,
    user_id: str,
    trace_id: str,
) -> dict[str, Any]:
    """
    Approve or deny a user-owned pending action.

    A risky provider tool receives credentials only after the pending action is
    authenticated, ownership-checked, unexpired, and explicitly approved.
    Provider token resolution remains inside `call_tool()` and is always bound
    to the authenticated pending-action owner.
    """
    if not body.action_id or body.decision not in {"approve", "deny"}:
        raise HTTPException(
            status_code=400,
            detail="action_id and decision are required",
        )

    item = await asyncio.to_thread(get_pending_action, body.action_id)
    if not item or item["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    if int(item["expires_at"]) < int(time.time()):
        await asyncio.to_thread(delete_pending_action, body.action_id)
        raise HTTPException(status_code=410, detail="Pending action has expired")

    result: dict[str, Any] = {}
    try:
        if body.decision == "deny":
            result: dict[str, Any] = {
                "result": "User denied this action.",
            }
        else:
            try:
                _validate_pending_action_arguments(item["args"])

                tool_result = await call_tool(
                    item["tool_name"],
                    item["args"],
                    user_id,
                )
            except ProviderNotConnectedError as exc:
                log_event(
                    logging.INFO,
                    "provider_not_connected",
                    provider=exc.provider,
                    tool=item["tool_name"],
                    user_id=user_id,
                    trace_id=trace_id,
                )
                result = {
                    "error": "provider_not_connected",
                    "provider": exc.provider,
                }
            except (ValueError, RuntimeError, OSError):
                log_event(
                    logging.ERROR,
                    "pending_action_execution_failed",
                    tool=item["tool_name"],
                    user_id=user_id,
                    trace_id=trace_id,
                )
                result = {
                    "error": "tool_execution_failed",
                }
            else:
                result = {
                    "result": str(tool_result),
                }
    finally:
        await asyncio.to_thread(delete_pending_action, body.action_id)

    log_event(
        logging.INFO,
        "pending_action_resolved",
        user_id=user_id,
        decision=body.decision,
        trace_id=trace_id,
    )
    return result