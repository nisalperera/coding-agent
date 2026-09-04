"""
Human-in-the-loop approval workflow for risky tool calls (write_file,
run_shell, github_*, gitlab_*), backed by SQLite instead of DynamoDB.

The `gitlab_token` passthrough has been removed: call_tool() now always
resolves provider credentials itself from the encrypted integration store
(see app/tools/dispatch.py), so no raw provider token ever needs to travel
through the pending-action approval payload.
"""
import asyncio
import logging
import time
import uuid
from typing import Any

from fastapi import HTTPException

from app.core.logging import log_event
from app.db.pending_actions_repository import create_pending_action, delete_pending_action, get_pending_action
from app.schemas import ActionRequest
from app.tools.dispatch import call_tool


async def create_pending_action_record(user_id: str, tool_name: str, args: dict[str, Any], trace_id: str) -> str:
    action_id = str(uuid.uuid4())
    await asyncio.to_thread(create_pending_action, action_id, user_id, tool_name, args)
    log_event(logging.INFO, "pending_action_created", user_id=user_id, tool=tool_name, trace_id=trace_id)
    return action_id


async def handle_pending_action(body: ActionRequest, user_id: str, trace_id: str) -> dict[str, Any]:
    if not body.action_id or body.decision not in {"approve", "deny"}:
        raise HTTPException(status_code=400, detail="action_id and decision are required")

    item = await asyncio.to_thread(get_pending_action, body.action_id)
    if not item or item["user_id"] != user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    if int(item["expires_at"]) < int(time.time()):
        await asyncio.to_thread(delete_pending_action, body.action_id)
        raise HTTPException(status_code=410, detail="Pending action has expired")

    try:
        if body.decision == "approve":
            result = await call_tool(item["tool_name"], item["args"], user_id)
        else:
            result = "User denied this action."
    finally:
        await asyncio.to_thread(delete_pending_action, body.action_id)

    log_event(logging.INFO, "pending_action_resolved", user_id=user_id, decision=body.decision, trace_id=trace_id)
    return {"result": str(result)}