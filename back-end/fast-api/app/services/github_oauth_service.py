"""Backend-only GitHub OAuth exchange, encrypted integration storage, and token dispatch."""

from __future__ import annotations

import asyncio
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

GITHUB_PROVIDER = "github"


class GitHubOAuthError(Exception):
    """
    Safe internal GitHub OAuth or integration failure.

    Route handlers must not return exception details, provider response data,
    OAuth codes, state values, callback nonces, or access tokens to browsers.
    """


async def exchange_github_code(
    client: httpx.AsyncClient,
    code: str,
) -> dict[str, Any]:
    """
    Exchange an authorization code using exclusively backend-owned settings.

    `redirect_uri` is fixed to settings.GITHUB_OAUTH_REDIRECT_URI. It is never
    accepted from a browser request body, callback URL, chat payload, action
    payload, or frontend configuration.
    """
    if not isinstance(code, str) or not code.strip():
        raise GitHubOAuthError("GitHub authorization code is missing")

    try:
        response = await client.post(
            settings.GITHUB_TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "client_id": settings.GITHUB_OAUTH_CLIENT_ID,
                "client_secret": settings.GITHUB_OAUTH_CLIENT_SECRET,
                "code": code,
                "redirect_uri": settings.GITHUB_OAUTH_REDIRECT_URI,
            },
            timeout=10.0,
        )
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise GitHubOAuthError("GitHub token exchange failed") from exc

    if not isinstance(data, dict):
        raise GitHubOAuthError("GitHub token exchange returned an invalid response")

    access_token = data.get("access_token")
    if not isinstance(access_token, str) or not access_token.strip():
        raise GitHubOAuthError("GitHub token exchange returned no access token")

    return data


async def fetch_github_username(
    client: httpx.AsyncClient,
    access_token: str,
) -> str:
    """
    Fetch the required GitHub login using an internal Authorization header.

    The access token remains in process memory only for provider calls and
    Fernet-encrypted persistence. It must not be logged or sent to clients.
    """
    if not isinstance(access_token, str) or not access_token.strip():
        raise GitHubOAuthError("GitHub access token is missing")

    try:
        response = await client.get(
            settings.GITHUB_USER_URL,
            headers={
                "Accept": "application/vnd.github+json",
                "Authorization": f"Bearer {access_token}",
                "User-Agent": "coding-agent",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            timeout=10.0,
        )
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise GitHubOAuthError("GitHub user lookup failed") from exc

    if not isinstance(data, dict):
        raise GitHubOAuthError("GitHub user response is malformed")

    username = data.get("login")
    if not isinstance(username, str) or not username.strip():
        raise GitHubOAuthError("GitHub user response has no login")

    return username.strip()


def _store_github_integration(
    user_id: str,
    access_token: str,
    username: str,
) -> None:
    """
    Persist a GitHub token through the existing Task 5 Fernet storage path.

    The repository owns token encryption before MySQL persistence.
    """
    if not isinstance(user_id, str) or not user_id:
        raise GitHubOAuthError("OAuth state has no initiating user")

    if not isinstance(access_token, str) or not access_token:
        raise GitHubOAuthError("GitHub access token is missing")

    if not isinstance(username, str) or not username:
        raise GitHubOAuthError("GitHub username is missing")

    try:
        with db_session() as db:
            integrations_repository.create_or_update(
                db,
                user_id=user_id,
                provider=GITHUB_PROVIDER,
                access_token=access_token,
                username=username,
            )
    except (TokenEncryptionError, SQLAlchemyError, ValueError) as exc:
        raise GitHubOAuthError("GitHub integration storage failed") from exc


async def store_github_integration(
    *,
    user_id: str,
    access_token: str,
    username: str,
) -> None:
    """
    Persist encrypted integration data for a user from consumed OAuth state.

    The `user_id` must come from the Task 6 consumed integration state record,
    never from callback query parameters, request bodies, or browser state.
    """
    await asyncio.to_thread(
        _store_github_integration,
        user_id,
        access_token,
        username,
    )


def _load_github_integration(user_id: str) -> dict[str, Any]:
    """
    Load public-safe integration metadata for internal status functionality.

    No token, ciphertext, scope, expiry, or internal integration row fields are
    returned from this method.
    """
    with db_session() as db:
        status = integrations_repository.get_public_status_by_user_and_provider(
            db,
            user_id=user_id,
            provider=GITHUB_PROVIDER,
        )

    return {
        "connected": status.connected,
        "username": status.username,
        "connected_at": status.connected_at,
    }


def _load_github_access_token(user_id: str) -> str:
    """
    Decrypt a token only immediately before an internal GitHub API/tool call.

    Never call this to build browser responses, public status payloads, chat
    output, callback redirects, or logs.
    """
    with db_session() as db:
        access_token, _refresh_token = (
            integrations_repository.get_decrypted_tokens_for_provider(
                db,
                user_id=user_id,
                provider=GITHUB_PROVIDER,
            )
        )

    if not isinstance(access_token, str) or not access_token:
        raise IntegrationNotFoundError("GitHub integration is not connected")

    return access_token


def _delete_github_integration(user_id: str) -> bool:
    """
    Delete only the caller's local encrypted GitHub integration row.

    This does not represent provider-side OAuth token revocation.
    """
    with db_session() as db:
        return integrations_repository.delete_by_user_and_provider(
            db,
            user_id=user_id,
            provider=GITHUB_PROVIDER,
        )


async def get_user_integration(
    user_id: str,
    provider: str,
) -> dict[str, Any]:
    """
    Return safe connection metadata only.

    Task 9 can expose this through a stable integration-status endpoint.
    """
    if provider != GITHUB_PROVIDER:
        raise GitHubOAuthError("Unsupported integration provider")

    try:
        return await asyncio.to_thread(_load_github_integration, user_id)
    except (IntegrationNotFoundError, TokenEncryptionError, SQLAlchemyError) as exc:
        raise GitHubOAuthError("GitHub integration metadata is unavailable") from exc


async def get_github_access_token(user_id: str) -> str:
    """
    Return decrypted GitHub credentials only to authenticated backend dispatch.
    """
    try:
        return await asyncio.to_thread(_load_github_access_token, user_id)
    except (IntegrationNotFoundError, TokenEncryptionError, SQLAlchemyError) as exc:
        raise GitHubOAuthError(
            "GitHub integration credentials are unavailable"
        ) from exc


async def delete_user_integration(user_id: str, provider: str) -> bool:
    """
    Remove the authenticated user's GitHub integration record.

    The provider parameter is retained to avoid disrupting the current action
    route interface. Unsupported providers are rejected by returning False.
    """
    if provider != GITHUB_PROVIDER:
        return False

    try:
        return await asyncio.to_thread(_delete_github_integration, user_id)
    except SQLAlchemyError as exc:
        raise GitHubOAuthError("GitHub integration deletion failed") from exc
