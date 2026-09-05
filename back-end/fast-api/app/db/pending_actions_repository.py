"""Transactional pending-action persistence backed by MySQL/InnoDB."""

from __future__ import annotations

import time
from typing import Any

from sqlalchemy import delete, select

from app.db.database import db_session
from app.db.models import PendingAction


def create_pending_action(
    action_id: str,
    user_id: str,
    tool_name: str,
    args: dict[str, Any],
    ttl_seconds: int = 600,
) -> None:
    now = int(time.time())

    with db_session() as session:
        session.add(
            PendingAction(
                action_id=action_id,
                user_id=user_id,
                tool_name=tool_name,
                args=args,
                created_at=now,
                expires_at=now + ttl_seconds,
            )
        )


def get_pending_action(
    action_id: str,
    *,
    user_id: str | None = None,
) -> dict[str, Any] | None:
    now = int(time.time())

    with db_session() as session:
        statement = select(PendingAction).where(
            PendingAction.action_id == action_id,
            PendingAction.expires_at > now,
        )
        if user_id is not None:
            statement = statement.where(PendingAction.user_id == user_id)

        action = session.scalar(statement)
        if action is None:
            return None

        return {
            "action_id": action.action_id,
            "user_id": action.user_id,
            "tool_name": action.tool_name,
            "args": action.args,
            "created_at": action.created_at,
            "expires_at": action.expires_at,
        }


def delete_pending_action(
    action_id: str,
    *,
    user_id: str | None = None,
) -> bool:
    with db_session() as session:
        statement = delete(PendingAction).where(
            PendingAction.action_id == action_id
        )
        if user_id is not None:
            statement = statement.where(PendingAction.user_id == user_id)

        result = session.execute(statement)
        return bool(result.rowcount)


def purge_expired_pending_actions() -> int:
    now = int(time.time())

    with db_session() as session:
        result = session.execute(
            delete(PendingAction).where(PendingAction.expires_at <= now)
        )
        return result.rowcount or 0
