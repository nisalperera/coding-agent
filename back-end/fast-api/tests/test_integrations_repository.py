from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core import crypto
from app.core.crypto import TokenEncryptionError, decrypt_token
from app.db.integrations_repository import (
    IntegrationNotFoundError,
    integrations_repository,
)
from app.db.models import Base


TEST_ENCRYPTION_KEY = Fernet.generate_key().decode("utf-8")


@pytest.fixture(autouse=True)
def configured_test_fernet(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Use an isolated process-local key and clear the cached Fernet instance."""
    monkeypatch.setattr(
        crypto.settings,
        "INTEGRATION_TOKEN_ENCRYPTION_KEY",
        TEST_ENCRYPTION_KEY,
    )
    crypto._fernet.cache_clear()
    yield
    crypto._fernet.cache_clear()


@pytest.fixture
def db_session() -> Iterator[Session]:
    """Provide an isolated SQLAlchemy database session for repository tests."""
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)

    session_factory = sessionmaker(
        bind=engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )
    session = session_factory()

    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_create_stores_encrypted_tokens(db_session: Session) -> None:
    access_token = "test-access-token"
    refresh_token = "test-refresh-token"

    integration = integrations_repository.create_or_update(
        db_session,
        user_id="00000000-0000-0000-0000-000000000001",
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


def test_get_decrypted_tokens_returns_original_values(db_session: Session) -> None:
    user_id = "00000000-0000-0000-0000-000000000002"

    integrations_repository.create_or_update(
        db_session,
        user_id=user_id,
        provider="github",
        access_token="test-access-token",
        refresh_token="test-refresh-token",
        username="octocat",
    )

    access_token, refresh_token = (
        integrations_repository.get_decrypted_tokens_for_provider(
            db_session,
            user_id=user_id,
            provider="github",
        )
    )

    assert access_token == "test-access-token"
    assert refresh_token == "test-refresh-token"


def test_update_without_refresh_token_preserves_existing_token(
    db_session: Session,
) -> None:
    user_id = "00000000-0000-0000-0000-000000000003"

    original = integrations_repository.create_or_update(
        db_session,
        user_id=user_id,
        provider="github",
        access_token="first-access-token",
        refresh_token="persistent-refresh-token",
        username="octocat",
    )
    original_refresh_ciphertext = original.refresh_token_ciphertext

    updated = integrations_repository.create_or_update(
        db_session,
        user_id=user_id,
        provider="github",
        access_token="second-access-token",
        refresh_token=None,
        username="octocat-updated",
    )

    assert updated.access_token_ciphertext != "second-access-token"
    assert updated.refresh_token_ciphertext == original_refresh_ciphertext
    assert updated.refresh_token_ciphertext is not None
    assert decrypt_token(updated.refresh_token_ciphertext) == "persistent-refresh-token"


def test_missing_integration_raises_not_found(db_session: Session) -> None:
    with pytest.raises(IntegrationNotFoundError):
        integrations_repository.get_decrypted_tokens_for_provider(
            db_session,
            user_id="00000000-0000-0000-0000-000000000004",
            provider="github",
        )


def test_delete_removes_integration(db_session: Session) -> None:
    user_id = "00000000-0000-0000-0000-000000000005"

    integrations_repository.create_or_update(
        db_session,
        user_id=user_id,
        provider="github",
        access_token="test-access-token",
        username="octocat",
    )

    assert integrations_repository.delete_by_user_and_provider(
        db_session,
        user_id=user_id,
        provider="github",
    )
    assert (
        integrations_repository.get_by_user_and_provider(
            db_session,
            user_id=user_id,
            provider="github",
        )
        is None
    )


def test_empty_access_token_is_rejected(db_session: Session) -> None:
    with pytest.raises(TokenEncryptionError, match="empty token"):
        integrations_repository.create_or_update(
            db_session,
            user_id="00000000-0000-0000-0000-000000000006",
            provider="github",
            access_token="",
            username="octocat",
        )