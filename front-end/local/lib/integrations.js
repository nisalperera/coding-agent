// front-end/local/lib/integrations.js
//
// GitHub and GitLab repository-access integrations.
//
// Both providers are handled entirely server-side by the FastAPI backend.
// This browser module holds no OAuth client ID, client secret, PKCE
// verifier, authorization state, or provider access token. Its only job is
// to navigate to backend-owned login endpoints and fetch provider status.
//
// Backend contract:
//   GET /v1/auth/github/login
//   GET /v1/auth/gitlab/login
//   GET /v1/integrations/status
//   POST /v1/actions { action: "disconnect_integration", provider }

'use client';

import { apiFetch, ApiError } from './api';
import { APP_CONFIG } from './config';

const BACKEND_URL = APP_CONFIG.BACKEND_URL;

/** Full-page redirect to the backend-owned GitHub OAuth login endpoint. */
export function connectGitHub() {
  window.location.href = `${BACKEND_URL}/v1/auth/github/login`;
}

/** Full-page redirect to the backend-owned GitLab OAuth login endpoint. */
export function connectGitLab() {
  window.location.href = `${BACKEND_URL}/v1/auth/gitlab/login`;
}

/**
 * Reads integration state from the backend, the source of truth now that
 * neither provider token is kept in browser storage. Expected response:
 * {
 *   github: { connected: boolean, username?: string },
 *   gitlab: { connected: boolean }
 * }
 */
export async function getIntegrationsStatus() {
  try {
    const data = await apiFetch('/v1/integrations/status');
    return {
      github: {
        connected: Boolean(data?.github?.connected),
        username: data?.github?.username ?? '',
      },
      gitlab: {
        connected: Boolean(data?.gitlab?.connected),
      },
    };
  } catch {
    return {
      github: { connected: false, username: '' },
      gitlab: { connected: false },
    };
  }
}

/** Revokes GitHub's backend-stored integration token. */
export async function disconnectGitHub() {
  try {
    await apiFetch('/v1/actions', {
      method: 'POST',
      body: { action: 'disconnect_integration', provider: 'github' },
    });
    return { ok: true, message: 'GitHub disconnected.' };
  } catch (err) {
    const detail = err instanceof ApiError ? err.message : String(err);
    return { ok: false, message: `Could not disconnect GitHub (${detail}).` };
  }
}

/** Revokes GitLab's backend-stored integration token. */
export async function disconnectGitLab() {
  try {
    await apiFetch('/v1/actions', {
      method: 'POST',
      body: { action: 'disconnect_integration', provider: 'gitlab' },
    });
    return { ok: true, message: 'GitLab disconnected.' };
  } catch (err) {
    const detail = err instanceof ApiError ? err.message : String(err);
    return { ok: false, message: `Could not disconnect GitLab (${detail}).` };
  }
}
