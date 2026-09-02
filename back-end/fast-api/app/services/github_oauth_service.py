"""
GitHub OAuth App "user-to-server" token exchange. Exchanges the auth code
server-side (client secret never exposed to the browser), fetches the GitHub
username, and stores {user_id, provider, access_token, username} in SQLite.
"""
from typing import Any, Optional

import httpx

from app.core.config import settings
from app.db.integrations_repository import delete_user_integration as _delete_user_integration
from app.db.integrations_repository import get_user_integration as _get_user_integration
from app.db.integrations_repository import store_user_integration


class GitHubOAuthError(Exception):
    pass


async def _exchange_code_for_token(client: httpx.AsyncClient, code: str, redirect_uri: str) -> str:
    response = await client.post(
        settings.GITHUB_TOKEN_URL,
        json={
            "client_id": settings.GITHUB_OAUTH_CLIENT_ID,
            "client_secret": settings.GITHUB_OAUTH_CLIENT_SECRET,
            "code": code,
            "redirect_uri": redirect_uri,
        },
        headers={"Content-Type": "application/json", "Accept": "application/json"},
    )
    data = response.json()
    if response.status_code != 200 or "access_token" not in data:
        raise GitHubOAuthError(data.get("error_description", data.get("error", "token exchange failed")))
    return data["access_token"]


async def _fetch_github_username(client: httpx.AsyncClient, access_token: str) -> str:
    response = await client.get(
        settings.GITHUB_USER_URL,
        headers={"Authorization": f"Bearer {access_token}", "Accept": "application/vnd.github+json", "User-Agent": "coding-agent"},
    )
    if response.status_code != 200:
        raise GitHubOAuthError("could not fetch GitHub user profile")
    return response.json().get("login", "")


def get_user_integration(user_id: str, provider: str) -> Optional[dict[str, Any]]:
    return _get_user_integration(user_id, provider)


def delete_user_integration(user_id: str, provider: str) -> None:
    _delete_user_integration(user_id, provider)


async def handle_github_oauth_callback(client: httpx.AsyncClient, body: dict[str, Any], user_id: str) -> tuple[int, dict[str, Any]]:
    code = body.get("code")
    redirect_uri = body.get("redirect_uri")
    if not code or not redirect_uri:
        return 400, {"error": "missing_code_or_redirect_uri"}

    try:
        access_token = await _exchange_code_for_token(client, code, redirect_uri)
        username = await _fetch_github_username(client, access_token)
        store_user_integration(user_id, "github", access_token, username)
    except GitHubOAuthError as exc:
        return 400, {"error": str(exc)}
    except Exception:
        return 500, {"error": "github_oauth_failed"}

    return 200, {"connected": True, "provider": "github", "username": username}
