"""Sessions table access. Only a SHA-256 hash of the session token is stored."""
import hashlib
import secrets
import time
from typing import Any, Optional

from app.core.config import settings
from app.db.database import db_connection


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(user_id: str) -> str:
    now = int(time.time())
    token = secrets.token_urlsafe(48)
    with db_connection() as connection:
        connection.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
            (hash_session_token(token), user_id, now + settings.SESSION_TTL_S, now, now),
        )
    return token


def get_session_user(token: str) -> Optional[dict[str, Any]]:
    now = int(time.time())
    token_hash = hash_session_token(token)
    with db_connection() as connection:
        row = connection.execute(
            """
            SELECT u.user_id, u.google_sub, u.email, u.email_verified, u.name, u.picture
            FROM sessions AS s JOIN users AS u ON u.user_id = s.user_id
            WHERE s.token_hash = ? AND s.expires_at > ?
            """,
            (token_hash, now),
        ).fetchone()
        if row:
            connection.execute("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?", (now, token_hash))
    return dict(row) if row else None


def delete_session(token: str) -> None:
    with db_connection() as connection:
        connection.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_session_token(token),))


def purge_expired_sessions() -> int:
    now = int(time.time())
    with db_connection() as connection:
        cursor = connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
        return cursor.rowcount
