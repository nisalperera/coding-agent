// front-end/js/auth.js
//
// Application login, replacing the old AWS Cognito Hosted UI + PKCE flow.
//
// The FastAPI backend (see back-end/app/services/google_oauth_service.py)
// now owns the entire Google OAuth + PKCE exchange server-side:
//
//   1. The browser navigates (full page load, NOT fetch) to
//      GET {BACKEND_URL}/v1/auth/google/login.
//   2. The backend redirects to Google, and Google redirects back to the
//      backend's own callback endpoint
//      (GET {BACKEND_URL}/v1/auth/google/callback), never to this front-end
//      directly. The backend validates everything (state, PKCE, ID token)
//      and returns a JSON body: {authenticated, user, access_token, ...}.
//   3. Because that callback response is JSON rendered at the backend's
//      origin (not a redirect back to the SPA), the recommended integration
//      is to make the backend's callback endpoint itself redirect to
//      "{FRONTEND_ORIGIN}/auth/complete#token=<access_token>" after success.
//      This module's completeLoginFromUrlFragment() picks that token up.
//
// If your deployment instead keeps the backend callback as a same-origin
// path behind a reverse proxy (e.g. "/api/v1/auth/google/callback" fronted
// by the same nginx serving this SPA), you can skip the fragment-redirect
// step entirely and have the backend set the agent_session cookie only;
// requests will authenticate via that cookie automatically since apiFetch()
// always sends credentials: "include". In that setup access_token handling
// below becomes optional and localStorage is used purely as a convenience
// for the Authorization header case documented in api.js.

import { setSessionToken, apiFetch, ApiError } from "./api.js";

const BACKEND_URL = window.APP_CONFIG.BACKEND_URL;

export function isSignedIn() {
  return Boolean(localStorage.getItem("agent_session_token") || document.cookie.includes("agent_session="));
}

export function getCachedUser() {
  const raw = localStorage.getItem("agent_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function cacheUser(user) {
  if (user) {
    localStorage.setItem("agent_user", JSON.stringify(user));
  } else {
    localStorage.removeItem("agent_user");
  }
}

/** Starts the Google login flow with a full-page redirect to the backend. */
export function loginWithGoogle() {
  window.location.href = `${BACKEND_URL}/v1/auth/google/login`;
}

/**
 * Call once on app boot. If the URL contains "#token=...&..." (the fragment
 * the backend's OAuth callback redirects the browser to on success), stores
 * the session token, cleans the URL, and fetches the current user profile.
 */
export async function completeLoginFromUrlFragment() {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const token = fragment.get("token");
  if (!token) return false;

  setSessionToken(token);
  window.history.replaceState({}, "", window.location.pathname);

  await refreshCurrentUser();
  return true;
}

/** Fetches /v1/auth/me and updates the cached user profile. */
export async function refreshCurrentUser() {
  try {
    const data = await apiFetch("/v1/auth/me");
    cacheUser(data.user);
    return data.user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      setSessionToken(null);
      cacheUser(null);
    }
    return null;
  }
}

/** Signs the user out both locally and on the server. */
export async function logout() {
  try {
    await apiFetch("/v1/auth/logout", { method: "POST" });
  } catch {
    // Best-effort: still clear local state even if the network call fails.
  } finally {
    setSessionToken(null);
    cacheUser(null);
  }
}
