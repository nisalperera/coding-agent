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
const PROVIDERS = new Set(['github', 'gitlab']);

function emptyProviderStatus() {
  return {
    connected: false,
    username: null,
    connectedAt: null,
  };
}

function normalizeProviderStatus(provider) {
  return {
    connected: Boolean(provider?.connected),
    username: typeof provider?.username === 'string' && provider.username.trim()
      ? provider.username.trim()
      : null,
    connectedAt: Number.isFinite(provider?.connected_at)
      ? provider.connected_at
      : null,
  };
}

function normalizeStatusPayload(payload) {
  const integrations = payload?.integrations ?? payload ?? {};

  return {
    github: normalizeProviderStatus(integrations.github),
    gitlab: normalizeProviderStatus(integrations.gitlab),
  };
}

function assertProvider(provider) {
  if (!PROVIDERS.has(provider)) {
    throw new Error('Unsupported integration provider.');
  }
}

export function connectGitHub() {
  window.location.assign(`${BACKEND_URL}/v1/auth/github/login`);
}

export function connectGitLab() {
  window.location.assign(`${BACKEND_URL}/v1/auth/gitlab/login`);
}

export async function getIntegrationsStatus() {
  const payload = await apiFetch('/v1/integrations/status');
  return normalizeStatusPayload(payload);
}

export async function disconnectIntegration(provider) {
  assertProvider(provider);

  try {
    await apiFetch('/v1/actions', {
      method: 'POST',
      body: {
        action: 'disconnect_integration',
        provider,
      },
    });

    return {
      ok: true,
      status: emptyProviderStatus(),
    };
  } catch (error) {
    if (error instanceof ApiError && [401, 403].includes(error.status)) {
      return {
        ok: false,
        reason: 'unauthenticated',
      };
    }

    return {
      ok: false,
      reason: 'request_failed',
    };
  }
}

export function formatConnectedAt(epochSeconds) {
  if (!Number.isFinite(epochSeconds)) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(epochSeconds * 1000));
}
