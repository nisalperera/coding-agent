"""Signed, time-limited OAuth state tokens for third-party integrations
(GitHub, GitLab). Uses the same secret material as the session layer but a
dedicated salt, so integration OAuth state tokens cannot be replayed as
session tokens or as the unrelated Google-login OAuth state.

Requires `itsdangerous` (already a common FastAPI/session dependency; add to
requirements.txt if not already present).
"""
from __future__ import annotations

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.core.config import settings


class OAuthStateError(Exception):
    """Raised when an integration OAuth state token is missing, expired, or invalid."""


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(
        settings.SESSION_SECRET,
        salt=settings.INTEGRATION_OAUTH_STATE_COOKIE_SALT,
    )


def issue_state(user_id: str, provider: str) -> str:
    """Create a signed state token binding this OAuth attempt to a user and provider."""
    return _serializer().dumps({"user_id": user_id, "provider": provider})


def verify_state(token: str, *, provider: str) -> str:
    """Verify a signed state token and return the bound user_id.

    Raises OAuthStateError if the token is missing, expired, tampered with, or
    was issued for a different provider than the callback being handled.
    """
    if not token:
        raise OAuthStateError("Missing OAuth state")

    try:
        payload = _serializer().loads(
            token,
            max_age=settings.INTEGRATION_OAUTH_STATE_TTL_S,
        )
    except SignatureExpired as exc:
        raise OAuthStateError("OAuth state expired") from exc
    except BadSignature as exc:
        raise OAuthStateError("Invalid OAuth state") from exc

    if not isinstance(payload, dict) or payload.get("provider") != provider:
        raise OAuthStateError("OAuth state provider mismatch")

    user_id = payload.get("user_id")
    if not isinstance(user_id, str) or not user_id:
        raise OAuthStateError("OAuth state missing user_id")

    return user_id