'use client';

import { APP_CONFIG } from './config';

const BACKEND_URL = APP_CONFIG.BACKEND_URL;

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function apiFetch(
  path,
  { method = 'GET', body, headers = {} } = {},
) {
  const response = await fetch(`${BACKEND_URL}${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let payload = null;

  try {
    payload = await response.json();
  } catch {
    // Some successful backend responses may intentionally have no JSON body.
  }

  if (!response.ok) {
    const message =
      payload?.detail ??
      payload?.error ??
      `Request failed (${response.status})`;

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
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let detail = `Request failed (${response.status})`;

    try {
      const errorBody = await response.json();
      detail = errorBody?.detail ?? errorBody?.message ?? detail;
    } catch {
      // Preserve a generic status-only error when the response is not JSON.
    }

    throw new ApiError(detail, response.status);
  }

  return response;
}