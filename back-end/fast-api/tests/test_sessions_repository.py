from __future__ import annotations

import time

from sqlalchemy import select

from app.core.config import settings
from app.db.database import db_session
from app.db.models import SessionRecord
from app.db.sessions_repository import (
    create_session,
    delete_session,
    get_session_user,
    hash_session_token,
    purge_expired_sessions,
)
from app.db.users_repository import upsert_google_user_claims


def test_hash_session_token_is_sha256_hex_digest() -> None:
    digest = hash_session_token("known-token")

    assert len(digest) == 64
    assert digest == "49e2e40e591e61357758299c8cee170fb9fa7da160ec8acf110a4a409d905aaf"


def test_create_session_returns_opaque_token_and_persists_only_hash(google_claims: dict[str, object], db) -> None:
    user = upsert_google_user_claims(google_claims)

    token = create_session(user["user_id"])
    persisted = db.get(SessionRecord, hash_session_token(token))

    assert token
    assert len(token) >= 64
    assert persisted is not None
    assert persisted.token_hash == hash_session_token(token)
    assert persisted.token_hash != token
    assert persisted.user_id == user["user_id"]
    assert persisted.expires_at > persisted.created_at


def test_get_session_user_returns_safe_authenticated_user(google_claims: dict[str, object]) -> None:
    user = upsert_google_user_claims(google_claims)
    token = create_session(user["user_id"])

    result = get_session_user(token)

    assert result is not None
    assert result["user_id"] == user["user_id"]
    assert result["email"] == "engineer@example.com"
    assert result["email_verified"] is True
    assert "token" not in result
    assert "token_hash" not in result


def test_get_session_user_updates_last_seen_at(google_claims: dict[str, object], db, monkeypatch) -> None:
    user = upsert_google_user_claims(google_claims)
    token = create_session(user["user_id"])
    token_hash = hash_session_token(token)

    before = db.get(SessionRecord, token_hash)
    assert before is not None
    original_last_seen = before.last_seen_at
    db.expire_all()

    future = original_last_seen + 5
    monkeypatch.setattr("app.db.sessions_repository.time.time", lambda: future)

    result = get_session_user(token)
    assert result is not None

    result = get_session_user(token)
    assert result is not None

    db.rollback()
    db.expire_all()

    after = db.get(SessionRecord, token_hash)
    assert after is not None
    assert after.last_seen_at == future


def test_expired_session_is_rejected(google_claims: dict[str, object]) -> None:
    user = upsert_google_user_claims(google_claims)
    token = create_session(user["user_id"])

    with db_session() as session:
        session.execute(
            SessionRecord.__table__.update()
            .where(SessionRecord.token_hash == hash_session_token(token))
            .values(expires_at=int(time.time()) - 1)
        )

    assert get_session_user(token) is None


def test_unknown_session_is_rejected() -> None:
    assert get_session_user("not-a-real-session-token") is None


def test_delete_session_invalidates_token(google_claims: dict[str, object], db) -> None:
    user = upsert_google_user_claims(google_claims)
    token = create_session(user["user_id"])
    token_hash = hash_session_token(token)

    delete_session(token)

    assert db.get(SessionRecord, token_hash) is None
    assert get_session_user(token) is None


def test_purge_expired_sessions_removes_only_expired_rows(google_claims: dict[str, object], db) -> None:
    user = upsert_google_user_claims(google_claims)
    expired_token = create_session(user["user_id"])
    active_token = create_session(user["user_id"])

    with db_session() as session:
        session.execute(
            SessionRecord.__table__.update()
            .where(SessionRecord.token_hash == hash_session_token(expired_token))
            .values(expires_at=int(time.time()) - 1)
        )

    assert purge_expired_sessions() == 1
    assert db.get(SessionRecord, hash_session_token(expired_token)) is None
    assert db.get(SessionRecord, hash_session_token(active_token)) is not None