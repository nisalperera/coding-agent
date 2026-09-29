"use client";

import { apiFetch, ApiError } from "./api";
import { APP_CONFIG } from "./config";
import {
    clearIntegrationSettings,
    hydrateIntegrationSettingsFromAuthResponse,
} from "../hooks/useIntegrationSettings";


const BACKEND_URL = APP_CONFIG.BACKEND_URL;


/**
 * Returns whether a cached user exists for immediate UI rendering.
 *
 * The HttpOnly backend session cookie remains the real authentication source
 * of truth. Call refreshCurrentUser() to validate the active session.
 */
export function isSignedIn() {
    if (typeof window === "undefined") {
        return false;
    }

    return Boolean(getCachedUser());
}


/**
 * Read the non-sensitive cached user object.
 *
 * The cache is used only to avoid an unauthenticated UI flash while the app
 * calls GET /v1/auth/me. It must never be treated as session validation.
 */
export function getCachedUser() {
    if (typeof window === "undefined") {
        return null;
    }

    const raw = window.localStorage.getItem("agent_user");

    if (!raw) {
        return null;
    }

    try {
        const user = JSON.parse(raw);

        if (!user || typeof user !== "object") {
            window.localStorage.removeItem("agent_user");
            return null;
        }

        return user;
    } catch {
        window.localStorage.removeItem("agent_user");
        return null;
    }
}


/**
 * Write or remove the local UI user cache.
 *
 * Do not store session tokens, OAuth credentials, refresh tokens, or API keys
 * in localStorage. The authenticated session is held by an HttpOnly cookie.
 */
function cacheUser(user) {
    if (typeof window === "undefined") {
        return;
    }

    if (user && typeof user === "object") {
        window.localStorage.setItem("agent_user", JSON.stringify(user));
        return;
    }

    window.localStorage.removeItem("agent_user");
}


/**
 * Clear all browser-side state that belongs to an authenticated user.
 *
 * This must run after logout and after a confirmed 401 response so settings
 * from one signed-in account cannot remain visible for another account.
 */
function clearAuthenticatedUiCache() {
    cacheUser(null);
    clearIntegrationSettings();
}


/**
 * Normalize a backend auth response.
 *
 * Supported response shapes:
 *
 * Preferred:
 * {
 *   user: { ... },
 *   settings: {
 *     github: { enabled: false },
 *     gitlab: { enabled: false },
 *     llm: { enabled: false }
 *   }
 * }
 *
 * Legacy:
 * {
 *   user_id: "...",
 *   email: "..."
 * }
 */
function extractAuthResponse(data) {
    if (!data || typeof data !== "object") {
        return {
            user: null,
            settings: null,
        };
    }

    const user = data.user ?? data;
    const settings = data.settings ?? null;

    if (!user || typeof user !== "object") {
        return {
            user: null,
            settings: null,
        };
    }

    return {
        user,
        settings,
    };
}


/**
 * Persist the safe browser cache for an authenticated user.
 *
 * `settings` is passed to the integration settings hydrator, which must retain
 * only UI-safe fields such as GitHub and GitLab `enabled` flags.
 */
function cacheAuthenticatedResponse(data) {
    const { user, settings } = extractAuthResponse(data);

    if (!user) {
        return null;
    }

    cacheUser(user);

    if (settings) {
        hydrateIntegrationSettingsFromAuthResponse(settings);
    }

    return user;
}


/**
 * Begin Google OAuth using top-level browser navigation.
 *
 * OAuth redirects require top-level navigation so browser-managed redirects,
 * SameSite rules, and HttpOnly session cookies work correctly.
 */
export function loginWithGoogle() {
    if (typeof window === "undefined") {
        return;
    }

    window.location.assign(`${BACKEND_URL}/v1/auth/google/login`);
}


/**
 * Retained for compatibility with the existing OAuth callback flow.
 *
 * Google login now creates a server-side HttpOnly session cookie instead of
 * putting a token in `window.location.hash`.
 */
export async function completeLoginFromUrlFragment() {
    if (typeof window === "undefined") {
        return false;
    }

    return Boolean(await refreshCurrentUser());
}


/**
 * Validate the HttpOnly session cookie and hydrate local UI caches.
 *
 * GET /v1/auth/me is the canonical source for:
 * - the current authenticated user
 * - GitHub integration enabled state
 * - GitLab integration enabled state
 * - any future safe settings metadata
 */
export async function refreshCurrentUser() {
    try {
        const data = await apiFetch("/v1/auth/me", {
            method: "GET",
            credentials: "include",
        });

        const user = cacheAuthenticatedResponse(data);

        if (!user) {
            clearAuthenticatedUiCache();
            return null;
        }

        return user;
    } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
            clearAuthenticatedUiCache();
        }

        return null;
    }
}


/**
 * Sign in using email and password.
 *
 * The backend is expected to set an HttpOnly session cookie. The follow-up
 * GET /v1/auth/me request ensures the browser cache uses the canonical user
 * and integration settings response shape.
 */
export async function loginWithPassword({ email, password }) {
    const data = await apiFetch("/v1/auth/login", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        credentials: "include",
        body: {
            email: email.trim().toLowerCase(),
            password,
        },
    });

    const { user, settings } = extractAuthResponse(data);

    if (!user) {
        throw new Error("Login succeeded but no user was returned.");
    }

    cacheUser(user);

    if (settings) {
        hydrateIntegrationSettingsFromAuthResponse(settings);
        return user;
    }

    const refreshedUser = await refreshCurrentUser();

    if (!refreshedUser) {
        clearAuthenticatedUiCache();

        throw new Error(
            "Login succeeded but the authenticated session could not be verified.",
        );
    }

    return refreshedUser;
}


/**
 * Register an account using email and password.
 *
 * The backend is expected to create:
 * - a User row
 * - a UserSettings row using safe defaults
 * - an HttpOnly authenticated session cookie
 *
 * If the registration response does not include settings, the authenticated
 * session is refreshed from GET /v1/auth/me.
 */
export async function registerWithPassword({ name, email, password }) {
    const data = await apiFetch("/v1/auth/register", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        credentials: "include",
        body: {
            name: name.trim(),
            email: email.trim().toLowerCase(),
            password,
        },
    });

    const { user, settings } = extractAuthResponse(data);

    if (!user) {
        throw new Error("Registration succeeded but no user was returned.");
    }

    cacheUser(user);

    if (settings) {
        hydrateIntegrationSettingsFromAuthResponse(settings);
        return user;
    }

    const refreshedUser = await refreshCurrentUser();

    if (!refreshedUser) {
        clearAuthenticatedUiCache();

        throw new Error(
            "Registration succeeded but the authenticated session could not be verified.",
        );
    }

    return refreshedUser;
}


/**
 * Sign out from the current browser session.
 *
 * Local state is always cleared, even when the backend is unavailable or the
 * session already expired. This prevents stale user and provider UI state from
 * surviving logout.
 */
export async function logout() {
    try {
        await apiFetch("/v1/auth/logout", {
            method: "POST",
            credentials: "include",
        });
    } catch {
        // The backend cookie may already be expired, removed, or unreachable.
        // Browser-side cleanup still needs to happen in finally.
    } finally {
        clearAuthenticatedUiCache();
    }
}