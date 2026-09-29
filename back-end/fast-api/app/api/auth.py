"""Google OAuth login endpoints (replaces the Cognito Hosted UI entirely)."""
import asyncio
from typing import Any, Optional

from fastapi import APIRouter, Depends, Header, Query, Request
from fastapi.responses import Response, JSONResponse, RedirectResponse

from app.schemas import (
    RegisterRequest, 
    LoginRequest, 
    UserResponse, 
    UserSettingsResponse, 
    UserWithUserSettingsResponse,
    GitHubIntegrationSettingsResponse,
    GitLabIntegrationSettingsResponse,
    LlmIntegrationSettingsResponse
)
from app.auth.dependencies import current_user, current_user_settings
from app.core.config import settings
from app.db.models import UserSettings
from app.db.sessions_repository import delete_session
from app.services.google_oauth_service import build_login_redirect, handle_callback
from app.services.uname_password_login_service import generate_unique_username, normalize_email
from app.services.uname_password_login_service import check_if_user_exists, save_user, user_login

router = APIRouter(prefix="/v1/auth", tags=["auth"])


@router.get("/google/login")
async def google_login(request: Request) -> RedirectResponse:
    return await build_login_redirect(request)


@router.get("/google/callback")
async def google_callback(
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
) -> RedirectResponse:
    print(f"Received Google OAuth callback with code: {code} and state: {state}")
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



@router.post("/register", response_model=UserWithUserSettingsResponse, status_code=201)
async def register(
    payload: RegisterRequest,
    response: Response,
) -> UserWithUserSettingsResponse:
    email = normalize_email(str(payload.email))

    await check_if_user_exists(email)  # Raises HTTPException if user exists

    username = await generate_unique_username(email)

    user, user_settings = await save_user(username, email, payload.name.strip(), payload.password, response)  # Raises HTTPException if user exists
    return UserWithUserSettingsResponse(
        user=UserResponse(
            user_id=user.user_id,
            username=user.username,
            name=user.name,
            email=user.email,
            email_verified=user.email_verified,
            picture=user.picture,
            auth_provider=user.auth_provider,
        ),
        settings=user_settings,
    )

@router.post("/login", response_model=UserWithUserSettingsResponse)
async def login(
    payload: LoginRequest,
    response: Response,
) -> UserWithUserSettingsResponse:
    user, user_settings = await user_login(payload, response)  # Raises HTTPException if login fails
    return UserWithUserSettingsResponse(
        user=user,
        settings=user_settings,
    )


@router.get("/me")
async def auth_me(
    user: dict[str, Any] = Depends(current_user), 
    settings: UserSettings = Depends(current_user_settings)
) -> UserWithUserSettingsResponse:
    return UserWithUserSettingsResponse(
        user=UserResponse(**user),
        settings=UserSettingsResponse(
            github=GitHubIntegrationSettingsResponse.model_validate(settings.github).model_dump(),
            gitlab=GitLabIntegrationSettingsResponse.model_validate(settings.gitlab).model_dump(),
            llm=LlmIntegrationSettingsResponse.model_validate(settings.llm).model_dump(),
        ),
    )
