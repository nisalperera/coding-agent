"""
back-end/github_oauth.py

GitHub OAuth App "user-to-server" token exchange for the coding agent.

This module is intentionally standalone/additive: it does not modify
lambda_function.py's existing streaming chat/tool-loop logic. Wire it in
with the small dispatch snippet documented in the PR description, mirroring
the existing `action == "approve_pending"` branch already in
lambda_function.py.

Flow:
  1. Front-end (front-end/index.html, connectGitHub()) redirects the user to
     GitHub's authorize endpoint with a PKCE-independent CSRF `state`.
  2. GitHub redirects back to /callback/github with `code` + `state`.
  3. Front-end POSTs {"action": "github_oauth_callback", "code": ..., "redirect_uri": ...}
     to the existing Lambda Function URL, authenticated with the user's
     Cognito access token (Authorization: Bearer ...).
  4. lambda_function.py verifies the Cognito token (existing verify_token()),
     extracts user_id = claims["sub"], and calls handle_github_oauth_callback()
     from this module.
  5. This module exchanges the code for a GitHub access token (server-side,
     using the OAuth App's client secret — never exposed to the browser),
     fetches the GitHub username, and stores {user_id, provider, access_token,
     username} in the UserIntegrationsTable DynamoDB table.

Required environment variables (set via template.yaml parameters):
  GITHUB_OAUTH_CLIENT_ID
  GITHUB_OAUTH_CLIENT_SECRET
  USER_INTEGRATIONS_TABLE   (defaults to "user-integrations")
"""
import json
import os
import time

import boto3
import urllib3

http = urllib3.PoolManager()
dynamodb = boto3.resource("dynamodb")

GITHUB_OAUTH_CLIENT_ID = os.environ.get("GITHUB_OAUTH_CLIENT_ID", "")
GITHUB_OAUTH_CLIENT_SECRET = os.environ.get("GITHUB_OAUTH_CLIENT_SECRET", "")
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USER_URL = "https://api.github.com/user"

USER_INTEGRATIONS_TABLE_NAME = os.environ.get("USER_INTEGRATIONS_TABLE", "user-integrations")
user_integrations_table = dynamodb.Table(USER_INTEGRATIONS_TABLE_NAME)


class GitHubOAuthError(Exception):
    pass


def _exchange_code_for_token(code, redirect_uri):
    payload = json.dumps({
        "client_id": GITHUB_OAUTH_CLIENT_ID,
        "client_secret": GITHUB_OAUTH_CLIENT_SECRET,
        "code": code,
        "redirect_uri": redirect_uri,
    }).encode("utf-8")

    resp = http.request(
        "POST",
        GITHUB_TOKEN_URL,
        body=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    data = json.loads(resp.data.decode("utf-8"))

    if resp.status != 200 or "access_token" not in data:
        raise GitHubOAuthError(data.get("error_description", data.get("error", "token exchange failed")))

    return data["access_token"]


def _fetch_github_username(access_token):
    resp = http.request(
        "GET",
        GITHUB_USER_URL,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github+json",
            "User-Agent": "nisals-coding-agent",
        },
    )
    if resp.status != 200:
        raise GitHubOAuthError("could not fetch GitHub user profile")
    data = json.loads(resp.data.decode("utf-8"))
    return data.get("login", "")


def store_user_integration(user_id, provider, access_token, username):
    user_integrations_table.put_item(Item={
        "user_id": user_id,
        "provider": provider,
        "access_token": access_token,
        "username": username,
        "connected_at": int(time.time()),
    })


def get_user_integration(user_id, provider):
    return user_integrations_table.get_item(
        Key={"user_id": user_id, "provider": provider}
    ).get("Item")


def delete_user_integration(user_id, provider):
    user_integrations_table.delete_item(Key={"user_id": user_id, "provider": provider})


def handle_github_oauth_callback(body, user_id):
    """
    Returns a (status_code, response_dict) tuple. Caller (lambda_function.py)
    is responsible for writing json.dumps(response_dict).encode() to the
    response_stream, matching the existing pattern used for other actions.
    """
    code = body.get("code")
    redirect_uri = body.get("redirect_uri")
    if not code or not redirect_uri:
        return 400, {"error": "missing_code_or_redirect_uri"}

    try:
        access_token = _exchange_code_for_token(code, redirect_uri)
        username = _fetch_github_username(access_token)
        store_user_integration(user_id, "github", access_token, username)
    except GitHubOAuthError as exc:
        return 400, {"error": str(exc)}
    except Exception:
        return 500, {"error": "github_oauth_failed"}

    return 200, {"connected": True, "provider": "github", "username": username}
