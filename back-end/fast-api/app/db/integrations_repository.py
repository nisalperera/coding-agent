"""Persistence helpers for encrypted GitHub and GitLab OAuth integrations."""

from __future__ import annotations

import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.crypto import decrypt_token, encrypt_token
from app.db.models import UserIntegration


class IntegrationNotFoundError(LookupError):
    """Raised when an integration cannot be found for a requested user/provider."""


class IntegrationsRepository:
    """Persist provider credentials encrypted and decrypt only for provider API calls."""

    def get_by_user_and_provider(
        self,
        db: Session,
        *,
        user_id: str,
        provider: str,
    ) -> UserIntegration | None:
        """Return an integration with ciphertext fields still encrypted."""
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
        refresh_token: str | None = None,
        token_expires_at: int | None = None,
        username: str | None = None,
    ) -> UserIntegration:
        """Create or update an integration, encrypting tokens before persistence."""
        now = int(time.time())

        integration = self.get_by_user_and_provider(
            db,
            user_id=user_id,
            provider=provider,
        )

        access_token_ciphertext = encrypt_token(access_token)
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
                refresh_token_ciphertext=refresh_token_ciphertext,
                token_expires_at=token_expires_at,
                username=username,
                connected_at=now,
                updated_at=now,
            )
            db.add(integration)
        else:
            integration.access_token_ciphertext = access_token_ciphertext
            if refresh_token is not None:
                integration.refresh_token_ciphertext = refresh_token_ciphertext
            integration.token_expires_at = token_expires_at
            integration.username = username
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
        """Return decrypted tokens only for an internal provider API request."""
        integration = self.get_by_user_and_provider(
            db,
            user_id=user_id,
            provider=provider,
        )
        if integration is None:
            raise IntegrationNotFoundError(
                f"No {provider!r} integration exists for user {user_id}"
            )

        access_token = decrypt_token(integration.access_token_ciphertext)
        refresh_token = (
            decrypt_token(integration.refresh_token_ciphertext)
            if integration.refresh_token_ciphertext
            else None
        )
        return access_token, refresh_token

    def delete_by_user_and_provider(
        self,
        db: Session,
        *,
        user_id: str,
        provider: str,
    ) -> bool:
        """Delete an integration and its encrypted token ciphertext."""
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
