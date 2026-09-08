"""
Authenticated pending-action approval and integration disconnect routes.

GitHub OAuth callbacks are completed only through GET /v1/auth/github/callback.
This API does not accept OAuth authorization codes, state values, redirect URIs,
provider tokens, client IDs, client secrets, refresh tokens, or PKCE verifiers.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from app.auth.dependencies import current_user
from app.core.logging import log_event
from app.core.rate_limit import check_rate_limit
from app.schemas import ActionRequest
from app.services.github_oauth_service import (
    GitHubOAuthError,
    delete_user_integration,
)
from app.services.pending_actions_service import handle_pending_action

router = APIRouter(prefix="/v1/actions", tags=["actions"])


async def _disconnect_integration(
    *,
    provider: str,
    user_id: str,
    trace_id: str,
) -> JSONResponse:
    """
    Delete only the authenticated user's local integration record.

    GitHub token revocation at the provider is not claimed here.
    """
    if provider != "github":
        raise HTTPException(
            status_code=400,
            detail="Unsupported integration provider",
        )

    try:
        deleted = await delete_user_integration(
            user_id=user_id,
            provider=provider,
        )
    except GitHubOAuthError:
        raise HTTPException(
            status_code=500,
            detail="Integration disconnect failed",
        ) from None

    log_event(
        logging.INFO,
        "integration_disconnect",
        provider=provider,
        user_id=user_id,
        deleted=deleted,
        trace_id=trace_id,
    )

    return JSONResponse(
        status_code=200,
        content={
            "provider": provider,
            "connected": False,
        },
    )


@router.post("")
async def actions(
    body: ActionRequest,
    request: Request,
    user: dict[str, Any] = Depends(current_user),
) -> JSONResponse:
    """
    Process authenticated pending-action approval or integration disconnect.

    OAuth callback handling is intentionally absent from this endpoint.
    """
    trace_id = str(uuid.uuid4())
    user_id = user["user_id"]

    check_rate_limit(
        request=request,
        user_id=user_id,
        route="actions",
    )

    if body.action == "action_pending":
        if not body.action_id or not body.decision:
            raise HTTPException(
                status_code=422,
                detail="action_id and decision are required",
            )

        result = await handle_pending_action(
            action_id=body.action_id,
            decision=body.decision,
            user_id=user_id,
            trace_id=trace_id,
        )

        return JSONResponse(
            status_code=200,
            content=result,
        )

    if body.action == "disconnect_integration":
        if not body.provider:
            raise HTTPException(
                status_code=422,
                detail="provider is required",
            )

        return await _disconnect_integration(
            provider=body.provider,
            user_id=user_id,
            trace_id=trace_id,
        )

    raise HTTPException(
        status_code=400,
        detail="Unsupported action",
    )
