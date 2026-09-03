// front-end/local/hooks/useIntegrations.js
//
// React state wrapper around lib/integrations.js. Connection status comes
// from the backend (GET /v1/integrations/status) because neither GitHub nor
// GitLab tokens, OAuth client IDs, or OAuth state live in the browser.

'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  connectGitHub,
  disconnectGitHub,
  connectGitLab,
  disconnectGitLab,
  getIntegrationsStatus,
} from '../lib/integrations';

export function useIntegrations(onMessage) {
  const [githubConnected, setGithubConnected] = useState(false);
  const [githubUsername, setGithubUsername] = useState('');
  const [gitlabConnected, setGitlabConnected] = useState(false);

  const refresh = useCallback(async () => {
    const status = await getIntegrationsStatus();
    setGithubConnected(status.github.connected);
    setGithubUsername(status.github.username);
    setGitlabConnected(status.gitlab.connected);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleGitHub = useCallback(async () => {
    if (githubConnected) {
      const result = await disconnectGitHub();
      if (result?.message) onMessage?.(result.message);
      refresh();
    } else {
      connectGitHub();
    }
  }, [githubConnected, refresh, onMessage]);

  const toggleGitLab = useCallback(async () => {
    if (gitlabConnected) {
      const result = await disconnectGitLab();
      if (result?.message) onMessage?.(result.message);
      refresh();
    } else {
      connectGitLab();
    }
  }, [gitlabConnected, refresh, onMessage]);

  return { githubConnected, githubUsername, gitlabConnected, toggleGitHub, toggleGitLab, refresh };
}
