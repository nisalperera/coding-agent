'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  isGitHubConnected,
  getGitHubUsername,
  connectGitHub,
  disconnectGitHub,
  isGitLabConnected,
  connectGitLab,
  disconnectGitLab,
} from '../lib/integrations';

export function useIntegrations(onMessage) {
  const [githubConnected, setGithubConnected] = useState(false);
  const [githubUsername, setGithubUsername] = useState('');
  const [gitlabConnected, setGitlabConnected] = useState(false);

  const refresh = useCallback(() => {
    setGithubConnected(isGitHubConnected());
    setGithubUsername(getGitHubUsername());
    setGitlabConnected(isGitLabConnected());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleGitHub = useCallback(async () => {
    const result = isGitHubConnected() ? await disconnectGitHub() : connectGitHub();
    if (result?.message) onMessage?.(result.message);
    refresh();
  }, [refresh, onMessage]);

  const toggleGitLab = useCallback(async () => {
    const result = isGitLabConnected() ? disconnectGitLab() : await connectGitLab();
    if (result?.message) onMessage?.(result.message);
    refresh();
  }, [refresh, onMessage]);

  return { githubConnected, githubUsername, gitlabConnected, toggleGitHub, toggleGitLab, refresh };
}
