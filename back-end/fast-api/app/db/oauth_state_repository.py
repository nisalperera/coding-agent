"""
Short-lived Google OAuth / PKCE transaction state. cookie_nonce proves the
callback belongs to the same browser that started the flow.
"""
import time
from typing import Optional

from app.db.database import db_connection


def save_oauth_state(state: str, code_verifier: str, cookie_nonce: str, ttl_seconds: int) -> None:
    now = int(time.time())
    with db_connection() as connection:
        connection.execute("DELETE FROM oauth_states WHERE expires_at <= ?", (now,))
        connection.execute(
            "INSERT INTO oauth_states (state, code_verifier, cookie_nonce, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
            (state, code_verifier, cookie_nonce, now + ttl_seconds, now),
        )


def consume_oauth_state(state: str, cookie_nonce: str) -> Optional[str]:
    import secrets as _secrets

    now = int(time.time())
    with db_connection() as connection:
        row = connection.execute(
            "SELECT code_verifier, cookie_nonce, expires_at FROM oauth_states WHERE state = ?", (state,)
        ).fetchone()
        connection.execute("DELETE FROM oauth_states WHERE state = ?", (state,))

    if not row or row["expires_at"] <= now:
        return None
    if not _secrets.compare_digest(row["cookie_nonce"], cookie_nonce):
        return None
    return row["code_verifier"]
