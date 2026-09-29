from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.db.models import User
from app.db.users_repository import get_user_by_id, upsert_google_user_claims


def test_upsert_google_user_creates_verified_user(google_claims: dict[str, object], db) -> None:
    result = upsert_google_user_claims(google_claims)

    user = db.get(User, result["user_id"])
    assert user is not None
    assert user.google_sub == "google-subject-123"
    assert user.email == "engineer@example.com"
    assert user.email_verified is True
    assert user.name == "Test Engineer"
    assert user.picture == "https://example.test/avatar.png"
    assert result == {
        "user_id": user.user_id,
        "email": "engineer@example.com",
        "name": "Test Engineer",
        "picture": "https://example.test/avatar.png",
    }


def test_upsert_google_user_preserves_stable_user_id(google_claims: dict[str, object], db) -> None:
    first = upsert_google_user_claims(google_claims)

    updated_claims = {
        **google_claims,
        "email": "renamed@example.com",
        "name": "Renamed Engineer",
        "picture": "https://example.test/renamed-avatar.png",
    }
    second = upsert_google_user_claims(updated_claims)

    assert second["user_id"] == first["user_id"]
    assert db.scalar(select(func.count()).select_from(User)) == 1

    user = db.get(User, first["user_id"])
    assert user is not None
    assert user.email == "renamed@example.com"
    assert user.name == "Renamed Engineer"
    assert user.picture == "https://example.test/renamed-avatar.png"


def test_upsert_google_user_rejects_missing_google_subject(google_claims: dict[str, object]) -> None:
    google_claims.pop("sub")

    with pytest.raises(HTTPException) as exc_info:
        upsert_google_user_claims(google_claims)

    assert exc_info.value.status_code == 401


def test_upsert_google_user_rejects_unverified_email(google_claims: dict[str, object]) -> None:
    google_claims["email_verified"] = False

    with pytest.raises(HTTPException) as exc_info:
        upsert_google_user_claims(google_claims)

    assert exc_info.value.status_code == 401
    assert "verified email" in str(exc_info.value.detail).lower()


def test_upsert_google_user_rejects_disallowed_domain(
    monkeypatch,
    google_claims: dict[str, object],
) -> None:
    import app.db.users_repository as users_repository

    monkeypatch.setattr(
        users_repository.settings,
        "GOOGLE_ALLOWED_EMAIL_DOMAIN",
        "allowed.example",
    )
    google_claims["email"] = "engineer@not-allowed.example"

    with pytest.raises(HTTPException) as exc_info:
        users_repository.upsert_google_user_claims(google_claims)

    assert exc_info.value.status_code == 403
    assert "not allowed" in str(exc_info.value.detail).lower()


def test_get_user_by_id_returns_safe_user_payload(google_claims: dict[str, object]) -> None:
    created = upsert_google_user_claims(google_claims)

    user = get_user_by_id(created["user_id"])

    assert user == {
        "user_id": created["user_id"],
        "email": "engineer@example.com",
        "name": "Test Engineer",
        "picture": "https://example.test/avatar.png",
    }
    assert "google_sub" not in user
    assert "token" not in user
    assert "token_hash" not in user


def test_get_user_by_id_returns_none_for_missing_user() -> None:
    assert get_user_by_id("00000000-0000-0000-0000-000000000000") is None
