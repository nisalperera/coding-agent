import re

from datetime import datetime

from fastapi import HTTPException
from fastapi.responses import Response

from app.schemas import LoginRequest, UserResponse
from app.core.security import hash_password, set_auth_cookie, verify_password
from app.db.sessions_repository import create_session
from app.db.models import User, new_uuid
from app.db.users_repository import get_user_by_email, get_users_count_by_prefix, put_user

MAX_USERNAME_LENGTH = 64

def normalize_email(email: str) -> str:
    return email.strip().lower()


def username_base_from_email(email: str) -> str:
    local_part = normalize_email(email).split("@", 1)[0]

    username = re.sub(r"[^a-z0-9]+", "-", local_part)
    username = username.strip("-")

    return (username or "user")[:MAX_USERNAME_LENGTH]


async def generate_unique_username(
    email: str,
) -> str:
    base = username_base_from_email(email)
    candidate = base

    existing = get_users_count_by_prefix(candidate)

    if existing == 0:
        return candidate

    suffix_text = f"-{existing + 1}"
    return f"{base[:MAX_USERNAME_LENGTH - len(suffix_text)]}{suffix_text}"


async def check_if_user_exists(email: str) -> bool:
    existing_user = get_user_by_email(email)  # Raises HTTPException if user exists
    if existing_user:
        raise HTTPException(
            status_code=409,
            detail="Unable to create an account with these details",
        )
    return existing_user is not None


async def save_user(username: str, email: str, name: str, password: str, response: Response) -> User:
    now = int(datetime.now().timestamp())
    user = User(
            user_id=new_uuid(),
            username=username,
            email=email,
            email_verified=False,
            name=name,
            picture=None,
            google_sub=None,
            password_hash=hash_password(password),
            auth_provider="password",
            created_at=now,
            updated_at=now,
        )
    
    saved_user = await put_user(user)  # Raises HTTPException if user exists

    token = create_session(user_id=user.user_id)
    set_auth_cookie(response, token)

    return saved_user


async def user_login(payload: LoginRequest, response: Response) -> UserResponse:
    email = normalize_email(str(payload.email))
    
    user = await get_user_by_email(email, return_password=True)  # Raises HTTPException if user does not exist

    hashed_password = user.pop("password_hash") if user else None

    invalid_credentials = HTTPException(
        status_code=401,
        detail="Invalid email or password",
    )

    if not user or not hashed_password:
        raise invalid_credentials

    if not verify_password(payload.password, hashed_password):
        raise invalid_credentials

    token = create_session(user_id=user["user_id"])
    set_auth_cookie(response, token)

    return UserResponse(**user)