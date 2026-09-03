// front-end/js/api.js
//
// Thin fetch wrapper for the FastAPI back-end (see back-end/main.py).
// Centralizes the base URL, session-token header injection, and error
// normalization so every other module calls one consistent function
// instead of hand-rolling fetch() + header objects everywhere.
//
// Session model: the back-end issues an opaque session token from
// GET /v1/auth/google/callback (see auth.js) and also sets it as an
// HttpOnly `agent_session` cookie. We store a copy in localStorage so we
// can send it as `Authorization: Bearer <token>` explicitly — this keeps
// the app working even when the API and front-end are served from
// different origins/ports, where a cross-site cookie could be blocked or
// stripped by the browser depending on SameSite/Secure configuration.

const BACKEND_URL = window.APP_CONFIG.BACKEND_URL;
const SESSION_STORAGE_KEY = "agent_session_token";

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getSessionToken() {
  return localStorage.getItem(SESSION_STORAGE_KEY);
}

export function setSessionToken(token) {
  if (token) {
    localStorage.setItem(SESSION_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

function authHeaders() {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Performs a JSON request against the backend and returns the parsed body.
 * Throws ApiError on non-2xx responses.
 */
export async function apiFetch(path, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method,
    credentials: "include",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...authHeaders(),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Some endpoints (e.g. streaming) never reach here; non-JSON bodies
    // on error responses are treated as an empty payload.
  }

  if (!response.ok) {
    const message = payload?.detail || payload?.error || `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return payload;
}

/**
 * Opens a raw streaming POST request (used for /v1/chat/completions) and
 * returns the fetch Response so the caller can read response.body directly.
 * Not routed through apiFetch() because the response body is a stream of
 * NDJSON + SSE frames, not a single JSON document — see stream.js.
 */
export async function apiStream(path, body) {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let detail = `backend returned ${response.status}`;
    try {
      const errorBody = await response.json();
      detail = errorBody?.detail || errorBody?.message || detail;
    } catch {
      // Ignore unparsable error bodies; fall back to the generic message.
    }
    throw new ApiError(detail, response.status);
  }

  return response;
}
