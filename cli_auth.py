"""
[FINAL] CLI OAuth 2.0 Authorization Code + PKCE flow against Amazon Cognito.
Federated sign-in via Google and GitHub. Tokens stored in OS keyring
(Keychain / Credential Manager / Secret Service), never in plaintext files.
"""
import base64
import hashlib
import http.server
import secrets
import threading
import urllib.parse
import webbrowser

import keyring
import requests

COGNITO_DOMAIN = "https://coding-agent-pool.auth.us-east-1.amazoncognito.com"
CLIENT_ID = "YOUR_APP_CLIENT_ID"
REDIRECT_URI = "http://localhost:8765/callback"
SERVICE_NAME = "coding-agent-cli"

_auth_code = {}


class CallbackHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)
        _auth_code["code"] = params.get("code", [None])[0]
        self.send_response(200)
        self.send_header("Content-type", "text/html")
        self.end_headers()
        self.wfile.write(b"<h2>Login successful. You can close this tab.</h2>")

    def log_message(self, fmt, *args):
        pass


def login():
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("=")
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).decode().rstrip("=")

    print("Choose provider: Google or GitHub")
    provider = input("> ").strip()

    params = urllib.parse.urlencode({
        "client_id": CLIENT_ID, "response_type": "code",
        "scope": "openid email profile", "redirect_uri": REDIRECT_URI,
        "code_challenge": challenge, "code_challenge_method": "S256",
    })
    auth_url = f"{COGNITO_DOMAIN}/oauth2/authorize?{params}&identity_provider={provider}"

    server = http.server.HTTPServer(("localhost", 8765), CallbackHandler)
    threading.Thread(target=server.handle_request, daemon=True).start()
    webbrowser.open(auth_url)
    print("Opening browser for login...")

    while "code" not in _auth_code:
        pass
    server.shutdown()

    resp = requests.post(f"{COGNITO_DOMAIN}/oauth2/token", data={
        "grant_type": "authorization_code", "client_id": CLIENT_ID,
        "code": _auth_code["code"], "redirect_uri": REDIRECT_URI,
        "code_verifier": verifier,
    })
    tokens = resp.json()
    keyring.set_password(SERVICE_NAME, "access_token", tokens["access_token"])
    keyring.set_password(SERVICE_NAME, "refresh_token", tokens.get("refresh_token", ""))
    print("Logged in successfully.")


def refresh_access_token():
    refresh_token = keyring.get_password(SERVICE_NAME, "refresh_token")
    if not refresh_token:
        return None
    resp = requests.post(f"{COGNITO_DOMAIN}/oauth2/token", data={
        "grant_type": "refresh_token", "client_id": CLIENT_ID,
        "refresh_token": refresh_token,
    })
    tokens = resp.json()
    if "access_token" in tokens:
        keyring.set_password(SERVICE_NAME, "access_token", tokens["access_token"])
        return tokens["access_token"]
    return None


def get_access_token():
    return keyring.get_password(SERVICE_NAME, "access_token")


def logout():
    keyring.delete_password(SERVICE_NAME, "access_token")
    keyring.delete_password(SERVICE_NAME, "refresh_token")
    print("Logged out.")
