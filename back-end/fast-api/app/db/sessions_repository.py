"""Sessions table access (SQLAlchemy/MySQL). Only a SHA-256 hash of the session token is stored."""
import hashlib
import secrets
import time
from typing import Any, Optional

from sqlalchemy import delete, select

from app.core.config import settings
from app.db.models import SessionRecord, User
from app.db.database import db_session


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(user_id: str) -> str:
    now = int(time.time())
    token = secrets.token_urlsafe(48)
    with db_session() as session:
        session.add(
            SessionRecord(
                token_hash=hash_session_token(token),
                user_id=user_id,
                expires_at=now + settings.SESSION_TTL_S,
                created_at=now,
                last_seen_at=now,
            )
        )
    return token


def get_session_user(token: str) -> Optional[dict[str, Any]]:
    now = int(time.time())
    token_hash = hash_session_token(token)

    with db_session() as session:
        session_record = session.scalar(
            select(SessionRecord)
            .where(SessionRecord.token_hash == token_hash)
            .with_for_update()
        )
        if session_record is None:
            return None

        if session_record.expires_at <= now:
            session.delete(session_record)
            return None

        user = session.get(User, session_record.user_id)
        if user is None:
            session.delete(session_record)
            return None

        session_record.last_seen_at = now

        return {
            "user_id": user.user_id,
            "google_sub": user.google_sub,
            "email": user.email,
            "email_verified": user.email_verified,
            "name": user.name,
            "picture": user.picture,
        }


def delete_session(token: str) -> None:
    with db_session() as session:
        session.execute(
            delete(SessionRecord).where(SessionRecord.token_hash == hash_session_token(token))
        )


def purge_expired_sessions() -> int:
    now = int(time.time())
    with db_session() as session:
        result = session.execute(delete(SessionRecord).where(SessionRecord.expires_at <= now))
        return result.rowcount or 0
