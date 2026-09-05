"""Short-lived Google OAuth / PKCE transaction state (SQLAlchemy/MySQL).

cookie_nonce proves the callback belongs to the same browser that started the flow.
"""
import secrets
import time
from typing import Optional

from sqlalchemy import delete, select

from app.db.models import OAuthState
from app.db.database import db_session


def save_oauth_state(state: str, code_verifier: str, cookie_nonce: str, ttl_seconds: int) -> None:
    now = int(time.time())
    with db_session() as session:
        session.execute(delete(OAuthState).where(OAuthState.expires_at <= now))
        session.add(
            OAuthState(
                state=state,
                code_verifier=code_verifier,
                cookie_nonce=cookie_nonce,
                expires_at=now + ttl_seconds,
                created_at=now,
            )
        )


def consume_oauth_state(state: str, cookie_nonce: str) -> Optional[str]:
    now = int(time.time())

    with db_session() as session:
        row = session.scalar(
            select(OAuthState)
            .where(OAuthState.state == state)
            .with_for_update()
        )

        if row is None:
            return None

        if row.expires_at <= now:
            session.delete(row)
            return None

        if not secrets.compare_digest(row.cookie_nonce, cookie_nonce):
            return None

        code_verifier = row.code_verifier
        session.delete(row)
        return code_verifier
