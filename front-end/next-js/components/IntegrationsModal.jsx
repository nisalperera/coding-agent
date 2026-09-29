'use client';

import { useEffect, useState } from 'react';
import {
  connectGitHub,
  connectGitLab,
  disconnectIntegration,
  formatConnectedAt,
} from '../lib/integrations';

function ProviderCard({
  provider,
  status,
  onConnect,
  onDisconnect,
  busyProvider,
}) {
  const isBusy = busyProvider === provider;
  const connected = Boolean(status?.connected);
  const username = status?.username ?? null;
  const connectedAt = formatConnectedAt(status?.connectedAt);

  return (
    <section className="rounded-lg border border-zinc-700 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold capitalize">{provider}</h3>
          <p className="mt-1 text-sm text-zinc-400">
            {connected
              ? username
                ? `Connected as @${username}`
                : 'Connected'
              : 'Not connected'}
          </p>
          {connectedAt ? (
            <p className="mt-1 text-xs text-zinc-500">
              Connected {connectedAt}
            </p>
          ) : null}
        </div>

        {connected ? (
          <button
            type="button"
            onClick={() => onDisconnect(provider)}
            disabled={isBusy}
            className="rounded-md border border-red-500 px-3 py-2 text-sm text-red-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? 'Disconnecting…' : 'Disconnect'}
          </button>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            disabled={isBusy}
            className="rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Connect
          </button>
        )}
      </div>
    </section>
  );
}

export default function IntegrationsModal({
  open,
  onClose,
  integrations,
  loading,
  error,
  onRefresh,
  onUnauthenticated,
}) {
  const [busyProvider, setBusyProvider] = useState(null);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    if (open) {
      onRefresh?.();
    }
  }, [open, onRefresh]);

  if (!open) {
    return null;
  }

  async function handleDisconnect(provider) {
    setActionError(null);
    setBusyProvider(provider);

    try {
      const result = await disconnectIntegration(provider);

      if (!result.ok) {
        if (result.reason === 'unauthenticated') {
          onUnauthenticated?.();
          return;
        }

        setActionError(`Could not disconnect ${provider}. Please try again.`);
        return;
      }

      await onRefresh?.();
    } finally {
      setBusyProvider(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="integrations-title"
    >
      <div className="w-full max-w-lg rounded-xl bg-zinc-900 p-6 text-zinc-100 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="integrations-title" className="text-xl font-semibold">
              Integrations
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              Connect GitHub or GitLab to authorize repository actions for your
              account. Provider authorization is handled securely by the backend.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Close integrations"
          >
            ×
          </button>
        </div>

        <div className="mt-6 space-y-3">
          {loading ? (
            <p className="text-sm text-zinc-400">
              Checking connection status…
            </p>
          ) : null}

          {!loading && error ? (
            <div className="rounded-md border border-amber-600 bg-amber-950/40 p-3">
              <p className="text-sm text-amber-200">
                Unable to load integration status.
              </p>
              <button
                type="button"
                onClick={onRefresh}
                className="mt-2 text-sm text-amber-100 underline"
              >
                Try again
              </button>
            </div>
          ) : null}

          {!loading && !error ? (
            <>
              <ProviderCard
                provider="github"
                status={integrations?.github}
                onConnect={connectGitHub}
                onDisconnect={handleDisconnect}
                busyProvider={busyProvider}
              />

              <ProviderCard
                provider="gitlab"
                status={integrations?.gitlab}
                onConnect={connectGitLab}
                onDisconnect={handleDisconnect}
                busyProvider={busyProvider}
              />
            </>
          ) : null}
        </div>

        {actionError ? (
          <p className="mt-4 text-sm text-red-300" role="alert">
            {actionError}
          </p>
        ) : null}

        <p className="mt-6 text-xs text-zinc-500">
          Disconnecting removes this local application connection. It does not
          claim to revoke access at GitHub or GitLab.
        </p>
      </div>
    </div>
  );
}
