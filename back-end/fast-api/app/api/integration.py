"""Server-owned GitHub integration OAuth routes."""

from __future__ import annotations

import asyncio
import secrets
import time
from typing import Any
from urllib.parse import urlencode, urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.exc import SQLAlchemyError

from app.auth.dependencies import current_user
from app.auth.integration_oauth_cookie import (
    decode_integration_oauth_callback_cookie,
    encode_integration_oauth_callback_cookie,
)
from app.core.config import settings
from app.db.integration_oauth_state_repository import (
    consume_integration_oauth_state,
    save_integration_oauth_state,
)
from app.services.github_oauth_service import (
    GITHUB_PROVIDER,
    GitHubOAuthError,
    exchange_github_code,
    fetch_github_username,
    store_github_integration,
)

router = APIRouter(prefix="/v1/auth", tags=["auth"])

GITHUB_CALLBACK_COOKIE_NAME = "github_integration_oauth"
GITHUB_CALLBACK_COOKIE_PATH = "/v1/auth/github"


def _configured_github_scopes() -> str:
    """
    Convert configured GitHub scopes to the space-separated OAuth format.

    Scopes come solely from backend configuration.
    """
    configured_scopes = settings.GITHUB_OAUTH_SCOPES

    if isinstance(configured_scopes, str):
        return " ".join(configured_scopes.replace(",", " ").split())

    return " ".join(
        scope.strip()
        for scope in configured_scopes
        if isinstance(scope, str) and scope.strip()
    )


def _validate_github_oauth_configuration() -> None:
    if not settings.INTEGRATIONS_ENABLED:
        raise GitHubOAuthError("Integrations are disabled")

    required_values = (
        settings.GITHUB_OAUTH_CLIENT_ID,
        settings.GITHUB_OAUTH_CLIENT_SECRET,
        settings.GITHUB_OAUTH_REDIRECT_URI,
        settings.GITHUB_AUTHORIZE_URL,
        settings.SESSION_SECRET,
        settings.INTEGRATION_OAUTH_STATE_COOKIE_SALT,
    )

    if any(
        not isinstance(value, str) or not value.strip() for value in required_values
    ):
        raise GitHubOAuthError("GitHub OAuth configuration is incomplete")

    callback_uri = urlparse(settings.GITHUB_OAUTH_REDIRECT_URI)
    if callback_uri.scheme not in {"http", "https"} or not callback_uri.netloc:
        raise GitHubOAuthError("GitHub OAuth callback URI is invalid")

    authorize_url = urlparse(settings.GITHUB_AUTHORIZE_URL)
    if authorize_url.scheme not in {"http", "https"} or not authorize_url.netloc:
        raise GitHubOAuthError("GitHub authorization URL is invalid")

    if not _configured_github_scopes():
        raise GitHubOAuthError("GitHub OAuth scopes are empty")


def _frontend_integration_redirect(*, connected: bool) -> str:
    """
    Produce a fixed callback redirect based only on FRONTEND_ORIGIN.

    Provider callback parameters, browser input, state, error descriptions,
    redirect_uri, headers, and request paths cannot affect this URL.
    """
    frontend_origin = settings.FRONTEND_ORIGIN.rstrip("/")
    parsed_origin = urlparse(frontend_origin)

    if parsed_origin.scheme not in {"http", "https"} or not parsed_origin.netloc:
        raise RuntimeError("FRONTEND_ORIGIN must be an absolute HTTP(S) origin")

    query = urlencode(
        {
            "integration": GITHUB_PROVIDER,
            "connected": "1" if connected else "0",
        }
    )

    return f"{frontend_origin}/?{query}"


def _github_callback_redirect(*, connected: bool) -> RedirectResponse:
    """
    Redirect to the configured frontend and clear temporary callback state.

    This must be used for every callback terminal outcome, including invalid
    cookie, invalid/reused/expired state, GitHub errors, storage errors, and
    success.
    """
    response = RedirectResponse(
        url=_frontend_integration_redirect(connected=connected),
        status_code=303,
    )
    response.delete_cookie(
        key=GITHUB_CALLBACK_COOKIE_NAME,
        path=GITHUB_CALLBACK_COOKIE_PATH,
        secure=settings.COOKIE_SECURE,
        httponly=True,
        samesite="lax",
    )
    return response


def _save_github_oauth_state(
    *,
    user_id: str,
    state: str,
    cookie_nonce: str,
    expires_at: int,
) -> None:
    """
    Persist callback state bound to user, provider, and browser callback nonce.

    The repository owns the MySQL transaction and stores optional PKCE material.
    GitHub Task 7 does not require PKCE, so code_verifier is None.
    """
    save_integration_oauth_state(
        user_id=user_id,
        provider=GITHUB_PROVIDER,
        state=state,
        cookie_nonce=cookie_nonce,
        expires_at=expires_at,
        code_verifier=None,
    )


@router.get("/github/login")
async def github_login(
    user: dict[str, Any] = Depends(current_user),
) -> RedirectResponse:
    try:
        _validate_github_oauth_configuration()
    except GitHubOAuthError:
        raise HTTPException(
            status_code=503,
            detail="GitHub integration is unavailable",
        ) from None

    user_id = user.get("user_id")
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(
            status_code=401,
            detail="Authenticated user is invalid",
        )

    state = secrets.token_urlsafe(48)
    cookie_nonce = secrets.token_urlsafe(48)
    expires_at = int(time.time()) + settings.INTEGRATION_OAUTH_STATE_TTL_S

    try:
        await asyncio.to_thread(
            _save_github_oauth_state,
            user_id=user_id,
            state=state,
            cookie_nonce=cookie_nonce,
            expires_at=expires_at,
        )
    except (SQLAlchemyError, ValueError):
        raise HTTPException(
            status_code=503,
            detail="GitHub integration is unavailable",
        ) from None

    authorization_query = urlencode(
        {
            "client_id": settings.GITHUB_OAUTH_CLIENT_ID,
            "redirect_uri": settings.GITHUB_OAUTH_REDIRECT_URI,
            "scope": _configured_github_scopes(),
            "state": state,
        }
    )

    response = RedirectResponse(
        url=f"{settings.GITHUB_AUTHORIZE_URL}?{authorization_query}",
        status_code=303,
    )
    response.set_cookie(
        key=GITHUB_CALLBACK_COOKIE_NAME,
        value=encode_integration_oauth_callback_cookie(
            provider=GITHUB_PROVIDER,
            cookie_nonce=cookie_nonce,
        ),
        max_age=settings.INTEGRATION_OAUTH_STATE_TTL_S,
        path=GITHUB_CALLBACK_COOKIE_PATH,
        secure=settings.COOKIE_SECURE,
        httponly=True,
        samesite="lax",
    )
    return response


@router.get("/github/callback")
async def github_callback(
    request: Request,
    code: str | None = Query(default=None, min_length=1, max_length=4096),
    state: str | None = Query(default=None, min_length=1, max_length=256),
    error: str | None = Query(default=None, max_length=256),
) -> RedirectResponse:
    """
    Complete GitHub OAuth through backend-only token exchange and persistence.

    No `current_user` dependency is used here. The callback owner is obtained
    only from the atomically consumed Task 6 persistent OAuth state record.
    """
    if error is not None:
        return _github_callback_redirect(connected=False)

    if not code or not state:
        return _github_callback_redirect(connected=False)

    cookie_nonce = decode_integration_oauth_callback_cookie(
        provider=GITHUB_PROVIDER,
        cookie_value=request.cookies.get(GITHUB_CALLBACK_COOKIE_NAME),
    )
    if cookie_nonce is None:
        return _github_callback_redirect(connected=False)

    try:
        consumed_state = await asyncio.to_thread(
            consume_integration_oauth_state,
            state=state,
            expected_provider=GITHUB_PROVIDER,
            cookie_nonce=cookie_nonce,
        )
    except (SQLAlchemyError, RuntimeError, ValueError):
        # Task 6 requires this repository operation to preserve valid rows on
        # wrong-provider and wrong-nonce attempts, and to atomically delete a
        # valid record before token exchange.
        return _github_callback_redirect(connected=False)

    if consumed_state is None:
        return _github_callback_redirect(connected=False)

    # Update only this line if your repository returns a dict or tuple.
    # The user ID must come from the consumed record, never browser input.
    user_id = consumed_state["user_id"]

    if not isinstance(user_id, str) or not user_id:
        return _github_callback_redirect(connected=False)

    client = request.app.state.http_client
    if not isinstance(client, httpx.AsyncClient):
        return _github_callback_redirect(connected=False)

    try:
        token_data = await exchange_github_code(client, code)
        access_token = token_data["access_token"]

        username = await fetch_github_username(client, access_token)

        await store_github_integration(
            user_id=user_id,
            access_token=access_token,
            username=username,
        )
    except (
        GitHubOAuthError,
        KeyError,
        TypeError,
        ValueError,
        httpx.HTTPError,
    ):
        return _github_callback_redirect(connected=False)

    return _github_callback_redirect(connected=True)
