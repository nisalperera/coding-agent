"""
Authenticated pending-action approval and integration disconnect routes.

GitHub and GitLab OAuth callbacks are completed only through their server-owned
GET callback routes. This API does not accept OAuth authorization codes, state
values, redirect URIs, provider tokens, client IDs, client secrets, refresh
tokens, or PKCE verifiers.
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
    GITHUB_PROVIDER,
    GitHubOAuthError,
)
from app.services.github_oauth_service import (
    delete_user_integration as delete_github_user_integration,
)
from app.services.gitlab_oauth_service import (
    GITLAB_PROVIDER,
    GitLabOAuthError,
)
from app.services.gitlab_oauth_service import (
    delete_user_integration as delete_gitlab_user_integration,
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

    This removes locally persisted encrypted credentials. It does not claim
    provider-side OAuth token revocation.
    """
    if provider == GITHUB_PROVIDER:
        try:
            deleted = await delete_github_user_integration(
                user_id=user_id,
                provider=provider,
            )
        except GitHubOAuthError:
            raise HTTPException(
                status_code=500,
                detail="Integration disconnect failed",
            ) from None
    elif provider == GITLAB_PROVIDER:
        try:
            deleted = await delete_gitlab_user_integration(
                user_id=user_id,
                provider=provider,
            )
        except GitLabOAuthError:
            raise HTTPException(
                status_code=500,
                detail="Integration disconnect failed",
            ) from None
    else:
        raise HTTPException(
            status_code=400,
            detail="Unsupported integration provider",
        )

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
        # request=request,
        user_id=user_id,
        # route="actions",
    )

    if body.action == "action_pending":
        result = await handle_pending_action(
            body=body,
            user_id=user_id,
            trace_id=trace_id,
        )

        return JSONResponse(
            status_code=200,
            content=result,
        )

    if body.action == "disconnect_integration":
        return await _disconnect_integration(
            provider=body.provider,
            user_id=user_id,
            trace_id=trace_id,
        )

    raise HTTPException(
        status_code=400,
        detail="Unsupported action",
    )