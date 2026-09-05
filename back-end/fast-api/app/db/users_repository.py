"""Data-access functions for the `users` table (SQLAlchemy/MySQL)."""
import time
import uuid
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.db.models import User
from app.db.database import db_session


def upsert_google_user_claims(claims: dict[str, Any]) -> dict[str, Any]:
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
    name = claims.get("name")
    picture = claims.get("picture")

    with db_session() as session:
        user = session.scalar(select(User).where(User.google_sub == google_sub))
        if user is None:
            user = User(
                user_id=str(uuid.uuid4()),
                google_sub=google_sub,
                email=email,
                email_verified=email_verified,
                name=name,
                picture=picture,
                created_at=now,
                updated_at=now,
            )
            session.add(user)
            try:
                session.flush()
            except IntegrityError:
                session.rollback()
                user = session.scalar(select(User).where(User.google_sub == google_sub))
                if user is None:
                    raise
                _apply_google_claims(user, email, email_verified, name, picture, now)
        else:
            _apply_google_claims(user, email, email_verified, name, picture, now)

        user_id = user.user_id

    return {"user_id": user_id, "email": email, "name": name, "picture": picture}


def _apply_google_claims(
    user: User,
    email: str,
    email_verified: bool,
    name: Optional[str],
    picture: Optional[str],
    now: int,
) -> None:
    user.email = email
    user.email_verified = email_verified
    user.name = name
    user.picture = picture
    user.updated_at = now


def get_user_by_id(user_id: str) -> Optional[dict[str, Any]]:
    with db_session() as session:
        user = session.get(User, user_id)
        if user is None:
            return None
        return {
            "user_id": user.user_id,
            "email": user.email,
            "name": user.name,
            "picture": user.picture,
        }
