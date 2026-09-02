"""Google OAuth login endpoints (replaces the Cognito Hosted UI entirely)."""
import asyncio
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse

from app.auth.dependencies import current_user
from app.core.config import settings
from app.db.sessions_repository import delete_session
from app.services.google_oauth_service import build_login_redirect, handle_callback

router = APIRouter(prefix="/v1/auth", tags=["auth"])


@router.get("/google/login")
async def google_login(request: Request) -> RedirectResponse:
    return await build_login_redirect(request)


@router.get("/google/callback")
async def google_callback(request: Request, code: str = Query(...), state: str = Query(...)) -> JSONResponse:
    return await handle_callback(code, state, request)


@router.post("/logout")
async def logout(request: Request, authorization: Optional[str] = Header(default=None)) -> JSONResponse:
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    else:
        token = request.cookies.get(settings.SESSION_COOKIE_NAME)

    if token:
        await asyncio.to_thread(delete_session, token)

    response = JSONResponse({"logged_out": True})
    response.delete_cookie(settings.SESSION_COOKIE_NAME, path="/")
    return response


@router.get("/me")
async def auth_me(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"user": user}
