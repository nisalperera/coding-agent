"use client";

import { useState } from "react";
import { useAuth } from "../hooks/useAuth";

export default function AuthSessionNotice() {
  const auth = useAuth();
  const [retrying, setRetrying] = useState(false);
  const logoutUnconfirmed = auth.logoutStatus === "unconfirmed";
  const logoutPending = auth.logoutStatus === "pending";
  if (!auth.authError && !logoutUnconfirmed && !logoutPending) return null;
  const message = logoutPending
    ? "Local account data was cleared. Waiting for server logout confirmation."
    : logoutUnconfirmed
      ? "Local account data was cleared, but server logout could not be confirmed. The server session may still be active. Retry logout."
      : auth.authError;
  async function retry() {
    if (retrying || auth.operationBusy) return;
    setRetrying(true);
    try {
      if (logoutUnconfirmed) await auth.logout();
      else await auth.refresh();
    } finally { setRetrying(false); }
  }
  return (
    <section aria-label="Session status" role={logoutPending ? "status" : "alert"}
      className="shrink-0 border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <p>{message}</p>
      {!logoutPending && <button type="button" onClick={retry}
        disabled={retrying || auth.operationBusy}
        className="mt-2 rounded border border-current px-3 py-1 disabled:opacity-50">
        {retrying ? "Retrying..." : logoutUnconfirmed ? "Retry logout" : "Retry session verification"}
      </button>}
    </section>
  );
}
