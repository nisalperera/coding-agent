"""Data-access functions for the `users` table."""
import time
import uuid
from typing import Any, Optional

from fastapi import HTTPException

from app.core.config import settings
from app.db.database import db_connection


def upsert_google_user(claims: dict[str, Any]) -> dict[str, Any]:
    google_sub = claims.get("sub")
    email = claims.get("email")
    email_verified = bool(claims.get("email_verified"))
    if not google_sub or not email or not email_verified:
        raise HTTPException(status_code=401, detail="Google did not return a verified email identity")

    if settings.GOOGLE_ALLOWED_EMAIL_DOMAIN and not email.lower().endswith(
        "@" + settings.GOOGLE_ALLOWED_EMAIL_DOMAIN.lower().lstrip("@")
    ):
        raise HTTPException(status_code=403, detail="This Google Workspace domain is not allowed")

    now = int(time.time())
    with db_connection() as connection:
        existing = connection.execute("SELECT user_id FROM users WHERE google_sub = ?", (google_sub,)).fetchone()
        user_id = existing["user_id"] if existing else str(uuid.uuid4())
        connection.execute(
            """
            INSERT INTO users (user_id, google_sub, email, email_verified, name, picture, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(google_sub) DO UPDATE SET
                email = excluded.email, email_verified = excluded.email_verified,
                name = excluded.name, picture = excluded.picture, updated_at = excluded.updated_at
            """,
            (user_id, google_sub, email, int(email_verified), claims.get("name"), claims.get("picture"), now, now),
        )
    return {"user_id": user_id, "email": email, "name": claims.get("name"), "picture": claims.get("picture")}


def get_user_by_id(user_id: str) -> Optional[dict[str, Any]]:
    with db_connection() as connection:
        row = connection.execute("SELECT user_id, email, name, picture FROM users WHERE user_id = ?", (user_id,)).fetchone()
    return dict(row) if row else None
