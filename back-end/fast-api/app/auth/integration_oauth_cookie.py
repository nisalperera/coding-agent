"""Signed provider-bound integration OAuth callback cookie helpers."""

from __future__ import annotations

from typing import Final

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from app.core.config import settings

_SUPPORTED_PROVIDERS: Final[frozenset[str]] = frozenset({"github", "gitlab"})


def _serializer() -> URLSafeTimedSerializer:
    """
    Return a serializer dedicated to integration OAuth callback cookies.

    SESSION_SECRET is the private signing key.
    INTEGRATION_OAUTH_STATE_COOKIE_SALT provides purpose separation from
    Google-login callback cookies and other signed application values.
    """
    return URLSafeTimedSerializer(
        secret_key=settings.SESSION_SECRET,
        salt=settings.INTEGRATION_OAUTH_STATE_COOKIE_SALT,
    )


def encode_integration_oauth_callback_cookie(
    *,
    provider: str,
    cookie_nonce: str,
) -> str:
    """
    Sign a provider-specific callback nonce.

    The returned value belongs only in a short-lived HttpOnly cookie. It must
    never be included in URLs, JSON API responses, browser storage, or logs.
    """
    if provider not in _SUPPORTED_PROVIDERS:
        raise ValueError("Unsupported OAuth integration provider")

    if not isinstance(cookie_nonce, str) or not cookie_nonce:
        raise ValueError("OAuth callback nonce is required")

    return _serializer().dumps(
        {
            "provider": provider,
            "cookie_nonce": cookie_nonce,
        }
    )


def decode_integration_oauth_callback_cookie(
    *,
    provider: str,
    cookie_value: str | None,
) -> str | None:
    """
    Verify and decode a provider-specific signed callback cookie.

    Return None for absent, malformed, tampered, expired, or cross-provider
    values. The caller must treat None as a safe OAuth callback failure.
    """
    if provider not in _SUPPORTED_PROVIDERS or not cookie_value:
        return None

    try:
        payload = _serializer().loads(
            cookie_value,
            max_age=settings.INTEGRATION_OAUTH_STATE_TTL_S,
        )
    except (BadSignature, SignatureExpired):
        return None

    if not isinstance(payload, dict):
        return None

    if payload.get("provider") != provider:
        return None

    cookie_nonce = payload.get("cookie_nonce")
    if not isinstance(cookie_nonce, str) or not cookie_nonce:
        return None

    return cookie_nonce
