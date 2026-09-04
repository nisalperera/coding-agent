"""
Non-streaming "action" endpoints: approve/deny a pending risky tool call,
complete the GitHub OAuth callback, and disconnect a stored integration.
"""
import asyncio
import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from app.auth.dependencies import current_user
from app.core.logging import log_event
from app.core.rate_limit import check_rate_limit
from app.schemas import ActionRequest
from app.services.github_oauth_service import delete_user_integration, handle_github_oauth_callback
from app.services.pending_actions_service import handle_pending_action

router = APIRouter(prefix="/v1/actions", tags=["actions"])


async def _handle_github_callback(request: Request, body: ActionRequest, user_id: str, trace_id: str) -> dict[str, Any]:
    payload = body.model_dump(exclude_none=True)
    status_code, result = await handle_github_oauth_callback(request.app.state.http_client, payload, user_id)
    log_event(logging.INFO, "github_oauth_callback", user_id=user_id, status_code=status_code, trace_id=trace_id)
    if status_code >= 400:
        raise HTTPException(status_code=status_code, detail=result)
    return result


async def _handle_disconnect_integration(body: ActionRequest, user_id: str, trace_id: str) -> dict[str, Any]:
    if body.provider == "github":
        await delete_user_integration(user_id, "github")
        log_event(logging.INFO, "integration_disconnected", user_id=user_id, provider="github", trace_id=trace_id)
        return {"disconnected": True, "provider": "github"}
    return {"disconnected": True, "provider": body.provider, "server_side": False}


@router.post("")
async def actions(body: ActionRequest, request: Request, user: dict[str, Any] = Depends(current_user)) -> JSONResponse:
    trace_id = str(uuid.uuid4())
    user_id = user["user_id"]

    if not check_rate_limit(user_id):
        log_event(logging.WARNING, "rate_limit_exceeded", user_id=user_id, trace_id=trace_id)
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

    if body.action == "action_pending":
        result = await handle_pending_action(body, user_id, trace_id)
    elif body.action == "github_oauth_callback":
        result = await _handle_github_callback(request, body, user_id, trace_id)
    elif body.action == "disconnect_integration":
        result = await _handle_disconnect_integration(body, user_id, trace_id)
    else:
        raise HTTPException(status_code=400, detail="Unknown action")

    return JSONResponse(result)
