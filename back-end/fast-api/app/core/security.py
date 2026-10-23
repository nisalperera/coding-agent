from datetime import datetime, timedelta, timezone

import jwt
from pwdlib import PasswordHash
from fastapi.responses import Response

from app.core.config import settings
from app.auth.session_cookie import set_session_cookie


password_hasher = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return password_hasher.verify(password, password_hash)


def decode_access_token(token: str) -> dict:
    payload = jwt.decode(
        token,
        settings.JWT_SECRET,
        algorithms=[settings.JWT_ALGORITHM],
    )

    if payload.get("type") != "access":
        raise jwt.InvalidTokenError("Invalid token type")

    return payload

def set_auth_cookie(response: Response, token: str) -> None:
    set_session_cookie(response, token)