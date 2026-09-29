"""Server-owned GitHub and GitLab integration OAuth routes."""

from __future__ import annotations

import asyncio
import base64
import hashlib
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
from app.schemas import IntegrationsStatusResponse
from app.services.github_oauth_service import (
    GITHUB_PROVIDER,
    GitHubOAuthError,
    exchange_github_code,
    fetch_github_username,
    store_github_integration,
)
from app.services.github_oauth_service import (
    get_user_integration as get_github_user_integration,
)
from app.services.gitlab_oauth_service import (
    GITLAB_PROVIDER,
    GitLabOAuthError,
    exchange_gitlab_code,
    fetch_gitlab_username,
    store_gitlab_integration,
)
from app.services.gitlab_oauth_service import (
    get_user_integration as get_gitlab_user_integration,
)

router = APIRouter(prefix="/v1/auth", tags=["auth"])
integration_status_router = APIRouter(
    prefix="/v1/integrations",
    tags=["integrations"],
)

GITHUB_CALLBACK_COOKIE_NAME = "github_integration_oauth"
GITHUB_CALLBACK_COOKIE_PATH = "/v1/auth/github"
GITLAB_CALLBACK_COOKIE_NAME = "gitlab_integration_oauth"
GITLAB_CALLBACK_COOKIE_PATH = "/v1/auth/gitlab"


def _configured_scopes(configured_scopes: str | list[str] | tuple[str, ...]) -> str:
    """Convert backend-configured OAuth scopes to the provider URL format."""
    if isinstance(configured_scopes, str):
        return " ".join(configured_scopes.replace(",", " ").split())

    return " ".join(
        scope.strip()
        for scope in configured_scopes
        if isinstance(scope, str) and scope.strip()
    )


def _configured_github_scopes() -> str:
    """Return GitHub scopes from backend configuration only."""
    return _configured_scopes(settings.GITHUB_OAUTH_SCOPES)


def _configured_gitlab_scopes() -> str:
    """Return GitLab scopes from backend configuration only."""
    return _configured_scopes(settings.GITLAB_OAUTH_SCOPES)


def _validate_oauth_url(name: str, value: str, error_type: type[Exception]) -> None:
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise error_type(f"{name} is invalid")


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
    if any(not isinstance(value, str) or not value.strip() for value in required_values):
        raise GitHubOAuthError("GitHub OAuth configuration is incomplete")

    _validate_oauth_url(
        "GitHub OAuth callback URI",
        settings.GITHUB_OAUTH_REDIRECT_URI,
        GitHubOAuthError,
    )
    _validate_oauth_url(
        "GitHub authorization URL",
        settings.GITHUB_AUTHORIZE_URL,
        GitHubOAuthError,
    )

    if not _configured_github_scopes():
        raise GitHubOAuthError("GitHub OAuth scopes are empty")


def _validate_gitlab_oauth_configuration() -> None:
    if not settings.INTEGRATIONS_ENABLED:
        raise GitLabOAuthError("Integrations are disabled")

    required_values = (
        settings.GITLAB_OAUTH_CLIENT_ID,
        settings.GITLAB_OAUTH_CLIENT_SECRET,
        settings.GITLAB_OAUTH_REDIRECT_URI,
        settings.GITLAB_AUTHORIZE_URL,
        settings.GITLAB_TOKEN_URL,
        settings.GITLAB_USER_URL,
        settings.SESSION_SECRET,
        settings.INTEGRATION_OAUTH_STATE_COOKIE_SALT,
    )
    if any(not isinstance(value, str) or not value.strip() for value in required_values):
        raise GitLabOAuthError("GitLab OAuth configuration is incomplete")

    _validate_oauth_url(
        "GitLab OAuth callback URI",
        settings.GITLAB_OAUTH_REDIRECT_URI,
        GitLabOAuthError,
    )
    _validate_oauth_url(
        "GitLab authorization URL",
        settings.GITLAB_AUTHORIZE_URL,
        GitLabOAuthError,
    )
    _validate_oauth_url(
        "GitLab token URL",
        settings.GITLAB_TOKEN_URL,
        GitLabOAuthError,
    )
    _validate_oauth_url(
        "GitLab user URL",
        settings.GITLAB_USER_URL,
        GitLabOAuthError,
    )

    if not _configured_gitlab_scopes():
        raise GitLabOAuthError("GitLab OAuth scopes are empty")


def _pkce_s256_challenge(code_verifier: str) -> str:
    """Return the RFC 7636 S256 challenge for a server-owned verifier."""
    if not isinstance(code_verifier, str) or not code_verifier:
        raise ValueError("PKCE code verifier is required")

    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _frontend_integration_redirect(*, provider: str, connected: bool) -> str:
    """Build a fixed, provider-safe frontend redirect URL."""
    frontend_origin = settings.FRONTEND_ORIGIN.rstrip("/")
    parsed_origin = urlparse(frontend_origin)
    if parsed_origin.scheme not in {"http", "https"} or not parsed_origin.netloc:
        raise RuntimeError("FRONTEND_ORIGIN must be an absolute HTTP(S) origin")

    query = urlencode(
        {
            "integration": provider,
            "connected": "1" if connected else "0",
        }
    )
    return f"{frontend_origin}/?{query}"


def _integration_callback_redirect(
    *,
    provider: str,
    cookie_name: str,
    cookie_path: str,
    connected: bool,
) -> RedirectResponse:
    """Redirect safely to the frontend and clear only the provider cookie."""
    response = RedirectResponse(
        url=_frontend_integration_redirect(provider=provider, connected=connected),
        status_code=303,
    )
    response.delete_cookie(
        key=cookie_name,
        path=cookie_path,
        secure=settings.COOKIE_SECURE,
        httponly=True,
        samesite="lax",
    )
    return response


def _github_callback_redirect(*, connected: bool) -> RedirectResponse:
    return _integration_callback_redirect(
        provider=GITHUB_PROVIDER,
        cookie_name=GITHUB_CALLBACK_COOKIE_NAME,
        cookie_path=GITHUB_CALLBACK_COOKIE_PATH,
        connected=connected,
    )


def _gitlab_callback_redirect(*, connected: bool) -> RedirectResponse:
    return _integration_callback_redirect(
        provider=GITLAB_PROVIDER,
        cookie_name=GITLAB_CALLBACK_COOKIE_NAME,
        cookie_path=GITLAB_CALLBACK_COOKIE_PATH,
        connected=connected,
    )


def _save_github_oauth_state(
    *,
    user_id: str,
    state: str,
    cookie_nonce: str,
    expires_at: int,
) -> None:
    """Persist a GitHub callback state without PKCE material."""
    save_integration_oauth_state(
        user_id=user_id,
        provider=GITHUB_PROVIDER,
        state=state,
        cookie_nonce=cookie_nonce,
        expires_at=expires_at,
        code_verifier=None,
    )


def _save_gitlab_oauth_state(
    *,
    user_id: str,
    state: str,
    cookie_nonce: str,
    code_verifier: str,
    expires_at: int,
) -> None:
    """Persist GitLab callback state with its server-only PKCE verifier."""
    save_integration_oauth_state(
        user_id=user_id,
        provider=GITLAB_PROVIDER,
        state=state,
        cookie_nonce=cookie_nonce,
        expires_at=expires_at,
        code_verifier=code_verifier,
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
    """Complete GitHub OAuth through backend-only token exchange and storage."""
    if error is not None or not code or not state:
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
        return _github_callback_redirect(connected=False)

    if consumed_state is None:
        return _github_callback_redirect(connected=False)

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
    except (GitHubOAuthError, KeyError, TypeError, ValueError, httpx.HTTPError):
        return _github_callback_redirect(connected=False)

    return _github_callback_redirect(connected=True)


@router.get("/gitlab/login")
async def gitlab_login(
    user: dict[str, Any] = Depends(current_user),
) -> RedirectResponse:
    """Start an authenticated GitLab OAuth flow with mandatory S256 PKCE."""
    try:
        _validate_gitlab_oauth_configuration()
    except GitLabOAuthError:
        raise HTTPException(
            status_code=503,
            detail="GitLab integration is unavailable",
        ) from None

    user_id = user.get("user_id")
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(
            status_code=401,
            detail="Authenticated user is invalid",
        )

    state = secrets.token_urlsafe(48)
    cookie_nonce = secrets.token_urlsafe(48)
    code_verifier = secrets.token_urlsafe(64)
    expires_at = int(time.time()) + settings.INTEGRATION_OAUTH_STATE_TTL_S

    try:
        code_challenge = _pkce_s256_challenge(code_verifier)
        await asyncio.to_thread(
            _save_gitlab_oauth_state,
            user_id=user_id,
            state=state,
            cookie_nonce=cookie_nonce,
            code_verifier=code_verifier,
            expires_at=expires_at,
        )
    except (SQLAlchemyError, ValueError):
        raise HTTPException(
            status_code=503,
            detail="GitLab integration is unavailable",
        ) from None

    authorization_query = urlencode(
        {
            "client_id": settings.GITLAB_OAUTH_CLIENT_ID,
            "redirect_uri": settings.GITLAB_OAUTH_REDIRECT_URI,
            "response_type": "code",
            "scope": _configured_gitlab_scopes(),
            "state": state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
    )
    response = RedirectResponse(
        url=f"{settings.GITLAB_AUTHORIZE_URL}?{authorization_query}",
        status_code=303,
    )
    response.set_cookie(
        key=GITLAB_CALLBACK_COOKIE_NAME,
        value=encode_integration_oauth_callback_cookie(
            provider=GITLAB_PROVIDER,
            cookie_nonce=cookie_nonce,
        ),
        max_age=settings.INTEGRATION_OAUTH_STATE_TTL_S,
        path=GITLAB_CALLBACK_COOKIE_PATH,
        secure=settings.COOKIE_SECURE,
        httponly=True,
        samesite="lax",
    )
    return response


@router.get("/gitlab/callback")
async def gitlab_callback(
    request: Request,
    code: str | None = Query(default=None, min_length=1, max_length=4096),
    state: str | None = Query(default=None, min_length=1, max_length=256),
    error: str | None = Query(default=None, max_length=256),
) -> RedirectResponse:
    """Complete GitLab OAuth with a consumed state and server-only PKCE data."""
    if error is not None or not code or not state:
        return _gitlab_callback_redirect(connected=False)

    cookie_nonce = decode_integration_oauth_callback_cookie(
        provider=GITLAB_PROVIDER,
        cookie_value=request.cookies.get(GITLAB_CALLBACK_COOKIE_NAME),
    )
    if cookie_nonce is None:
        return _gitlab_callback_redirect(connected=False)

    try:
        consumed_state = await asyncio.to_thread(
            consume_integration_oauth_state,
            state=state,
            expected_provider=GITLAB_PROVIDER,
            cookie_nonce=cookie_nonce,
        )
    except (SQLAlchemyError, RuntimeError, ValueError):
        return _gitlab_callback_redirect(connected=False)

    if consumed_state is None:
        return _gitlab_callback_redirect(connected=False)

    user_id = consumed_state["user_id"]
    code_verifier = consumed_state["code_verifier"]
    if not isinstance(user_id, str) or not user_id:
        return _gitlab_callback_redirect(connected=False)
    if not isinstance(code_verifier, str) or not code_verifier:
        return _gitlab_callback_redirect(connected=False)

    client = request.app.state.http_client
    if not isinstance(client, httpx.AsyncClient):
        return _gitlab_callback_redirect(connected=False)

    try:
        token_data = await exchange_gitlab_code(client, code, code_verifier)
        access_token = token_data["access_token"]
        username = await fetch_gitlab_username(client, access_token)
        await store_gitlab_integration(
            user_id=user_id,
            token_data=token_data,
            username=username,
        )
    except (GitLabOAuthError, KeyError, TypeError, ValueError, httpx.HTTPError):
        return _gitlab_callback_redirect(connected=False)

    return _gitlab_callback_redirect(connected=True)

@integration_status_router.get(
    "/status",
    response_model=IntegrationsStatusResponse,
)
async def integration_status(
    user: dict[str, Any] = Depends(current_user),
) -> IntegrationsStatusResponse:
    """
    Return safe, stable integration metadata for the authenticated user.

    Both supported providers are always included. This route never decrypts,
    returns, logs, or derives output from provider access tokens, refresh
    tokens, ciphertext, expiry, scopes, OAuth state, callback nonces,
    authorization codes, PKCE verifiers, or OAuth client configuration.
    """
    user_id = user.get("user_id")
    if not isinstance(user_id, str) or not user_id:
        raise HTTPException(
            status_code=401,
            detail="Authenticated user is invalid",
        )

    try:
        github_status, gitlab_status = await asyncio.gather(
            get_github_user_integration(
                user_id=user_id,
                provider=GITHUB_PROVIDER,
            ),
            get_gitlab_user_integration(
                user_id=user_id,
                provider=GITLAB_PROVIDER,
            ),
        )
    except (GitHubOAuthError, GitLabOAuthError):
        raise HTTPException(
            status_code=503,
            detail="Integration status is unavailable",
        ) from None

    return IntegrationsStatusResponse(
        integrations={
            GITHUB_PROVIDER: github_status,
            GITLAB_PROVIDER: gitlab_status,
        }
    )
