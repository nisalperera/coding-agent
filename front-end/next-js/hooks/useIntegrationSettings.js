"use client";

import { useCallback, useSyncExternalStore } from "react";

export const INTEGRATION_SETTINGS_STORAGE_KEY = "coding-agent-integration-settings";
export const INTEGRATION_SETTINGS_CHANGE_EVENT = "coding-agent-integration-settings-change";
const providers = new Set(["github", "gitlab", "llm"]);
const normalize = (value) => Object.freeze(Object.fromEntries(
  [...providers].map((key) => [key, Object.freeze({ enabled: value?.[key]?.enabled === true })]),
));
const DEFAULT = normalize(null);
let snapshot = DEFAULT;
const listeners = new Set();
function publish(value) {
  snapshot = normalize(value);
  for (const listener of listeners) listener();
  if (typeof window === "undefined") return;
  // Memory is authoritative for UI flags. Never load a previous account's cache.
  try { window.localStorage.setItem(INTEGRATION_SETTINGS_STORAGE_KEY, JSON.stringify(snapshot)); } catch { /* Optional persistence. */ }
  window.dispatchEvent(new CustomEvent(INTEGRATION_SETTINGS_CHANGE_EVENT));
}
export function hydrateIntegrationSettingsFromAuthResponse(settings) { publish(settings); }
export function clearIntegrationSettings() {
  publish(null);
  if (typeof window !== "undefined") {
    try { window.localStorage.removeItem(INTEGRATION_SETTINGS_STORAGE_KEY); } catch { /* Optional persistence. */ }
  }
}
const subscribe = (callback) => { listeners.add(callback); return () => listeners.delete(callback); };
const getSnapshot = () => snapshot;
const getServerSnapshot = () => DEFAULT;
export function useIntegrationSettings() {
  const integrationSettings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setProviderEnabled = useCallback((provider, enabled) => {
    if (!providers.has(provider)) throw new Error(`Unsupported integration provider: ${String(provider)}`);
    if (snapshot[provider].enabled === Boolean(enabled)) return;
    publish({ ...snapshot, [provider]: { enabled: Boolean(enabled) } });
  }, []);
  const setGitHubIntegrationEnabled = useCallback((enabled) => setProviderEnabled("github", enabled), [setProviderEnabled]);
  const setGitLabIntegrationEnabled = useCallback((enabled) => setProviderEnabled("gitlab", enabled), [setProviderEnabled]);
  const setLlmIntegrationEnabled = useCallback((enabled) => setProviderEnabled("llm", enabled), [setProviderEnabled]);
  const toggleGitHubIntegration = useCallback(() => setGitHubIntegrationEnabled(!snapshot.github.enabled), [setGitHubIntegrationEnabled]);
  const toggleGitLabIntegration = useCallback(() => setGitLabIntegrationEnabled(!snapshot.gitlab.enabled), [setGitLabIntegrationEnabled]);
  const toggleLlmIntegration = useCallback(() => setLlmIntegrationEnabled(!snapshot.llm.enabled), [setLlmIntegrationEnabled]);
  return { integrationSettings,
    githubIntegrationEnabled: integrationSettings.github.enabled,
    gitlabIntegrationEnabled: integrationSettings.gitlab.enabled,
    llmIntegrationEnabled: integrationSettings.llm.enabled,
    setProviderEnabled, setGitHubIntegrationEnabled, setGitLabIntegrationEnabled, setLlmIntegrationEnabled,
    toggleGitHubIntegration, toggleGitLabIntegration, toggleLlmIntegration };
}
