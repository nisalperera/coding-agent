"use client";

import { useEffect, useSyncExternalStore } from "react";
import { authSession, loginWithGoogle } from "../lib/auth";
import { INITIAL_AUTH } from "../lib/auth-session.mjs";

export function useAuth() {
  const state = useSyncExternalStore(authSession.subscribe, authSession.getSnapshot, () => INITIAL_AUTH);
  useEffect(() => { void authSession.initialize(); }, []);
  return {
    ...state,
    signedIn: state.status === "authenticated",
    authLoading: state.status === "loading",
    authError: state.error,
    loginWithGoogle,
    loginWithPassword: authSession.login,
    registerWithPassword: authSession.register,
    logout: authSession.logout,
    refresh: authSession.refresh,
  };
}
