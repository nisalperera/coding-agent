from __future__ import annotations

import time
import uuid

from app.db.database import db_session
from app.db.models import PendingAction
from app.db.pending_actions_repository import (
    create_pending_action,
    delete_pending_action,
    get_pending_action,
    purge_expired_pending_actions,
)
from app.db.users_repository import upsert_google_user_claims


def _create_user(sub: str, email: str) -> dict[str, object]:
    return upsert_google_user_claims(
        {
            "sub": sub,
            "email": email,
            "email_verified": True,
            "name": email.split("@", 1)[0],
            "picture": None,
        }
    )


def test_create_and_get_pending_action_preserves_structured_args() -> None:
    owner = _create_user("owner-sub", "owner@example.com")
    action_id = str(uuid.uuid4())
    args = {
        "owner": "nisalperera",
        "repo": "coding-agent",
        "path": "README.md",
        "content": "updated content",
    }

    create_pending_action(
        action_id,
        owner["user_id"],
        "create_or_update_file",
        args,
        ttl_seconds=600,
    )

    action = get_pending_action(action_id, user_id=owner["user_id"])

    assert action is not None
    assert action["action_id"] == action_id
    assert action["user_id"] == owner["user_id"]
    assert action["tool_name"] == "create_or_update_file"
    assert action["args"] == args
    assert action["expires_at"] > action["created_at"]


def test_pending_action_is_not_visible_to_another_user() -> None:
    owner = _create_user("owner-sub", "owner@example.com")
    other_user = _create_user("other-sub", "other@example.com")
    action_id = str(uuid.uuid4())

    create_pending_action(
        action_id,
        owner["user_id"],
        "delete_file",
        {"owner": "nisalperera", "repo": "coding-agent", "path": "old.txt"},
    )

    assert get_pending_action(action_id, user_id=other_user["user_id"]) is None
    assert get_pending_action(action_id, user_id=owner["user_id"]) is not None


def test_pending_action_is_unavailable_after_expiry() -> None:
    owner = _create_user("owner-sub", "owner@example.com")
    action_id = str(uuid.uuid4())

    create_pending_action(
        action_id,
        owner["user_id"],
        "create_or_update_file",
        {"path": "README.md"},
    )

    with db_session() as session:
        action = session.get(PendingAction, action_id)
        assert action is not None
        action.expires_at = int(time.time()) - 1

    assert get_pending_action(action_id, user_id=owner["user_id"]) is None


def test_pending_action_delete_is_owner_scoped() -> None:
    owner = _create_user("owner-sub", "owner@example.com")
    other_user = _create_user("other-sub", "other@example.com")
    action_id = str(uuid.uuid4())

    create_pending_action(
        action_id,
        owner["user_id"],
        "create_or_update_file",
        {"path": "README.md"},
    )

    assert delete_pending_action(action_id, user_id=other_user["user_id"]) is False
    assert get_pending_action(action_id, user_id=owner["user_id"]) is not None

    assert delete_pending_action(action_id, user_id=owner["user_id"]) is True
    assert get_pending_action(action_id, user_id=owner["user_id"]) is None


def test_purge_expired_pending_actions_removes_only_expired_actions() -> None:
    owner = _create_user("owner-sub", "owner@example.com")
    expired_action_id = str(uuid.uuid4())
    active_action_id = str(uuid.uuid4())

    create_pending_action(
        expired_action_id,
        owner["user_id"],
        "delete_file",
        {"path": "expired.txt"},
    )
    create_pending_action(
        active_action_id,
        owner["user_id"],
        "delete_file",
        {"path": "active.txt"},
    )

    with db_session() as session:
        expired_action = session.get(PendingAction, expired_action_id)
        assert expired_action is not None
        expired_action.expires_at = int(time.time()) - 1

    assert purge_expired_pending_actions() == 1
    assert get_pending_action(expired_action_id, user_id=owner["user_id"]) is None
    assert get_pending_action(active_action_id, user_id=owner["user_id"]) is not None
