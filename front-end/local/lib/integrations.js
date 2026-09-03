'use client';

import { apiFetch, ApiError } from './api';
import { generateRandomToken, generateCodeChallenge } from './pkce';
import { APP_CONFIG } from './config';

const GITHUB_CLIENT_ID = APP_CONFIG.GITHUB_OAUTH_CLIENT_ID;
const GITHUB_SCOPES = 'repo read:user';

const GITLAB_CLIENT_ID = APP_CONFIG.GITLAB_OAUTH_CLIENT_ID;
const GITLAB_OAUTH_DOMAIN = 'https://gitlab.com';
const GITLAB_SCOPES = 'api read_repository write_repository';

function githubRedirectUri() {
  return `${window.location.origin}/callback/github`;
}

function gitlabRedirectUri() {
  return `${window.location.origin}/callback/gitlab`;
}

export function isGitHubConnected() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('github_connected') === 'true';
}

export function getGitHubUsername() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem('github_username') || '';
}

export function connectGitHub() {
  const state = generateRandomToken();
  sessionStorage.setItem('github_oauth_state', state);
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: githubRedirectUri(),
    scope: GITHUB_SCOPES,
    state,
    allow_signup: 'false',
  });
  window.location.href = `https://github.com/login/oauth/authorize?${params}`;
}

export async function handleGitHubCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = sessionStorage.getItem('github_oauth_state');
  sessionStorage.removeItem('github_oauth_state');

  if (!code) return null;
  if (!state || state !== expected) {
    return { ok: false, message: 'GitHub connection failed: state mismatch. Please try connecting again.' };
  }

  try {
    const data = await apiFetch('/v1/actions', {
      method: 'POST',
      body: { action: 'github_oauth_callback', code, redirect_uri: githubRedirectUri() },
    });
    localStorage.setItem('github_connected', 'true');
    localStorage.setItem('github_username', data.username || '');
    return { ok: true, message: `GitHub connected${data.username ? ` as **@${data.username}**` : ''}.` };
  } catch (err) {
    const detail = err instanceof ApiError ? err.message : String(err);
    return { ok: false, message: `Could not finish connecting GitHub (${detail}).` };
  }
}

export async function disconnectGitHub() {
  let warning = null;
  try {
    await apiFetch('/v1/actions', {
      method: 'POST',
      body: { action: 'disconnect_integration', provider: 'github' },
    });
  } catch (err) {
    const detail = err instanceof ApiError ? err.message : String(err);
    warning = `Could not confirm GitHub token removal on the server (${detail}). Cleared locally; if this keeps happening, revoke access from GitHub settings directly.`;
  }

  localStorage.removeItem('github_connected');
  localStorage.removeItem('github_username');

  return warning
    ? { ok: false, message: warning }
    : { ok: true, message: 'GitHub disconnected -- the stored server-side token was revoked.' };
}

export function isGitLabConnected() {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('gitlab_connected') === 'true';
}

export function getGitLabAccessToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('gitlab_access_token');
}

export async function connectGitLab() {
  const verifier = generateRandomToken();
  sessionStorage.setItem('gitlab_pkce_verifier', verifier);
  const state = generateRandomToken();
  sessionStorage.setItem('gitlab_oauth_state', state);
  const challenge = await generateCodeChallenge(verifier);

  const params = new URLSearchParams({
    client_id: GITLAB_CLIENT_ID,
    redirect_uri: gitlabRedirectUri(),
    response_type: 'code',
    scope: GITLAB_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  window.location.href = `${GITLAB_OAUTH_DOMAIN}/oauth/authorize?${params}`;
}

export async function handleGitLabCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = sessionStorage.getItem('gitlab_oauth_state');
  const verifier = sessionStorage.getItem('gitlab_pkce_verifier');
  sessionStorage.removeItem('gitlab_oauth_state');
  sessionStorage.removeItem('gitlab_pkce_verifier');

  if (!code) return null;
  if (!state || state !== expected) {
    return { ok: false, message: 'GitLab connection failed: state mismatch. Please try connecting again.' };
  }

  try {
    const resp = await fetch(`${GITLAB_OAUTH_DOMAIN}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GITLAB_CLIENT_ID,
        code,
        grant_type: 'authorization_code',
        redirect_uri: gitlabRedirectUri(),
        code_verifier: verifier,
      }),
    });
    if (!resp.ok) throw new Error(`GitLab returned ${resp.status}`);
    const tokens = await resp.json();
    localStorage.setItem('gitlab_access_token', tokens.access_token);
    localStorage.setItem('gitlab_refresh_token', tokens.refresh_token || '');
    localStorage.setItem('gitlab_connected', 'true');
    return { ok: true, message: 'GitLab connected.' };
  } catch (err) {
    return { ok: false, message: `Could not finish connecting GitLab (${err.message}).` };
  }
}

export function disconnectGitLab() {
  localStorage.removeItem('gitlab_connected');
  localStorage.removeItem('gitlab_access_token');
  localStorage.removeItem('gitlab_refresh_token');
  localStorage.removeItem('gitlab_username');
  return { ok: true, message: 'GitLab disconnected from this browser.' };
}
