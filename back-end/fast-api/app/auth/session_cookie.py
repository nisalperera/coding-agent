"""Shared issue/clear policy for opaque database-session cookies."""
import os
from app.core.config import settings
from app.core.session_cookie_policy import build_session_cookie_options

def session_cookie_options() -> dict:
    # Settings imports load the normal deployment environment before this lookup.
    return build_session_cookie_options(
        name=settings.SESSION_COOKIE_NAME,
        ttl_seconds=settings.SESSION_TTL_S,
        secure=settings.COOKIE_SECURE,
        same_site=os.environ.get("SESSION_COOKIE_SAMESITE", "lax"),
    )

def set_session_cookie(response, token: str) -> None:
    if not isinstance(token, str) or not token:
        raise ValueError("A nonempty session token is required")
    response.set_cookie(value=token, **session_cookie_options())

def clear_session_cookie(response) -> None:
    options = session_cookie_options()
    options.pop("max_age")
    response.delete_cookie(**options)
