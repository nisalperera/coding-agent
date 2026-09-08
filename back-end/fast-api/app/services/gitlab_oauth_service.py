"""Backend-only GitLab OAuth exchange, encrypted storage, and token dispatch."""

from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings
from app.core.crypto import TokenEncryptionError
from app.db.database import db_session
from app.db.integrations_repository import (
    IntegrationNotFoundError,
    integrations_repository,
)

GITLAB_PROVIDER = "gitlab"


class GitLabOAuthError(Exception):
    """Safe internal GitLab OAuth or integration failure."""


def _optional_nonempty_string(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _token_expires_at(token_data: dict[str, Any]) -> int | None:
    """Calculate an absolute expiry only from a positive GitLab expires_in."""
    expires_in = token_data.get("expires_in")
    if isinstance(expires_in, bool):
        return None

    if isinstance(expires_in, int):
        seconds = expires_in
    elif isinstance(expires_in, str) and expires_in.isdecimal():
        seconds = int(expires_in)
    else:
        return None

    if seconds <= 0:
        return None
    return int(time.time()) + seconds


async def exchange_gitlab_code(
    client: httpx.AsyncClient,
    code: str,
    code_verifier: str,
) -> dict[str, Any]:
    """Exchange a GitLab authorization code using backend-owned PKCE data."""
    if not isinstance(code, str) or not code.strip():
        raise GitLabOAuthError("GitLab authorization code is missing")
    if not isinstance(code_verifier, str) or not code_verifier.strip():
        raise GitLabOAuthError("GitLab PKCE verifier is missing")

    try:
        response = await client.post(
            settings.GITLAB_TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "client_id": settings.GITLAB_OAUTH_CLIENT_ID,
                "client_secret": settings.GITLAB_OAUTH_CLIENT_SECRET,
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": settings.GITLAB_OAUTH_REDIRECT_URI,
                "code_verifier": code_verifier,
            },
            timeout=10.0,
        )
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise GitLabOAuthError("GitLab token exchange failed") from exc

    if not isinstance(data, dict):
        raise GitLabOAuthError("GitLab token exchange returned an invalid response")

    access_token = _optional_nonempty_string(data.get("access_token"))
    if access_token is None:
        raise GitLabOAuthError("GitLab token exchange returned no access token")

    return data


async def fetch_gitlab_username(
    client: httpx.AsyncClient,
    access_token: str,
) -> str:
    """Fetch a GitLab username with a backend-only bearer token."""
    if not isinstance(access_token, str) or not access_token.strip():
        raise GitLabOAuthError("GitLab access token is missing")

    try:
        response = await client.get(
            settings.GITLAB_USER_URL,
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {access_token}",
            },
            timeout=10.0,
        )
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise GitLabOAuthError("GitLab user lookup failed") from exc

    if not isinstance(data, dict):
        raise GitLabOAuthError("GitLab user response is malformed")

    username = _optional_nonempty_string(data.get("username"))
    if username is None:
        username = _optional_nonempty_string(data.get("nickname"))
    if username is None:
        raise GitLabOAuthError("GitLab user response has no username")

    return username


def _store_gitlab_integration(
    user_id: str,
    token_data: dict[str, Any],
    username: str,
) -> None:
    """Persist GitLab credentials only through Fernet-backed storage."""
    if not isinstance(user_id, str) or not user_id:
        raise GitLabOAuthError("OAuth state has no initiating user")
    if not isinstance(token_data, dict):
        raise GitLabOAuthError("GitLab token response is invalid")
    if not isinstance(username, str) or not username.strip():
        raise GitLabOAuthError("GitLab username is missing")

    access_token = _optional_nonempty_string(token_data.get("access_token"))
    if access_token is None:
        raise GitLabOAuthError("GitLab access token is missing")

    refresh_token = _optional_nonempty_string(token_data.get("refresh_token"))
    scopes = _optional_nonempty_string(token_data.get("scope"))

    try:
        with db_session() as db:
            integrations_repository.create_or_update(
                db,
                user_id=user_id,
                provider=GITLAB_PROVIDER,
                access_token=access_token,
                refresh_token=refresh_token,
                token_expires_at=_token_expires_at(token_data),
                username=username.strip(),
                scopes=scopes,
            )
    except (TokenEncryptionError, SQLAlchemyError, ValueError) as exc:
        raise GitLabOAuthError("GitLab integration storage failed") from exc


async def store_gitlab_integration(
    *,
    user_id: str,
    token_data: dict[str, Any],
    username: str,
) -> None:
    """Persist encrypted GitLab integration data from consumed OAuth state."""
    await asyncio.to_thread(
        _store_gitlab_integration,
        user_id,
        token_data,
        username,
    )


def _load_gitlab_access_token(user_id: str) -> str:
    """Decrypt a GitLab token only immediately before an internal tool call."""
    with db_session() as db:
        access_token, _refresh_token = (
            integrations_repository.get_decrypted_tokens_for_provider(
                db,
                user_id=user_id,
                provider=GITLAB_PROVIDER,
            )
        )

    if not isinstance(access_token, str) or not access_token:
        raise IntegrationNotFoundError("GitLab integration is not connected")
    return access_token


async def get_gitlab_access_token(user_id: str) -> str:
    """Return GitLab credentials only to authenticated backend tool dispatch."""
    try:
        return await asyncio.to_thread(_load_gitlab_access_token, user_id)
    except (IntegrationNotFoundError, TokenEncryptionError, SQLAlchemyError) as exc:
        raise GitLabOAuthError(
            "GitLab integration credentials are unavailable"
        ) from exc
