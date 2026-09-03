'use client';

import { APP_CONFIG } from './config';

const BACKEND_URL = APP_CONFIG.BACKEND_URL;
const SESSION_STORAGE_KEY = 'agent_session_token';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function getSessionToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(SESSION_STORAGE_KEY);
}

export function setSessionToken(token) {
  if (typeof window === 'undefined') return;
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

export async function apiFetch(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {}

  if (!response.ok) {
    const message = payload?.detail || payload?.error || `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return payload;
}

export async function apiStream(path, body) {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let detail = `backend returned ${response.status}`;
    try {
      const errorBody = await response.json();
      detail = errorBody?.detail || errorBody?.message || detail;
    } catch {}
    throw new ApiError(detail, response.status);
  }

  return response;
}
