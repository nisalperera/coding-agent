"""Pure session-cookie policy. No application imports or database access."""
def build_session_cookie_options(*, name: str, ttl_seconds: int,
                                 secure: bool, same_site: str) -> dict:
    if not isinstance(name, str) or not name.strip():
        raise ValueError("SESSION_COOKIE_NAME must be nonempty")
    if isinstance(ttl_seconds, bool) or not isinstance(ttl_seconds, int) or ttl_seconds <= 0:
        raise ValueError("SESSION_TTL_S must be a positive integer")
    if not isinstance(secure, bool):
        raise ValueError("COOKIE_SECURE must be a boolean")
    if not isinstance(same_site, str):
        raise ValueError("SESSION_COOKIE_SAMESITE must be lax, strict, or none")
    same_site = same_site.strip().lower()
    if same_site not in {"lax", "strict", "none"}:
        raise ValueError("SESSION_COOKIE_SAMESITE must be lax, strict, or none")
    if same_site == "none" and not secure:
        raise ValueError("SESSION_COOKIE_SAMESITE=none requires COOKIE_SECURE=true")
    return {"key": name, "max_age": ttl_seconds, "path": "/",
            "secure": secure, "httponly": True, "samesite": same_site}
