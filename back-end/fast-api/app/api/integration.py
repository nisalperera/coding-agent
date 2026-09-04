"""GitHub and GitLab integration OAuth endpoints.

These are separate from app/api/auth.py (Google login/session) on purpose:
a user must already be logged in (Google session cookie) before linking a
GitHub or GitLab account. Login redirects to the provider; the provider
redirects back here with a code, which is exchanged server-side and stored
encrypted via the existing integrations repository. No provider token is
ever accepted from or returned to the browser.
"""
from __future__ import annotations

from typing import Any, Optional
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse

from app.auth.dependencies import current_user
from app.core.config import settings
from app.core.oauth_state import OAuthStateError, issue_state, verify_state
from app.services import github_oauth_service, gitlab_oauth_service

router = APIRouter(prefix="/v1/integrations", tags=["integrations"])

_SUPPORTED_PROVIDERS = {"github", "gitlab"}


def _http_client(request: Request) -> httpx.AsyncClient:
    return request.app.state.http_client


@router.get("/{provider}/login")
async def integration_login(
    provider: str,
    user: dict[str, Any] = Depends(current_user),
) -> RedirectResponse:
    if provider not in _SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=404, detail="Unknown provider")

    state = issue_state(user["user_id"], provider)

    if provider == "github":
        params = {
            "client_id": settings.GITHUB_OAUTH_CLIENT_ID,
            "redirect_uri": settings.GITHUB_OAUTH_REDIRECT_URI,
            "scope": settings.GITHUB_OAUTH_SCOPES,
            "state": state,
        }
        url = f"{settings.GITHUB_AUTHORIZE_URL}?{urlencode(params)}"
    else:
        params = {
            "client_id": settings.GITLAB_OAUTH_CLIENT_ID,
            "redirect_uri": settings.GITLAB_OAUTH_REDIRECT_URI,
            "response_type": "code",
            "scope": settings.GITLAB_OAUTH_SCOPES,
            "state": state,
        }
        url = f"{settings.GITLAB_AUTHORIZE_URL}?{urlencode(params)}"

    return RedirectResponse(url, status_code=302)


@router.get("/{provider}/callback")
async def integration_callback(
    provider: str,
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
    user: dict[str, Any] = Depends(current_user),
) -> JSONResponse:
    if provider not in _SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=404, detail="Unknown provider")

    try:
        state_user_id = verify_state(state, provider=provider)
    except OAuthStateError as exc:
        return JSONResponse({"error": "invalid_oauth_state", "detail": str(exc)}, status_code=400)

    if state_user_id != user["user_id"]:
        return JSONResponse({"error": "oauth_state_user_mismatch"}, status_code=403)

    client = _http_client(request)

    if provider == "github":
        status_code, payload = await github_oauth_service.handle_github_oauth_callback(
            client,
            {"code": code, "redirect_uri": settings.GITHUB_OAUTH_REDIRECT_URI},
            user["user_id"],
        )
    else:
        status_code, payload = await gitlab_oauth_service.handle_gitlab_oauth_callback(
            client,
            {"code": code, "redirect_uri": settings.GITLAB_OAUTH_REDIRECT_URI},
            user["user_id"],
        )

    return JSONResponse(payload, status_code=status_code)


@router.get("/{provider}/status")
async def integration_status(
    provider: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    if provider not in _SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=404, detail="Unknown provider")

    if provider == "github":
        integration = await github_oauth_service.get_user_integration(user["user_id"], provider)
    else:
        integration = await gitlab_oauth_service.get_user_integration(user["user_id"], provider)

    return {"connected": integration is not None, "integration": integration}


@router.post("/{provider}/disconnect")
async def integration_disconnect(
    provider: str,
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    if provider not in _SUPPORTED_PROVIDERS:
        raise HTTPException(status_code=404, detail="Unknown provider")

    if provider == "github":
        deleted = await github_oauth_service.delete_user_integration(user["user_id"], provider)
    else:
        deleted = await gitlab_oauth_service.delete_user_integration(user["user_id"], provider)

    return {"disconnected": deleted}