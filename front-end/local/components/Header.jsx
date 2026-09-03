'use client';

export default function Header({ auth, integrations, onOpenIntegrations, theme }) {
  const { signedIn, user, loginWithGoogle, logout } = auth;
  const { githubConnected, githubUsername, gitlabConnected, toggleGitHub, toggleGitLab } = integrations;
  const { dark, toggleTheme } = theme;

  return (
    <header className="shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur sticky top-0 z-20">
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <img src="/assets/logo.jpeg" alt="Nisal's Coding Agent logo" className="h-8 w-8 rounded-lg object-cover shrink-0" />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold leading-tight truncate">Nisal's Coding Agent</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 truncate">Agentic AI &amp; RAG assistant</p>
          </div>
        </div>

        <div id="auth-bar" className="flex items-center gap-2">
          {!signedIn && (
            <div id="auth-signed-out" className="flex items-center gap-2">
              <button
                id="google-login-btn"
                type="button"
                onClick={loginWithGoogle}
                className="text-xs sm:text-sm px-3 py-1.5 rounded-full border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                Sign in with Google
              </button>
            </div>
          )}

          {signedIn && (
            <div id="auth-signed-in" className="flex items-center gap-2 flex-wrap justify-end">
              <span id="user-email" className="hidden sm:inline text-xs text-slate-500 dark:text-slate-400 truncate max-w-[8rem]">
                {user?.email ?? ''}
              </span>
              <button
                id="github-auth-btn"
                type="button"
                onClick={toggleGitHub}
                className={`flex items-center gap-1.5 text-xs sm:text-sm px-3 py-1.5 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 hover:opacity-90 transition ${
                  githubConnected ? 'opacity-70' : ''
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 shrink-0">
                  <path d="M12 .5C5.73.5.98 5.24.98 11.5c0 4.86 3.15 8.98 7.52 10.43.55.1.75-.24.75-.53v-2.06c-3.06.66-3.7-1.3-3.7-1.3-.5-1.27-1.22-1.6-1.22-1.6-1-.68.08-.67.08-.67 1.1.08 1.68 1.13 1.68 1.13.98 1.68 2.57 1.2 3.2.91.1-.71.39-1.2.71-1.47-2.44-.28-5-1.22-5-5.42 0-1.2.43-2.18 1.13-2.95-.11-.28-.49-1.4.11-2.92 0 0 .93-.3 3.04 1.13a10.5 10.5 0 0 1 5.54 0c2.11-1.43 3.04-1.13 3.04-1.13.6 1.52.22 2.64.11 2.92.7.77 1.13 1.75 1.13 2.95 0 4.21-2.57 5.14-5.02 5.41.4.35.75 1.03.75 2.08v3.08c0 .29.2.64.76.53 4.36-1.46 7.51-5.58 7.51-10.43C23.02 5.24 18.27.5 12 .5Z" />
                </svg>
                <span id="github-auth-btn-label">
                  {githubConnected ? `GitHub \u2713${githubUsername ? ' @' + githubUsername : ''}` : 'Connect GitHub'}
                </span>
              </button>
              <button
                id="gitlab-auth-btn"
                type="button"
                onClick={toggleGitLab}
                className={`flex items-center gap-1.5 text-xs sm:text-sm px-3 py-1.5 rounded-full bg-orange-600 text-white hover:bg-orange-700 transition ${
                  gitlabConnected ? 'opacity-70' : ''
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5 shrink-0">
                  <path d="M12 21.42 15.6 10.2H8.4L12 21.42Z" />
                  <path d="M4.2 10.2 2.4 15.6 12 21.42 4.2 10.2Z" opacity=".7" />
                  <path d="M4.2 10.2h4.2L6.6 4.02a.42.42 0 0 0-.8 0L4.2 10.2Z" />
                  <path d="M19.8 10.2l1.8 5.4L12 21.42 19.8 10.2Z" opacity=".7" />
                  <path d="M19.8 10.2h-4.2l1.8-6.18a.42.42 0 0 1 .8 0l1.6 6.18Z" />
                </svg>
                <span id="gitlab-auth-btn-label">{gitlabConnected ? "GitLab \u2713" : 'Connect GitLab'}</span>
              </button>
              <button
                id="integrations-open-btn"
                type="button"
                aria-label="Repository integrations"
                onClick={onOpenIntegrations}
                className="h-8 w-8 shrink-0 rounded-full border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition flex items-center justify-center text-sm relative"
              >
                <span>{'\u{1F517}'}</span>
                {(githubConnected || gitlabConnected) && (
                  <span id="integrations-dot" className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500" />
                )}
              </button>
              <button
                id="logout-btn"
                type="button"
                onClick={logout}
                className="text-xs sm:text-sm px-3 py-1.5 rounded-full border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                Log out
              </button>
            </div>
          )}

          <button
            id="theme-toggle-btn"
            type="button"
            aria-label="Toggle theme"
            onClick={toggleTheme}
            className="h-8 w-8 shrink-0 rounded-full border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition flex items-center justify-center text-sm"
          >
            <span id="theme-icon">{dark ? '\u2600\uFE0F' : '\u{1F319}'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
