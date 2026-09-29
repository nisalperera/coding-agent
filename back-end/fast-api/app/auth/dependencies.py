"""
FastAPI dependency for authenticating requests. AWS Cognito is fully removed;
identity comes from a local SQLite session created after Google OAuth login.
Callers authenticate with `Authorization: Bearer <token>` or the
`agent_session` HttpOnly cookie.
"""
import asyncio
from typing import Any, Optional

from fastapi import Header, HTTPException, Request

from app.schemas import UserSettingsResponse
from app.db.sessions_repository import get_session_user
from app.db.settings_repository import get_user_settings
from app.services.settings_service import build_user_settings_response


def _extract_token(request: Request, authorization: Optional[str]) -> Optional[str]:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization.split(" ", 1)[1].strip()
    return request.cookies.get("session")


async def current_user(request: Request, authorization: Optional[str] = Header(default=None)) -> dict[str, Any]:
    token = _extract_token(request, authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing session token")

    user = await asyncio.to_thread(get_session_user, token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return user

async def current_user_settings(request: Request, authorization: Optional[str] = Header(default=None)) -> UserSettingsResponse:
    token = _extract_token(request, authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing session token")

    user = await asyncio.to_thread(get_session_user, token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    settings = await asyncio.to_thread(get_user_settings, user["user_id"])
    if not settings:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return build_user_settings_response(settings)