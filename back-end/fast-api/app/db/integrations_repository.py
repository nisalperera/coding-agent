"""user_integrations table access (replaces DynamoDB user-integrations table)."""
import time
from typing import Any, Optional

from app.db.database import db_connection


def store_user_integration(user_id: str, provider: str, access_token: str, username: str) -> None:
    now = int(time.time())
    with db_connection() as connection:
        connection.execute(
            """
            INSERT INTO user_integrations (user_id, provider, access_token, username, connected_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, provider) DO UPDATE SET
                access_token = excluded.access_token, username = excluded.username, connected_at = excluded.connected_at
            """,
            (user_id, provider, access_token, username, now),
        )


def get_user_integration(user_id: str, provider: str) -> Optional[dict[str, Any]]:
    with db_connection() as connection:
        row = connection.execute(
            "SELECT user_id, provider, access_token, username, connected_at FROM user_integrations WHERE user_id = ? AND provider = ?",
            (user_id, provider),
        ).fetchone()
    return dict(row) if row else None


def delete_user_integration(user_id: str, provider: str) -> None:
    with db_connection() as connection:
        connection.execute("DELETE FROM user_integrations WHERE user_id = ? AND provider = ?", (user_id, provider))
