"""GitHub OAuth App user-to-server token exchange and MySQL integration storage."""

from __future__ import annotations

import asyncio
from typing import Any

import httpx

from app.core.crypto import TokenEncryptionError
from app.core.config import settings
from app.db.integrations_repository import (
    IntegrationNotFoundError,
    integrations_repository,
)
from app.db.sqlalchemy_database import db_session
from sqlalchemy.exc import SQLAlchemyError


class GitHubOAuthError(Exception):
    """Raised when the GitHub OAuth exchange or provider profile lookup fails."""


async def exchange_github_code(
    client: httpx.AsyncClient,
    code: str,
    redirect_uri: str,
) -> dict[str, Any]:
    """Exchange a GitHub authorization code for an OAuth token response."""
    response = await client.post(
        settings.GITHUB_TOKEN_URL,
        headers={"Accept": "application/json"},
        data={
            "client_id": settings.GITHUB_OAUTH_CLIENT_ID,
            "client_secret": settings.GITHUB_OAUTH_CLIENT_SECRET,
            "code": code,
            "redirect_uri": redirect_uri,
        },
    )
    response.raise_for_status()

    data = response.json()
    if not isinstance(data, dict) or not data.get("access_token"):
        raise GitHubOAuthError(
            data.get(
                "error_description",
                data.get("error", "GitHub token exchange failed"),
            )
            if isinstance(data, dict)
            else "GitHub token exchange returned an invalid response"
        )
    return data


async def fetch_github_username(
    client: httpx.AsyncClient,
    access_token: str,
) -> str:
    """Fetch the authenticated GitHub login for a freshly exchanged token."""
    response = await client.get(
        settings.GITHUB_USER_URL,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {access_token}",
            "User-Agent": "coding-agent",
        },
    )
    response.raise_for_status()

    username = response.json().get("login")
    if not isinstance(username, str) or not username:
        raise GitHubOAuthError("Could not fetch GitHub user profile")
    return username


def _store_github_integration(
    user_id: str,
    access_token: str,
    username: str,
) -> None:
    """Persist the GitHub token as Fernet ciphertext in MySQL."""
    with db_session() as db:
        integrations_repository.create_or_update(
            db,
            user_id=user_id,
            provider="github",
            access_token=access_token,
            username=username,
        )


def _load_github_integration(user_id: str) -> dict[str, Any] | None:
    """Load non-secret GitHub connection metadata for internal status checks."""
    with db_session() as db:
        integration = integrations_repository.get_by_user_and_provider(
            db,
            user_id=user_id,
            provider="github",
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


def _load_github_access_token(user_id: str) -> str:
    """Decrypt an access token only immediately before an outbound GitHub call."""
    with db_session() as db:
        access_token, _ = (
            integrations_repository.get_decrypted_tokens_for_provider(
                db,
                user_id=user_id,
                provider="github",
            )
        )
        return access_token


def _delete_github_integration(user_id: str) -> bool:
    """Remove a GitHub connection and its encrypted token ciphertext."""
    with db_session() as db:
        return integrations_repository.delete_by_user_and_provider(
            db,
            user_id=user_id,
            provider="github",
        )


async def get_user_integration(
    user_id: str,
    provider: str,
) -> dict[str, Any] | None:
    """Return connection metadata only; no token or ciphertext is exposed."""
    if provider != "github":
        return None
    return await asyncio.to_thread(_load_github_integration, user_id)


async def get_github_access_token(user_id: str) -> str:
    """Return a token only for use by the GitHub provider client."""
    try:
        return await asyncio.to_thread(_load_github_access_token, user_id)
    except (IntegrationNotFoundError, TokenEncryptionError) as exc:
        raise GitHubOAuthError("GitHub integration credentials are unavailable") from exc


async def delete_user_integration(user_id: str, provider: str) -> bool:
    """Disconnect GitHub by deleting the MySQL integration row."""
    if provider != "github":
        return False
    return await asyncio.to_thread(_delete_github_integration, user_id)


async def handle_github_oauth_callback(
    client: httpx.AsyncClient,
    body: dict[str, Any],
    user_id: str,
) -> tuple[int, dict[str, Any]]:
    """Exchange the callback code, fetch username, and encrypt token at rest."""
    code = body.get("code")
    redirect_uri = body.get("redirect_uri")

    if not isinstance(code, str) or not code:
        return 400, {"error": "missing_github_oauth_code"}

    if not isinstance(redirect_uri, str) or not redirect_uri:
        return 400, {"error": "missing_github_oauth_redirect_uri"}

    try:
        token_data = await exchange_github_code(client, code, redirect_uri)
        access_token = token_data["access_token"]
        username = await fetch_github_username(client, access_token)
        await asyncio.to_thread(
            _store_github_integration,
            user_id,
            access_token,
            username,
        )
    except (GitHubOAuthError, httpx.HTTPError):
        return 400, {"error": "github_oauth_failed"}
    except (TokenEncryptionError, SQLAlchemyError):
        return 500, {"error": "github_integration_storage_failed"}

    return 200, {
        "connected": True,
        "provider": "github",
        "username": username,
    }
