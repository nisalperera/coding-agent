"use client";

import { useCallback, useEffect, useState } from "react";
import {
  completeLoginFromUrlFragment,
  getCachedUser,
  isSignedIn,
  loginWithGoogle,
  loginWithPassword as loginWithPasswordRequest,
  logout as logoutRequest,
  refreshCurrentUser,
  registerWithPassword as registerWithPasswordRequest,
} from "../lib/auth";

export function useAuth() {
  const [signedIn, setSignedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Render the cached account immediately, then verify it using the
    // HttpOnly-cookie-backed /v1/auth/me endpoint.
    setSignedIn(isSignedIn());
    setUser(getCachedUser());

    const currentUser = await refreshCurrentUser();

    setUser(currentUser);
    setSignedIn(Boolean(currentUser));
    setAuthLoading(false);

    return currentUser;
  }, []);

  useEffect(() => {
    let active = true;

    async function initializeAuth() {
      await completeLoginFromUrlFragment();

      if (!active) {
        return;
      }

      await refresh();
    }

    initializeAuth();

    return () => {
      active = false;
    };
  }, [refresh]);

  const loginWithPassword = useCallback(async ({ email, password }) => {
    const authenticatedUser = await loginWithPasswordRequest({
      email,
      password,
    });

    setUser(authenticatedUser);
    setSignedIn(true);

    return authenticatedUser;
  }, []);

  const registerWithPassword = useCallback(
    async ({ name, email, password }) => {
      const authenticatedUser = await registerWithPasswordRequest({
        name,
        email,
        password,
      });

      setUser(authenticatedUser);
      setSignedIn(true);

      return authenticatedUser;
    },
    [],
  );

  const logout = useCallback(async () => {
    await logoutRequest();

    setUser(null);
    setSignedIn(false);
  }, []);

  return {
    signedIn,
    user,
    authLoading,
    loginWithGoogle,
    loginWithPassword,
    registerWithPassword,
    logout,
    refresh,
  };
}