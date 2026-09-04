"""GitLab OAuth App user-to-server token exchange and MySQL integration storage.

Mirrors app/services/github_oauth_service.py exactly: exchange the
authorization code server-side, fetch the authenticated GitLab user, store
the token as Fernet ciphertext via the existing integrations repository,
expose connection metadata only, and decrypt the token only immediately
before an outbound GitLab API call.
"""
from __future__ import annotations

import asyncio
from typing import Any

import httpx
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings
from app.core.crypto import TokenEncryptionError
from app.db.integrations_repository import (
    IntegrationNotFoundError,
    integrations_repository,
)
from app.db.sqlalchemy_database import db_session


class GitLabOAuthError(Exception):
    """Raised when the GitLab OAuth exchange or provider profile lookup fails."""


async def exchange_gitlab_code(
    client: httpx.AsyncClient,
    code: str,
    redirect_uri: str,
) -> dict[str, Any]:
    """Exchange a GitLab authorization code for an OAuth token response."""
    response = await client.post(
        settings.GITLAB_TOKEN_URL,
        headers={"Accept": "application/json"},
        data={
            "client_id": settings.GITLAB_OAUTH_CLIENT_ID,
            "client_secret": settings.GITLAB_OAUTH_CLIENT_SECRET,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        },
    )
    response.raise_for_status()

    data = response.json()
    if not isinstance(data, dict) or not data.get("access_token"):
        raise GitLabOAuthError(
            data.get(
                "error_description",
                data.get("error", "GitLab token exchange failed"),
            )
            if isinstance(data, dict)
            else "GitLab token exchange returned an invalid response"
        )
    return data


async def fetch_gitlab_username(
    client: httpx.AsyncClient,
    access_token: str,
) -> str:
    """Fetch the authenticated GitLab username for a freshly exchanged token."""
    response = await client.get(
        settings.GITLAB_USER_URL,
        headers={"Authorization": f"Bearer {access_token}"},
    )
    response.raise_for_status()

    username = response.json().get("username")
    if not isinstance(username, str) or not username:
        raise GitLabOAuthError("Could not fetch GitLab user profile")
    return username


def _store_gitlab_integration(
    user_id: str,
    access_token: str,
    username: str,
) -> None:
    """Persist the GitLab token as Fernet ciphertext in MySQL."""
    with db_session() as db:
        integrations_repository.create_or_update(
            db,
            user_id=user_id,
            provider="gitlab",
            access_token=access_token,
            username=username,
        )


def _load_gitlab_integration(user_id: str) -> dict[str, Any] | None:
    """Load non-secret GitLab connection metadata for internal status checks."""
    with db_session() as db:
        integration = integrations_repository.get_by_user_and_provider(
            db,
            user_id=user_id,
            provider="gitlab",
        )
        if integration is None:
            return None

        return {
            "user_id": integration.user_id,
            "provider": integration.provider,
            "username": integration.username,
            "connected_at": integration.connected_at,
            "updated_at": integration.updated_at,
            "token_expires_at": integration.token_expires_at,
        }


def _load_gitlab_access_token(user_id: str) -> str:
    """Decrypt an access token only immediately before an outbound GitLab call."""
    with db_session() as db:
        access_token, _ = (
            integrations_repository.get_decrypted_tokens_for_provider(
                db,
                user_id=user_id,
                provider="gitlab",
            )
        )
        return access_token


def _delete_gitlab_integration(user_id: str) -> bool:
    """Remove a GitLab connection and its encrypted token ciphertext."""
    with db_session() as db:
        return integrations_repository.delete_by_user_and_provider(
            db,
            user_id=user_id,
            provider="gitlab",
        )


async def get_user_integration(
    user_id: str,
    provider: str,
) -> dict[str, Any] | None:
    """Return connection metadata only; no token or ciphertext is exposed."""
    if provider != "gitlab":
        return None
    return await asyncio.to_thread(_load_gitlab_integration, user_id)


async def get_gitlab_access_token(user_id: str) -> str:
    """Return a token only for use by the GitLab provider client."""
    try:
        return await asyncio.to_thread(_load_gitlab_access_token, user_id)
    except (IntegrationNotFoundError, TokenEncryptionError) as exc:
        raise GitLabOAuthError("GitLab integration credentials are unavailable") from exc


async def delete_user_integration(user_id: str, provider: str) -> bool:
    """Disconnect GitLab by deleting the MySQL integration row."""
    if provider != "gitlab":
        return False
    return await asyncio.to_thread(_delete_gitlab_integration, user_id)


async def handle_gitlab_oauth_callback(
    client: httpx.AsyncClient,
    body: dict[str, Any],
    user_id: str,
) -> tuple[int, dict[str, Any]]:
    """Exchange the callback code, fetch username, and encrypt token at rest."""
    code = body.get("code")
    redirect_uri = body.get("redirect_uri")

    if not isinstance(code, str) or not code:
        return 400, {"error": "missing_gitlab_oauth_code"}

    if not isinstance(redirect_uri, str) or not redirect_uri:
        return 400, {"error": "missing_gitlab_oauth_redirect_uri"}

    try:
        token_data = await exchange_gitlab_code(client, code, redirect_uri)
        access_token = token_data["access_token"]
        username = await fetch_gitlab_username(client, access_token)
        await asyncio.to_thread(
            _store_gitlab_integration,
            user_id,
            access_token,
            username,
        )
    except (GitLabOAuthError, httpx.HTTPError):
        return 400, {"error": "gitlab_oauth_failed"}
    except (TokenEncryptionError, SQLAlchemyError):
        return 500, {"error": "gitlab_integration_storage_failed"}

    return 200, {
        "connected": True,
        "provider": "gitlab",
        "username": username,
    }