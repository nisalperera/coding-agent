from __future__ import annotations

from collections.abc import Iterator

import pytest
from cryptography.fernet import Fernet
from sqlalchemy.orm import Session

from app.core import crypto
from app.core.crypto import TokenEncryptionError, decrypt_token
from app.db.integrations_repository import (
    IntegrationCredentialError,
    IntegrationNotFoundError,
    integrations_repository,
)
from app.db.users_repository import upsert_google_user_claims

TEST_ENCRYPTION_KEY = Fernet.generate_key().decode("utf-8")


@pytest.fixture(autouse=True)
def configured_test_fernet(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Use an isolated process-local Fernet key for each test."""
    monkeypatch.setattr(
        crypto.settings,
        "INTEGRATION_TOKEN_ENCRYPTION_KEY",
        TEST_ENCRYPTION_KEY,
    )
    crypto._fernet.cache_clear()
    yield
    crypto._fernet.cache_clear()


def create_user(suffix: str) -> str:
    """Create a MySQL-backed user required by the integration foreign key."""
    user = upsert_google_user_claims(
        {
            "sub": f"integration-test-google-sub-{suffix}",
            "email": f"integration-{suffix}@example.test",
            "email_verified": True,
            "name": "Integration Test User",
            "picture": None,
        },
    )
    return user["user_id"]


def test_create_stores_encrypted_tokens(db: Session) -> None:
    access_token = "test-access-token"
    refresh_token = "test-refresh-token"
    user_id = create_user(suffix="create")

    integration = integrations_repository.create_or_update(
        db,
        user_id=user_id,
        provider="github",
        access_token=access_token,
        refresh_token=refresh_token,
        username="octocat",
    )

    assert integration.access_token_ciphertext != access_token
    assert integration.refresh_token_ciphertext != refresh_token
    assert decrypt_token(integration.access_token_ciphertext) == access_token
    assert integration.refresh_token_ciphertext is not None
    assert decrypt_token(integration.refresh_token_ciphertext) == refresh_token


def test_get_decrypted_tokens_returns_original_values(db: Session) -> None:
    user_id = create_user(suffix="decrypt")

    integrations_repository.create_or_update(
        db,
        user_id=user_id,
        provider="github",
        access_token="test-access-token",
        refresh_token="test-refresh-token",
        username="octocat",
    )

    access_token, refresh_token = (
        integrations_repository.get_decrypted_tokens_for_provider(
            db,
            user_id=user_id,
            provider="github",
        )
    )

    assert access_token == "test-access-token"
    assert refresh_token == "test-refresh-token"


def test_update_without_refresh_token_preserves_existing_token(db: Session) -> None:
    user_id = create_user(suffix="preserve-refresh")

    original = integrations_repository.create_or_update(
        db,
        user_id=user_id,
        provider="github",
        access_token="first-access-token",
        refresh_token="persistent-refresh-token",
        username="octocat",
    )
    original_refresh_ciphertext = original.refresh_token_ciphertext

    updated = integrations_repository.create_or_update(
        db,
        user_id=user_id,
        provider="github",
        access_token="second-access-token",
        username="octocat-updated",
    )

    assert updated.access_token_ciphertext != "second-access-token"
    assert updated.refresh_token_ciphertext == original_refresh_ciphertext
    assert updated.refresh_token_ciphertext is not None
    assert decrypt_token(updated.refresh_token_ciphertext) == "persistent-refresh-token"


def test_missing_integration_raises_not_found(db: Session) -> None:
    user_id = create_user(suffix="missing")

    with pytest.raises(IntegrationNotFoundError):
        integrations_repository.get_decrypted_tokens_for_provider(
            db,
            user_id=user_id,
            provider="github",
        )


def test_delete_removes_integration(db: Session) -> None:
    user_id = create_user(suffix="delete")

    integrations_repository.create_or_update(
        db,
        user_id=user_id,
        provider="github",
        access_token="test-access-token",
        username="octocat",
    )

    assert integrations_repository.delete_by_user_and_provider(
        db,
        user_id=user_id,
        provider="github",
    )
    assert (
        integrations_repository.get_by_user_and_provider(
            db,
            user_id=user_id,
            provider="github",
        )
        is None
    )
    assert not integrations_repository.delete_by_user_and_provider(
        db,
        user_id=user_id,
        provider="github",
    )


def test_empty_access_token_is_rejected(db: Session) -> None:
    user_id = create_user(suffix="empty-token")

    with pytest.raises(TokenEncryptionError, match="empty token"):
        integrations_repository.create_or_update(
            db,
            user_id=user_id,
            provider="github",
            access_token="",
            username="octocat",
        )


def test_malformed_access_ciphertext_fails_closed(db: Session) -> None:
    user_id = create_user(suffix="malformed-access")

    integration = integrations_repository.create_or_update(
        db,
        user_id=user_id,
        provider="github",
        access_token="test-access-token",
    )
    integration.access_token_ciphertext = "not-valid-fernet-ciphertext"
    db.flush()

    with pytest.raises(IntegrationCredentialError):
        integrations_repository.get_decrypted_tokens_for_provider(
            db,
            user_id=user_id,
            provider="github",
        )


def test_malformed_refresh_ciphertext_fails_closed(db: Session) -> None:
    user_id = create_user(suffix="malformed-refresh")

    integration = integrations_repository.create_or_update(
        db,
        user_id=user_id,
        provider="gitlab",
        access_token="test-access-token",
        refresh_token="test-refresh-token",
    )
    integration.refresh_token_ciphertext = "not-valid-fernet-ciphertext"
    db.flush()

    with pytest.raises(IntegrationCredentialError):
        integrations_repository.get_decrypted_tokens_for_provider(
            db,
            user_id=user_id,
            provider="gitlab",
        )


def test_public_status_excludes_credentials_expiry_and_scopes(db: Session) -> None:
    user_id = create_user(suffix="public-status")

    integrations_repository.create_or_update(
        db,
        user_id=user_id,
        provider="gitlab",
        access_token="access-token-never-public",
        refresh_token="refresh-token-never-public",
        token_expires_at=1_800_000_000,
        username="gitlab-user",
        scopes="read_user",
    )

    status = integrations_repository.get_public_status_by_user_and_provider(
        db,
        user_id=user_id,
        provider="gitlab",
    )

    assert status.connected is True
    assert status.username == "gitlab-user"
    assert isinstance(status.connected_at, int)
    assert not hasattr(status, "access_token")
    assert not hasattr(status, "refresh_token")
    assert not hasattr(status, "token_expires_at")
    assert not hasattr(status, "scopes")


def test_public_status_returns_disconnected_defaults(db: Session) -> None:
    user_id = create_user(suffix="disconnected")

    status = integrations_repository.get_public_status_by_user_and_provider(
        db,
        user_id=user_id,
        provider="github",
    )

    assert status.connected is False
    assert status.username is None
    assert status.connected_at is None


def test_disconnect_cannot_delete_another_users_integration(db: Session) -> None:
    owner_id = create_user(suffix="owner")
    other_user_id = create_user(suffix="other")

    integrations_repository.create_or_update(
        db,
        user_id=owner_id,
        provider="github",
        access_token="owner-token",
    )

    assert not integrations_repository.delete_by_user_and_provider(
        db,
        user_id=other_user_id,
        provider="github",
    )
    assert integrations_repository.get_by_user_and_provider(
        db,
        user_id=owner_id,
        provider="github",
    ) is not None


def test_update_can_explicitly_clear_refresh_token(db: Session) -> None:
    user_id = create_user(suffix="clear-refresh")

    integrations_repository.create_or_update(
        db,
        user_id=user_id,
        provider="gitlab",
        access_token="first-access-token",
        refresh_token="refresh-token",
    )
    updated = integrations_repository.create_or_update(
        db,
        user_id=user_id,
        provider="gitlab",
        access_token="second-access-token",
        refresh_token=None,
    )

    assert updated.refresh_token_ciphertext is None


def test_unsupported_provider_is_rejected(db: Session) -> None:
    user_id = create_user(suffix="unsupported-provider")

    with pytest.raises(ValueError, match="Unsupported integration provider"):
        integrations_repository.create_or_update(
            db,
            user_id=user_id,
            provider="unknown-provider",
            access_token="test-access-token",
        )
