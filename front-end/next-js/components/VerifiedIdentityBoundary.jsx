"use client";
import { createContext, Fragment, useContext, useLayoutEffect, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "../hooks/useAuth";
import { authSession } from "../lib/auth";
import { createIdentityLease } from "../lib/identity-lease.mjs";

const IdentityContext = createContext(null);
const keys = new WeakMap();
let nextKey = 0;
function userKey(user) {
  if (!keys.has(user)) keys.set(user, ++nextKey);
  return keys.get(user);
}
function IdentityMount({ status, identityKey, user, children }) {
  const scope = useMemo(() => createIdentityLease(authSession.getSnapshot,
    { status, identityKey, user }), [status, identityKey, user]);
  useLayoutEffect(() => {
    scope.activate();
    const unsubscribe = authSession.subscribe(scope.observe);
    scope.observe();
    return () => { unsubscribe(); scope.deactivate(); };
  }, [scope]);
  return <IdentityContext.Provider value={scope}>{children}</IdentityContext.Provider>;
}
export function useIdentityLease() {
  const scope = useContext(IdentityContext);
  if (!scope) throw new Error("Account state must be inside VerifiedIdentityBoundary.");
  return scope;
}
export default function VerifiedIdentityBoundary({ children, allowGuest = false }) {
  const auth = useAuth();
  if (auth.status === "loading") return <p role="status">Checking your session...</p>;
  if (auth.status === "error") return <section role="alert">
    <p>Verify your session before using account settings or projects.</p>
    <button type="button" disabled={auth.operationBusy} onClick={() => { void auth.refresh(); }}>Retry session verification</button>
  </section>;
  if (!auth.signedIn && !allowGuest) return <section>
    <h1>Sign in to manage projects</h1><p>Projects are private to your account.</p><Link href="/login">Sign in</Link>
  </section>;
  const key = auth.signedIn ? `account:${userKey(auth.user)}` : "guest";
  return <Fragment key={key}><IdentityMount status={auth.status} identityKey={auth.identityKey} user={auth.user}>
    {children}
  </IdentityMount></Fragment>;
}
