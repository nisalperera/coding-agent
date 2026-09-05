from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.db.database import db_session
from app.db.integration_oauth_state_repository import (
    consume_integration_oauth_state,
    save_integration_oauth_state,
)
from app.db.models import IntegrationOAuthState, User


def create_user(user_id: str) -> None:
    now = int(time.time())
    with db_session() as session:
        session.add(
            User(
                user_id=user_id,
                google_sub=f"google-{user_id}",
                email=f"{user_id}@example.test",
                email_verified=True,
                name="Integration OAuth Test User",
                picture=None,
                created_at=now,
                updated_at=now,
            )
        )


def test_valid_state_consumes_once_and_returns_user_binding() -> None:
    user_id = "10000000-0000-0000-0000-000000000001"
    create_user(user_id)

    save_integration_oauth_state(
        user_id=user_id,
        provider="github",
        state="github-valid-state",
        cookie_nonce="github-valid-nonce",
        ttl_seconds=600,
    )

    assert consume_integration_oauth_state(
        state="github-valid-state",
        provider="github",
        cookie_nonce="github-valid-nonce",
    ) == {
        "user_id": user_id,
        "code_verifier": None,
    }

    assert consume_integration_oauth_state(
        state="github-valid-state",
        provider="github",
        cookie_nonce="github-valid-nonce",
    ) is None


def test_gitlab_state_returns_pkce_verifier() -> None:
    user_id = "10000000-0000-0000-0000-000000000002"
    create_user(user_id)

    save_integration_oauth_state(
        user_id=user_id,
        provider="gitlab",
        state="gitlab-valid-state",
        cookie_nonce="gitlab-valid-nonce",
        code_verifier="gitlab-s256-verifier",
        ttl_seconds=600,
    )

    assert consume_integration_oauth_state(
        state="gitlab-valid-state",
        provider="gitlab",
        cookie_nonce="gitlab-valid-nonce",
    ) == {
        "user_id": user_id,
        "code_verifier": "gitlab-s256-verifier",
    }


def test_wrong_provider_preserves_state_for_expected_provider(db) -> None:
    user_id = "10000000-0000-0000-0000-000000000003"
    create_user(user_id)

    save_integration_oauth_state(
        user_id=user_id,
        provider="github",
        state="provider-bound-state",
        cookie_nonce="provider-bound-nonce",
        ttl_seconds=600,
    )

    assert consume_integration_oauth_state(
        state="provider-bound-state",
        provider="gitlab",
        cookie_nonce="provider-bound-nonce",
    ) is None

    assert db.get(IntegrationOAuthState, "provider-bound-state") is not None

    assert consume_integration_oauth_state(
        state="provider-bound-state",
        provider="github",
        cookie_nonce="provider-bound-nonce",
    ) == {
        "user_id": user_id,
        "code_verifier": None,
    }


def test_wrong_nonce_preserves_state_for_legitimate_browser(db) -> None:
    user_id = "10000000-0000-0000-0000-000000000004"
    create_user(user_id)

    save_integration_oauth_state(
        user_id=user_id,
        provider="gitlab",
        state="nonce-bound-state",
        cookie_nonce="correct-browser-nonce",
        code_verifier="gitlab-s256-verifier",
        ttl_seconds=600,
    )

    assert consume_integration_oauth_state(
        state="nonce-bound-state",
        provider="gitlab",
        cookie_nonce="wrong-browser-nonce",
    ) is None

    assert db.get(IntegrationOAuthState, "nonce-bound-state") is not None

    assert consume_integration_oauth_state(
        state="nonce-bound-state",
        provider="gitlab",
        cookie_nonce="correct-browser-nonce",
    ) == {
        "user_id": user_id,
        "code_verifier": "gitlab-s256-verifier",
    }


def test_expired_state_is_rejected_and_removed(db) -> None:
    user_id = "10000000-0000-0000-0000-000000000005"
    create_user(user_id)

    save_integration_oauth_state(
        user_id=user_id,
        provider="github",
        state="expired-state",
        cookie_nonce="expired-nonce",
        ttl_seconds=600,
    )

    with db_session() as session:
        state_row = session.get(IntegrationOAuthState, "expired-state")
        assert state_row is not None
        state_row.expires_at = int(time.time()) - 1

    assert consume_integration_oauth_state(
        state="expired-state",
        provider="github",
        cookie_nonce="expired-nonce",
    ) is None

    assert db.get(IntegrationOAuthState, "expired-state") is None


def test_saving_state_purges_expired_rows(db) -> None:
    user_id = "10000000-0000-0000-0000-000000000006"
    create_user(user_id)

    with db_session() as session:
        session.add(
            IntegrationOAuthState(
                user_id=user_id,
                provider="github",
                state="stale-state",
                cookie_nonce="stale-nonce",
                code_verifier=None,
                created_at=int(time.time()) - 1000,
                expires_at=int(time.time()) - 1,
            )
        )

    save_integration_oauth_state(
        user_id=user_id,
        provider="github",
        state="fresh-state",
        cookie_nonce="fresh-nonce",
        ttl_seconds=600,
    )

    assert db.get(IntegrationOAuthState, "stale-state") is None
    assert db.get(IntegrationOAuthState, "fresh-state") is not None


def test_unknown_state_is_rejected() -> None:
    assert consume_integration_oauth_state(
        state="unknown-state",
        provider="github",
        cookie_nonce="any-nonce",
    ) is None


@pytest.mark.parametrize("provider", ["", "bitbucket", "GITHUB"])
def test_unsupported_provider_is_rejected(provider: str) -> None:
    with pytest.raises(ValueError):
        save_integration_oauth_state(
            user_id="10000000-0000-0000-0000-000000000007",
            provider=provider,
            state="state",
            cookie_nonce="nonce",
            ttl_seconds=600,
        )

    with pytest.raises(ValueError):
        consume_integration_oauth_state(
            state="state",
            provider=provider,
            cookie_nonce="nonce",
        )


def test_concurrent_state_consumption_has_exactly_one_success() -> None:
    user_id = "10000000-0000-0000-0000-000000000008"
    create_user(user_id)

    save_integration_oauth_state(
        user_id=user_id,
        provider="gitlab",
        state="concurrent-state",
        cookie_nonce="concurrent-nonce",
        code_verifier="gitlab-s256-verifier",
        ttl_seconds=600,
    )

    def consume() -> dict[str, str | None] | None:
        return consume_integration_oauth_state(
            state="concurrent-state",
            provider="gitlab",
            cookie_nonce="concurrent-nonce",
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: consume(), range(2)))

    assert results.count(
        {
            "user_id": user_id,
            "code_verifier": "gitlab-s256-verifier",
        }
    ) == 1
    assert results.count(None) == 1
