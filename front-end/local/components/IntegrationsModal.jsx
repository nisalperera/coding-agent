'use client';

export default function IntegrationsModal({ open, onClose, integrations }) {
  const { githubConnected, githubUsername, gitlabConnected, toggleGitHub, toggleGitLab } = integrations;

  if (!open) return null;

  return (
    <div id="integrations-modal" className="fixed inset-0 z-40 bg-slate-900/40 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-base font-semibold">Repository access</h2>
          <button
            id="integrations-close-btn"
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="h-7 w-7 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-500"
          >
            &times;
          </button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          Connect GitHub and/or GitLab so the agent can read and push changes to your own repositories, in addition to
          any shared service-level access already configured.
        </p>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-9 w-9 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                  <path d="M12 .5C5.73.5.98 5.24.98 11.5c0 4.86 3.15 8.98 7.52 10.43.55.1.75-.24.75-.53v-2.06c-3.06.66-3.7-1.3-3.7-1.3-.5-1.27-1.22-1.6-1.22-1.6-1-.68.08-.67.08-.67 1.1.08 1.68 1.13 1.68 1.13.98 1.68 2.57 1.2 3.2.91.1-.71.39-1.2.71-1.47-2.44-.28-5-1.22-5-5.42 0-1.2.43-2.18 1.13-2.95-.11-.28-.49-1.4.11-2.92 0 0 .93-.3 3.04 1.13a10.5 10.5 0 0 1 5.54 0c2.11-1.43 3.04-1.13 3.04-1.13.6 1.52.22 2.64.11 2.92.7.77 1.13 1.75 1.13 2.95 0 4.21-2.57 5.14-5.02 5.41.4.35.75 1.03.75 2.08v3.08c0 .29.2.64.76.53 4.36-1.46 7.51-5.58 7.51-10.43C23.02 5.24 18.27.5 12 .5Z" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">GitHub</p>
                <p id="github-status-text" className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {githubConnected ? `Connected${githubUsername ? ' as @' + githubUsername : ''}` : 'Not connected'}
                </p>
              </div>
            </div>
            <button
              id="github-connect-btn"
              type="button"
              onClick={toggleGitHub}
              className="text-xs px-3 py-1.5 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 hover:opacity-90 transition shrink-0"
            >
              {githubConnected ? 'Disconnect' : 'Connect'}
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-9 w-9 rounded-lg bg-orange-600 text-white flex items-center justify-center shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
                  <path d="M12 21.42 15.6 10.2H8.4L12 21.42Z" />
                  <path d="M4.2 10.2 2.4 15.6 12 21.42 4.2 10.2Z" opacity=".7" />
                  <path d="M4.2 10.2h4.2L6.6 4.02a.42.42 0 0 0-.8 0L4.2 10.2Z" />
                  <path d="M19.8 10.2l1.8 5.4L12 21.42 19.8 10.2Z" opacity=".7" />
                  <path d="M19.8 10.2h-4.2l1.8-6.18a.42.42 0 0 1 .8 0l1.6 6.18Z" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">GitLab</p>
                <p id="gitlab-status-text" className="text-xs text-slate-500 dark:text-slate-400 truncate">
                  {gitlabConnected ? 'Connected' : 'Not connected'}
                </p>
              </div>
            </div>
            <button
              id="gitlab-connect-btn"
              type="button"
              onClick={toggleGitLab}
              className="text-xs px-3 py-1.5 rounded-full bg-orange-600 text-white hover:bg-orange-700 transition shrink-0"
            >
              {gitlabConnected ? 'Disconnect' : 'Connect'}
            </button>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 mt-4">
          Disconnecting GitHub revokes the token stored on the server as well as clearing this browser. Disconnecting
          GitLab only clears the token stored in this browser (GitLab tokens are never sent to or stored on the
          server) &mdash; to fully revoke it, or to revoke either provider from the other side, visit your{' '}
          <a className="underline" href="https://github.com/settings/applications" target="_blank" rel="noopener">
            GitHub
          </a>{' '}
          or{' '}
          <a className="underline" href="https://gitlab.com/-/profile/applications" target="_blank" rel="noopener">
            GitLab
          </a>{' '}
          application settings.
        </p>
      </div>
    </div>
  );
}
