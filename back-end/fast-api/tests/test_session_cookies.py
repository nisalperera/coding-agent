"""Cookie wiring tests. Run through the guarded disposable sandbox only."""
import asyncio
from http.cookies import SimpleCookie
from types import SimpleNamespace
import httpx
import pytest
from fastapi import FastAPI
from fastapi.responses import Response
from fastapi.testclient import TestClient
from app.api.auth import router
from app.core.config import settings
from app.core.security import set_auth_cookie
from app.auth.session_cookie import clear_session_cookie, set_session_cookie, session_cookie_options

def cookie_from(response, name):
    get_headers = getattr(response.headers, "get_list", None)
    if get_headers is None:
        get_headers = response.headers.getlist
    for header in get_headers("set-cookie"):
        parsed = SimpleCookie()
        parsed.load(header)
        if name in parsed:
            return parsed[name]
    raise AssertionError("Expected cookie header was not issued")

@pytest.fixture
def local_policy(monkeypatch):
    monkeypatch.setenv("SESSION_COOKIE_SAMESITE", "lax")
    monkeypatch.setattr(settings, "COOKIE_SECURE", False)
    monkeypatch.setattr(settings, "SESSION_TTL_S", 1200)
    monkeypatch.setattr(settings, "JWT_EXPIRES_MINUTES", 1)

def test_password_helper_uses_session_ttl_not_jwt(local_policy):
    response = Response()
    set_auth_cookie(response, "opaque-test-token")
    cookie = cookie_from(response, settings.SESSION_COOKIE_NAME)
    assert cookie["max-age"] == "1200"
    assert cookie["samesite"] == "lax"
    assert cookie["path"] == "/"
    assert cookie["httponly"]

def test_issue_and_clear_share_policy(local_policy, monkeypatch):
    monkeypatch.setenv("SESSION_COOKIE_SAMESITE", "none")
    monkeypatch.setattr(settings, "COOKIE_SECURE", True)
    issued, cleared = Response(), Response()
    set_session_cookie(issued, "opaque-test-token")
    clear_session_cookie(cleared)
    first = cookie_from(issued, settings.SESSION_COOKIE_NAME)
    second = cookie_from(cleared, settings.SESSION_COOKIE_NAME)
    for attribute in ["path", "domain", "secure", "httponly", "samesite"]:
        assert first[attribute] == second[attribute]
    assert second["max-age"] == "0"

def test_insecure_cross_site_configuration_refused(local_policy, monkeypatch):
    monkeypatch.setenv("SESSION_COOKIE_SAMESITE", "none")
    with pytest.raises(ValueError, match="requires COOKIE_SECURE"):
        session_cookie_options()

def test_logout_revokes_token_and_clears_cookie(local_policy, monkeypatch):
    import app.api.auth as auth_routes
    revoked = []
    async def revoke(token):
        revoked.append(token)
    monkeypatch.setattr(auth_routes, "delete_session_to_logout", revoke)
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        response = client.post("/v1/auth/logout", headers={"Cookie": f"{settings.SESSION_COOKIE_NAME}=opaque-test-token"})
    assert response.status_code == 200
    assert response.json() == {"logged_out": True}
    assert revoked == ["opaque-test-token"]
    assert cookie_from(response, settings.SESSION_COOKIE_NAME)["max-age"] == "0"

def test_google_callback_uses_same_session_policy(local_policy, monkeypatch):
    from app.services import google_oauth_service as google
    async def discovery(request):
        return {"token_endpoint": "https://oauth.example.test/token", "jwks_uri": "https://oauth.example.test/keys"}
    class FakeKeys:
        def __init__(self, url):
            pass
        def get_signing_key_from_jwt(self, token):
            return SimpleNamespace(key="unused-test-key")
    monkeypatch.setattr(google, "_google_discovery", discovery)
    monkeypatch.setattr(google, "consume_oauth_state", lambda state, nonce: "test-verifier")
    monkeypatch.setattr(google, "PyJWKClient", FakeKeys)
    monkeypatch.setattr(google.jwt, "decode", lambda *args, **kwargs: {"sub": "test-subject"})
    monkeypatch.setattr(google, "upsert_google_user_claims", lambda claims: {"user_id": "test-user"})
    monkeypatch.setattr(google, "create_session", lambda user_id: "opaque-google-token")
    monkeypatch.setattr(google, "create_integration_settings", lambda user: None)
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"id_token": "test-id-token"}))
    http_client = httpx.AsyncClient(transport=transport)
    app = FastAPI()
    app.state.http_client = http_client
    app.include_router(router)
    state_cookie = google._oauth_state_serializer.dumps({"state": "test-state", "nonce": "test-nonce"})
    try:
        with TestClient(app, follow_redirects=False) as client:
            response = client.get("/v1/auth/google/callback", params={"code": "test-code", "state": "test-state"},
                                  headers={"Cookie": f"{settings.OAUTH_STATE_COOKIE_NAME}={state_cookie}"})
        assert response.status_code == 303
        cookie = cookie_from(response, settings.SESSION_COOKIE_NAME)
        assert cookie.value == "opaque-google-token"
        assert cookie["max-age"] == "1200"
        assert cookie["samesite"] == "lax"
        state = cookie_from(response, settings.OAUTH_STATE_COOKIE_NAME)
        assert state["max-age"] == "0"
        assert state["samesite"] == "lax"
    finally:
        asyncio.run(http_client.aclose())
