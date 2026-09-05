"""
Google OpenID Connect login, replacing AWS Cognito federated login entirely.

1. GET /v1/auth/google/login - generates state/cookie_nonce/PKCE verifier,
   persists them in SQLite (10 min TTL), signs {state, cookie_nonce} with
   SESSION_SECRET into an HttpOnly/Secure/SameSite=Lax cookie scoped to
   /v1/auth/google, redirects to Google.
2. GET /v1/auth/google/callback - verifies the signed cookie, confirms
   cookie state == query state, atomically consumes the SQLite record and
   confirms cookie_nonce matches, exchanges the code via PKCE, verifies
   Google's ID token, upserts the user, issues an opaque session token.
"""
import asyncio
import base64
import hashlib
import secrets
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from jwt import PyJWKClient

from app.core.config import settings
from app.db.oauth_state_repository import consume_oauth_state, save_oauth_state
from app.db.sessions_repository import create_session
from app.db.users_repository import upsert_google_user_claims

_oauth_state_serializer = URLSafeTimedSerializer(settings.SESSION_SECRET, salt=settings.OAUTH_STATE_COOKIE_SALT)


async def _google_discovery(request: Request) -> dict[str, Any]:
    cached = getattr(request.app.state, "google_discovery", None)
    if cached:
        return cached
    client: httpx.AsyncClient = request.app.state.http_client
    response = await client.get(settings.GOOGLE_DISCOVERY_URL)
    response.raise_for_status()
    request.app.state.google_discovery = response.json()
    return request.app.state.google_discovery


async def build_login_redirect(request: Request) -> RedirectResponse:
    discovery = await _google_discovery(request)

    state = secrets.token_urlsafe(32)
    cookie_nonce = secrets.token_urlsafe(32)
    code_verifier = secrets.token_urlsafe(64)
    code_challenge_digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    code_challenge = base64.urlsafe_b64encode(code_challenge_digest).rstrip(b"=").decode("ascii")

    signed_state_cookie = _oauth_state_serializer.dumps({"state": state, "nonce": cookie_nonce})
    await asyncio.to_thread(save_oauth_state, state, code_verifier, cookie_nonce, settings.OAUTH_STATE_TTL_S)

    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    response = RedirectResponse(f"{discovery['authorization_endpoint']}?{urlencode(params)}", status_code=302)
    response.set_cookie(
        key=settings.OAUTH_STATE_COOKIE_NAME,
        value=signed_state_cookie,
        max_age=settings.OAUTH_STATE_TTL_S,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
        path="/v1/auth/google",
    )
    return response


async def handle_callback(code: str, state: str, request: Request) -> JSONResponse:
    raw_state_cookie = request.cookies.get(settings.OAUTH_STATE_COOKIE_NAME)
    if not raw_state_cookie:
        raise HTTPException(status_code=400, detail="Missing Google OAuth state cookie")

    try:
        cookie_data = _oauth_state_serializer.loads(raw_state_cookie, max_age=settings.OAUTH_STATE_TTL_S)
        cookie_state = cookie_data["state"]
        cookie_nonce = cookie_data["nonce"]
    except (BadSignature, SignatureExpired, KeyError, TypeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid or expired Google OAuth state cookie") from exc

    if not secrets.compare_digest(cookie_state, state):
        raise HTTPException(status_code=400, detail="Google OAuth state does not match the browser session")

    code_verifier = await asyncio.to_thread(consume_oauth_state, state, cookie_nonce)
    if not code_verifier:
        raise HTTPException(status_code=400, detail="Invalid, expired, or already used Google OAuth state")

    discovery = await _google_discovery(request)
    client: httpx.AsyncClient = request.app.state.http_client
    token_response = await client.post(
        discovery["token_endpoint"],
        data={
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "code": code,
            "code_verifier": code_verifier,
            "grant_type": "authorization_code",
            "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    if token_response.status_code >= 400:
        raise HTTPException(status_code=401, detail="Google authorization code exchange failed")

    id_token = token_response.json().get("id_token")
    if not id_token:
        raise HTTPException(status_code=401, detail="Google did not return an ID token")

    try:
        jwk_client = PyJWKClient(discovery["jwks_uri"])
        signing_key = await asyncio.to_thread(jwk_client.get_signing_key_from_jwt, id_token)
        claims = jwt.decode(
            id_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.GOOGLE_CLIENT_ID,
            issuer=["https://accounts.google.com", "accounts.google.com"],
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Google ID token validation failed") from exc

    user = await asyncio.to_thread(upsert_google_user_claims, claims)
    session_token = await asyncio.to_thread(create_session, user["user_id"])

    response = JSONResponse({
        "authenticated": True,
        "user": user,
        "access_token": session_token,
        "token_type": "Bearer",
        "expires_in": settings.SESSION_TTL_S,
    })
    response.delete_cookie(key=settings.OAUTH_STATE_COOKIE_NAME, path="/v1/auth/google")
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=session_token,
        max_age=settings.SESSION_TTL_S,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite="lax",
        path="/",
    )
    return response
