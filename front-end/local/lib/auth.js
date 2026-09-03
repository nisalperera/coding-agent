'use client';

import { setSessionToken, apiFetch, ApiError } from './api';
import { APP_CONFIG } from './config';

const BACKEND_URL = APP_CONFIG.BACKEND_URL;

export function isSignedIn() {
  if (typeof window === 'undefined') return false;
  return Boolean(localStorage.getItem('agent_session_token') || document.cookie.includes('agent_session='));
}

export function getCachedUser() {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem('agent_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function cacheUser(user) {
  if (user) {
    localStorage.setItem('agent_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('agent_user');
  }
}

export function loginWithGoogle() {
  window.location.href = `${BACKEND_URL}/v1/auth/google/login`;
}

export async function completeLoginFromUrlFragment() {
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const token = fragment.get('token');
  if (!token) return false;

  setSessionToken(token);
  window.history.replaceState({}, '', window.location.pathname);

  await refreshCurrentUser();
  return true;
}

export async function refreshCurrentUser() {
  try {
    const data = await apiFetch('/v1/auth/me');
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

export async function logout() {
  try {
    await apiFetch('/v1/auth/logout', { method: 'POST' });
  } catch {
  } finally {
    setSessionToken(null);
    cacheUser(null);
  }
}
