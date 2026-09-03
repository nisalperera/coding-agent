// front-end/js/integrations.js
//
// GitHub and GitLab repository-access integrations.
//
// GitHub: OAuth App "user-to-server" flow. GitHub's token exchange requires
// a client secret, so this module only performs the browser-side authorize
// redirect. The actual code-for-token exchange happens server-side via
// POST {BACKEND_URL}/v1/actions with {"action": "github_oauth_callback"}
// (see back-end/app/services/github_oauth_service.py and
// back-end/app/api/actions.py). The resulting token is stored server-side
// in SQLite (user_integrations table) and is injected automatically for
// every github_* tool call this user's session makes — see
// app/tools/dispatch.py's call_repo_tool().
//
// GitLab: registered as a "public"/native OAuth application, enabling a
// full Authorization Code + PKCE exchange directly from the browser without
// a client secret. Unlike GitHub, this token is NEVER sent to the backend
// to be stored — it lives only in this browser's localStorage and is
// attached to a single /v1/actions request body (as gitlab_token) only at
// the moment a gitlab_* tool call needs approving (see chat.js). The
// backend uses it for that one call and never persists it.

import { apiFetch, ApiError } from "./api.js";
import { generateRandomToken, generateCodeChallenge } from "./pkce.js";

const GITHUB_CLIENT_ID = window.APP_CONFIG.GITHUB_OAUTH_CLIENT_ID;
const GITHUB_REDIRECT_URI = `${window.location.origin}/callback/github`;
const GITHUB_SCOPES = "repo read:user";

const GITLAB_CLIENT_ID = window.APP_CONFIG.GITLAB_OAUTH_CLIENT_ID;
const GITLAB_OAUTH_DOMAIN = "https://gitlab.com";
const GITLAB_REDIRECT_URI = `${window.location.origin}/callback/gitlab`;
const GITLAB_SCOPES = "api read_repository write_repository";

// ---------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------

export function isGitHubConnected() {
  return localStorage.getItem("github_connected") === "true";
}

export function getGitHubUsername() {
  return localStorage.getItem("github_username") || "";
}

export function connectGitHub() {
  const state = generateRandomToken();
  sessionStorage.setItem("github_oauth_state", state);
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_REDIRECT_URI,
    scope: GITHUB_SCOPES,
    state,
    allow_signup: "false",
  });
  window.location.href = `https://github.com/login/oauth/authorize?${params}`;
}

/**
 * Call on GET /callback/github. Returns {ok, message} describing the
 * outcome so the caller (main.js) can render it in the chat transcript.
 */
export async function handleGitHubCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = sessionStorage.getItem("github_oauth_state");
  sessionStorage.removeItem("github_oauth_state");
  window.history.replaceState({}, "", "/");

  if (!code) return null;
  if (!state || state !== expected) {
    return { ok: false, message: "GitHub connection failed: state mismatch. Please try connecting again." };
  }

  try {
    const data = await apiFetch("/v1/actions", {
      method: "POST",
      body: { action: "github_oauth_callback", code, redirect_uri: GITHUB_REDIRECT_URI },
    });
    localStorage.setItem("github_connected", "true");
    localStorage.setItem("github_username", data.username || "");
    return { ok: true, message: `GitHub connected${data.username ? ` as **@${data.username}**` : ""}.` };
  } catch (err) {
    const detail = err instanceof ApiError ? err.message : String(err);
    return { ok: false, message: `Could not finish connecting GitHub (${detail}).` };
  }
}

/**
 * Disconnecting GitHub also revokes the token stored server-side (SQLite),
 * via the "disconnect_integration" action — not just this browser's local
 * flag. Best-effort: local state is cleared even if the network call
 * fails, since the user's intent is "stop using my GitHub identity" either way.
 */
export async function disconnectGitHub() {
  let warning = null;
  try {
    await apiFetch("/v1/actions", {
      method: "POST",
      body: { action: "disconnect_integration", provider: "github" },
    });
  } catch (err) {
    const detail = err instanceof ApiError ? err.message : String(err);
    warning = `Could not confirm GitHub token removal on the server (${detail}). Cleared locally; if this keeps happening, revoke access from GitHub settings directly.`;
  }

  localStorage.removeItem("github_connected");
  localStorage.removeItem("github_username");

  return warning
    ? { ok: false, message: warning }
    : { ok: true, message: "GitHub disconnected \u2014 the stored server-side token was revoked." };
}

// ---------------------------------------------------------------------
// GitLab
// ---------------------------------------------------------------------

export function isGitLabConnected() {
  return localStorage.getItem("gitlab_connected") === "true";
}

export function getGitLabAccessToken() {
  return localStorage.getItem("gitlab_access_token");
}

export async function connectGitLab() {
  const verifier = generateRandomToken();
  sessionStorage.setItem("gitlab_pkce_verifier", verifier);
  const state = generateRandomToken();
  sessionStorage.setItem("gitlab_oauth_state", state);
  const challenge = await generateCodeChallenge(verifier);

  const params = new URLSearchParams({
    client_id: GITLAB_CLIENT_ID,
    redirect_uri: GITLAB_REDIRECT_URI,
    response_type: "code",
    scope: GITLAB_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  window.location.href = `${GITLAB_OAUTH_DOMAIN}/oauth/authorize?${params}`;
}

/** Call on GET /callback/gitlab. Exchanges the code directly with GitLab (no backend involved). */
export async function handleGitLabCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = sessionStorage.getItem("gitlab_oauth_state");
  const verifier = sessionStorage.getItem("gitlab_pkce_verifier");
  sessionStorage.removeItem("gitlab_oauth_state");
  sessionStorage.removeItem("gitlab_pkce_verifier");
  window.history.replaceState({}, "", "/");

  if (!code) return null;
  if (!state || state !== expected) {
    return { ok: false, message: "GitLab connection failed: state mismatch. Please try connecting again." };
  }

  try {
    const resp = await fetch(`${GITLAB_OAUTH_DOMAIN}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GITLAB_CLIENT_ID,
        code,
        grant_type: "authorization_code",
        redirect_uri: GITLAB_REDIRECT_URI,
        code_verifier: verifier,
      }),
    });
    if (!resp.ok) throw new Error(`GitLab returned ${resp.status}`);
    const tokens = await resp.json();
    localStorage.setItem("gitlab_access_token", tokens.access_token);
    localStorage.setItem("gitlab_refresh_token", tokens.refresh_token || "");
    localStorage.setItem("gitlab_connected", "true");
    return { ok: true, message: "GitLab connected." };
  } catch (err) {
    return { ok: false, message: `Could not finish connecting GitLab (${err.message}).` };
  }
}

/** GitLab tokens are never sent to the backend, so disconnecting is purely local. */
export function disconnectGitLab() {
  localStorage.removeItem("gitlab_connected");
  localStorage.removeItem("gitlab_access_token");
  localStorage.removeItem("gitlab_refresh_token");
  localStorage.removeItem("gitlab_username");
  return { ok: true, message: "GitLab disconnected from this browser." };
}
