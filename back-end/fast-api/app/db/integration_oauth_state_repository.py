"""Atomic, provider-bound OAuth callback state for user integrations.

The persisted state is single-use and is bound to the initiating user, expected
provider, and an HttpOnly callback-cookie nonce. It must never be returned from
a public API or logged.
"""

from __future__ import annotations

import secrets
import time
from typing import Final, TypedDict

from sqlalchemy import delete, select

from app.db.database import db_session
from app.db.models import IntegrationOAuthState

SUPPORTED_INTEGRATION_PROVIDERS: Final[frozenset[str]] = frozenset(
    {"github", "gitlab"}
)


class ConsumedIntegrationOAuthState(TypedDict):
    """Internal-only callback data required by an OAuth service."""

    user_id: str
    code_verifier: str | None


def _validate_provider(provider: str) -> None:
    if provider not in SUPPORTED_INTEGRATION_PROVIDERS:
        raise ValueError(f"Unsupported integration OAuth provider: {provider!r}")


def save_integration_oauth_state(
    *,
    user_id: str,
    provider: str,
    state: str,
    cookie_nonce: str,
    ttl_seconds: int,
    code_verifier: str | None = None,
) -> None:
    """Persist a short-lived, provider-bound OAuth callback state."""

    _validate_provider(provider)

    if not user_id or not state or not cookie_nonce:
        raise ValueError("user_id, state, and cookie_nonce are required")
    if ttl_seconds <= 0:
        raise ValueError("ttl_seconds must be positive")

    now = int(time.time())
    with db_session() as session:
        session.execute(
            delete(IntegrationOAuthState).where(
                IntegrationOAuthState.expires_at <= now
            )
        )
        session.add(
            IntegrationOAuthState(
                user_id=user_id,
                provider=provider,
                state=state,
                cookie_nonce=cookie_nonce,
                code_verifier=code_verifier,
                expires_at=now + ttl_seconds,
                created_at=now,
            )
        )


def consume_integration_oauth_state(
    *,
    state: str,
    provider: str,
    cookie_nonce: str,
) -> ConsumedIntegrationOAuthState | None:
    """Atomically validate and consume a provider OAuth callback state.

    Provider and nonce mismatches intentionally leave the row intact, allowing
    the legitimate browser callback to complete. Expired records are removed.
    A valid record is deleted in the same transaction before callback handling
    continues, which prevents replay even if token exchange later fails.
    """

    _validate_provider(provider)

    if not state or not cookie_nonce:
        return None

    now = int(time.time())
    with db_session() as session:
        row = session.scalar(
            select(IntegrationOAuthState)
            .where(IntegrationOAuthState.state == state)
            .with_for_update()
        )

        if row is None:
            return None

        if row.provider != provider:
            return None

        if not secrets.compare_digest(row.cookie_nonce, cookie_nonce):
            return None

        if row.expires_at <= now:
            session.delete(row)
            return None

        consumed_state: ConsumedIntegrationOAuthState = {
            "user_id": row.user_id,
            "code_verifier": row.code_verifier,
        }
        session.delete(row)
        return consumed_state
