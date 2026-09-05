from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor

from app.db.database import db_session
from app.db.models import OAuthState
from app.db.oauth_state_repository import consume_oauth_state, save_oauth_state


def test_save_and_consume_oauth_state_returns_verifier_once() -> None:
    state = "state-valid-once"
    verifier = "pkce-verifier-value"
    nonce = "browser-cookie-nonce"

    save_oauth_state(state, verifier, nonce, ttl_seconds=600)

    assert consume_oauth_state(state, nonce) == verifier
    assert consume_oauth_state(state, nonce) is None


def test_oauth_state_is_removed_after_valid_consumption(db) -> None:
    state = "state-delete-after-consume"
    verifier = "pkce-verifier-value"
    nonce = "browser-cookie-nonce"

    save_oauth_state(state, verifier, nonce, ttl_seconds=600)
    assert consume_oauth_state(state, nonce) == verifier

    assert db.get(OAuthState, state) is None


def test_expired_oauth_state_is_rejected_and_removed() -> None:
    state = "state-expired"
    nonce = "browser-cookie-nonce"

    save_oauth_state(state, "pkce-verifier-value", nonce, ttl_seconds=600)

    with db_session() as session:
        state_row = session.get(OAuthState, state)
        assert state_row is not None
        state_row.expires_at = int(time.time()) - 1

    assert consume_oauth_state(state, nonce) is None


def test_oauth_state_rejects_mismatched_cookie_nonce(db) -> None:
    state = "state-wrong-nonce"
    verifier = "pkce-verifier-value"
    correct_nonce = "browser-cookie-nonce"

    save_oauth_state(state, verifier, correct_nonce, ttl_seconds=600)

    assert consume_oauth_state(state, "different-browser-nonce") is None

    # The valid browser must still be able to complete its login flow.
    assert db.get(OAuthState, state) is not None
    assert consume_oauth_state(state, correct_nonce) == verifier


def test_unknown_oauth_state_is_rejected() -> None:
    assert consume_oauth_state("unknown-state", "any-nonce") is None


def test_save_oauth_state_purges_expired_rows(db) -> None:
    with db_session() as session:
        session.add(
            OAuthState(
                state="stale-state",
                code_verifier="stale-verifier",
                cookie_nonce="stale-nonce",
                created_at=int(time.time()) - 1000,
                expires_at=int(time.time()) - 1,
            )
        )

    save_oauth_state("fresh-state", "fresh-verifier", "fresh-nonce", ttl_seconds=600)

    assert db.get(OAuthState, "stale-state") is None
    assert db.get(OAuthState, "fresh-state") is not None


def test_concurrent_oauth_state_consumption_has_exactly_one_success() -> None:
    state = "state-concurrent-consume"
    verifier = "pkce-verifier-value"
    nonce = "browser-cookie-nonce"
    save_oauth_state(state, verifier, nonce, ttl_seconds=600)

    def consume() -> str | None:
        return consume_oauth_state(state, nonce)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: consume(), range(2)))

    assert results.count(verifier) == 1
    assert results.count(None) == 1