"""pending_actions table access (replaces DynamoDB pending-actions table)."""
import json
import time
from typing import Any, Optional

from app.db.database import db_connection


def create_pending_action(action_id: str, user_id: str, tool_name: str, args: dict[str, Any], ttl_seconds: int = 600) -> None:
    now = int(time.time())
    with db_connection() as connection:
        connection.execute(
            "INSERT INTO pending_actions (action_id, user_id, tool_name, args_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
            (action_id, user_id, tool_name, json.dumps(args), now, now + ttl_seconds),
        )


def get_pending_action(action_id: str) -> Optional[dict[str, Any]]:
    with db_connection() as connection:
        row = connection.execute(
            "SELECT action_id, user_id, tool_name, args_json, created_at, expires_at FROM pending_actions WHERE action_id = ?",
            (action_id,),
        ).fetchone()
    if not row:
        return None
    item = dict(row)
    item["args"] = json.loads(item.pop("args_json"))
    return item


def delete_pending_action(action_id: str) -> None:
    with db_connection() as connection:
        connection.execute("DELETE FROM pending_actions WHERE action_id = ?", (action_id,))


def purge_expired_pending_actions() -> int:
    now = int(time.time())
    with db_connection() as connection:
        cursor = connection.execute("DELETE FROM pending_actions WHERE expires_at <= ?", (now,))
        return cursor.rowcount
