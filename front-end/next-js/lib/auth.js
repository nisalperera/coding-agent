"use client";

import { apiFetch } from "./api";
import { APP_CONFIG } from "./config";
import { clearIntegrationSettings, hydrateIntegrationSettingsFromAuthResponse } from "../hooks/useIntegrationSettings";
import { createAuthSession, safeUser } from "./auth-session.mjs";

function cacheUser(user) {
  if (typeof window === "undefined") return;
  try {
    if (user) window.localStorage.setItem("agent_user", JSON.stringify(user));
    else window.localStorage.removeItem("agent_user");
  } catch { /* Browser storage is optional, never session authority. */ }
}

export function getCachedUser() {
  if (typeof window === "undefined") return null;
  try {
    const user = safeUser(JSON.parse(window.localStorage.getItem("agent_user") ?? "null"));
    if (!user) cacheUser(null);
    return user;
  } catch { cacheUser(null); return null; }
}

export const authSession = createAuthSession({
  request: apiFetch,
  clearSettings: clearIntegrationSettings,
  hydrateSettings: hydrateIntegrationSettingsFromAuthResponse,
  writeUser: cacheUser,
});

export function isSignedIn() { return authSession.getSnapshot().status === "authenticated"; }
export function loginWithGoogle() {
  if (typeof window !== "undefined") window.location.assign(`${APP_CONFIG.BACKEND_URL}/v1/auth/google/login`);
}
export async function completeLoginFromUrlFragment() { return Boolean(await authSession.initialize()); }
export const refreshCurrentUser = authSession.refresh;
export const loginWithPassword = authSession.login;
export const registerWithPassword = authSession.register;
export const logout = authSession.logout;
