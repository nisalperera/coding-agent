"""Persistence helpers for encrypted GitHub and GitLab OAuth integrations."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Final

from cryptography.fernet import InvalidToken
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.crypto import TokenEncryptionError, decrypt_token, encrypt_token
from app.db.models import UserIntegration

SUPPORTED_PROVIDERS: Final[frozenset[str]] = frozenset({"github", "gitlab"})
_UNSET: Final[object] = object()


class IntegrationNotFoundError(LookupError):
    """Raised when an integration cannot be found for a requested user/provider."""


class IntegrationCredentialError(RuntimeError):
    """Raised when persisted integration ciphertext cannot be safely decrypted."""


@dataclass(frozen=True)
class PublicIntegrationStatus:
    """Safe integration metadata suitable for authenticated API responses."""

    connected: bool
    username: str | None
    connected_at: int | None


class IntegrationsRepository:
    """Persist provider credentials encrypted and decrypt only for provider API calls."""

    @staticmethod
    def _validate_provider(provider: str) -> None:
        if provider not in SUPPORTED_PROVIDERS:
            raise ValueError(f"Unsupported integration provider: {provider!r}")

    def get_by_user_and_provider(
        self,
        db: Session,
        *,
        user_id: str,
        provider: str,
    ) -> UserIntegration | None:
        """Return an integration with credential fields still encrypted."""
        self._validate_provider(provider)

        statement = select(UserIntegration).where(
            UserIntegration.user_id == user_id,
            UserIntegration.provider == provider,
        )
        return db.scalar(statement)

    def create_or_update(
        self,
        db: Session,
        *,
        user_id: str,
        provider: str,
        access_token: str,
        refresh_token: str | None | object = _UNSET,
        token_expires_at: int | None = None,
        username: str | None = None,
        scopes: str | None = None,
    ) -> UserIntegration:
        """Create or update an integration, encrypting tokens before persistence."""
        self._validate_provider(provider)

        now = int(time.time())
        integration = self.get_by_user_and_provider(
            db,
            user_id=user_id,
            provider=provider,
        )

        access_token_ciphertext = encrypt_token(access_token)
        refresh_token_ciphertext: str | None | object = _UNSET

        if refresh_token is not _UNSET:
            refresh_token_ciphertext = (
                encrypt_token(refresh_token)
                if refresh_token is not None
                else None
            )

        if integration is None:
            integration = UserIntegration(
                user_id=user_id,
                provider=provider,
                access_token_ciphertext=access_token_ciphertext,
                refresh_token_ciphertext=(
                    None
                    if refresh_token_ciphertext is _UNSET
                    else refresh_token_ciphertext
                ),
                token_expires_at=token_expires_at,
                username=username,
                scopes=scopes,
                connected_at=now,
                updated_at=now,
            )
            db.add(integration)
        else:
            integration.access_token_ciphertext = access_token_ciphertext

            if refresh_token_ciphertext is not _UNSET:
                integration.refresh_token_ciphertext = refresh_token_ciphertext

            integration.token_expires_at = token_expires_at
            integration.username = username
            integration.scopes = scopes
            integration.updated_at = now

        db.flush()
        return integration

    def get_decrypted_tokens_for_provider(
        self,
        db: Session,
        *,
        user_id: str,
        provider: str,
    ) -> tuple[str, str | None]:
        """Return decrypted tokens only immediately before a provider API call."""
        integration = self.get_by_user_and_provider(
            db,
            user_id=user_id,
            provider=provider,
        )
        if integration is None:
            raise IntegrationNotFoundError(
                "No integration exists for the requested provider and user"
            )

        try:
            access_token = decrypt_token(integration.access_token_ciphertext)
            refresh_token = (
                decrypt_token(integration.refresh_token_ciphertext)
                if integration.refresh_token_ciphertext
                else None
            )
        except (InvalidToken, TokenEncryptionError, TypeError, ValueError) as exc:
            raise IntegrationCredentialError(
                "Stored integration credentials are unavailable"
            ) from exc

        return access_token, refresh_token

    def get_public_status_by_user_and_provider(
        self,
        db: Session,
        *,
        user_id: str,
        provider: str,
    ) -> PublicIntegrationStatus:
        """Return only non-sensitive connection metadata."""
        integration = self.get_by_user_and_provider(
            db,
            user_id=user_id,
            provider=provider,
        )

        if integration is None:
            return PublicIntegrationStatus(
                connected=False,
                username=None,
                connected_at=None,
            )

        return PublicIntegrationStatus(
            connected=True,
            username=integration.username,
            connected_at=integration.connected_at,
        )

    def delete_by_user_and_provider(
        self,
        db: Session,
        *,
        user_id: str,
        provider: str,
    ) -> bool:
        """Delete local encrypted integration credentials for one owner/provider."""
        integration = self.get_by_user_and_provider(
            db,
            user_id=user_id,
            provider=provider,
        )
        if integration is None:
            return False

        db.delete(integration)
        db.flush()
        return True


integrations_repository = IntegrationsRepository()
