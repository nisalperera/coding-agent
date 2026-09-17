"use client";

import { useCallback, useSyncExternalStore } from "react";


export const INTEGRATION_SETTINGS_STORAGE_KEY =
    "coding-agent-integration-settings";

export const INTEGRATION_SETTINGS_CHANGE_EVENT =
    "coding-agent-integration-settings-change";


const SUPPORTED_PROVIDERS = new Set(["github", "gitlab", "llm"]);


const DEFAULT_SNAPSHOT = Object.freeze({
    github: Object.freeze({
        enabled: false,
    }),
    gitlab: Object.freeze({
        enabled: false,
    }),
    llm: Object.freeze({
        enabled: false,
    }),
});


let cachedRawValue;
let cachedSnapshot = DEFAULT_SNAPSHOT;


function normalizeIntegrationSettings(rawValue) {
    if (!rawValue) {
        return DEFAULT_SNAPSHOT;
    }

    try {
        const parsedSettings = JSON.parse(rawValue);

        if (!parsedSettings || typeof parsedSettings !== "object") {
            return DEFAULT_SNAPSHOT;
        }

        return Object.freeze({
            github: Object.freeze({
                enabled: parsedSettings.github?.enabled === true,
            }),
            gitlab: Object.freeze({
                enabled: parsedSettings.gitlab?.enabled === true,
            }),
            llm: Object.freeze({
                enabled: parsedSettings.llm?.enabled === true,
            }),
        });
    } catch {
        return DEFAULT_SNAPSHOT;
    }
}


function getIntegrationSettingsSnapshot() {
    if (typeof window === "undefined") {
        return DEFAULT_SNAPSHOT;
    }

    let rawValue = null;

    try {
        rawValue = window.localStorage.getItem(
            INTEGRATION_SETTINGS_STORAGE_KEY,
        );
    } catch {
        return DEFAULT_SNAPSHOT;
    }

    if (rawValue === cachedRawValue) {
        return cachedSnapshot;
    }

    cachedRawValue = rawValue;
    cachedSnapshot = normalizeIntegrationSettings(rawValue);

    return cachedSnapshot;
}


function subscribeToIntegrationSettings(callback) {
    if (typeof window === "undefined") {
        return () => { };
    }

    function handleStorage(event) {
        if (event.key === INTEGRATION_SETTINGS_STORAGE_KEY) {
            callback();
        }
    }

    function handleIntegrationSettingsChange() {
        callback();
    }

    window.addEventListener("storage", handleStorage);
    window.addEventListener(
        INTEGRATION_SETTINGS_CHANGE_EVENT,
        handleIntegrationSettingsChange,
    );

    return () => {
        window.removeEventListener("storage", handleStorage);
        window.removeEventListener(
            INTEGRATION_SETTINGS_CHANGE_EVENT,
            handleIntegrationSettingsChange,
        );
    };
}


function persistIntegrationSettings(nextSettings) {
    if (typeof window === "undefined") {
        return;
    }

    const safeSettings = {
        github: {
            enabled: nextSettings?.github?.enabled === true,
        },
        gitlab: {
            enabled: nextSettings?.gitlab?.enabled === true,
        },
        llm: {
            enabled: nextSettings?.llm?.enabled === true,
        },
    };

    const nextRawValue = JSON.stringify(safeSettings);

    try {
        window.localStorage.setItem(
            INTEGRATION_SETTINGS_STORAGE_KEY,
            nextRawValue,
        );

        cachedRawValue = nextRawValue;
        cachedSnapshot = Object.freeze({
            github: Object.freeze({
                enabled: safeSettings.github.enabled,
            }),
            gitlab: Object.freeze({
                enabled: safeSettings.gitlab.enabled,
            }),
            llm: Object.freeze({
                enabled: safeSettings.llm.enabled,
            }),
        });

        window.dispatchEvent(
            new CustomEvent(INTEGRATION_SETTINGS_CHANGE_EVENT),
        );
    } catch {
        // Browser storage can be unavailable in private browsing modes,
        // restricted environments, or due to storage quota limits.
    }
}


/**
 * Hydrate only UI-safe integration state received from GET /v1/auth/me.
 *
 * Never persist client credentials, OAuth tokens, refresh tokens, encrypted
 * values, or LLM API keys in localStorage.
 */
export function hydrateIntegrationSettingsFromAuthResponse(settings) {
    persistIntegrationSettings({
        github: {
            enabled: settings?.github?.enabled === true,
        },
        gitlab: {
            enabled: settings?.gitlab?.enabled === true,
        },
        llm: {
            enabled: settings?.llm?.enabled === true,
        }
    });
}


export function clearIntegrationSettings() {
    if (typeof window === "undefined") {
        return;
    }

    try {
        window.localStorage.removeItem(
            INTEGRATION_SETTINGS_STORAGE_KEY,
        );

        cachedRawValue = null;
        cachedSnapshot = DEFAULT_SNAPSHOT;

        window.dispatchEvent(
            new CustomEvent(INTEGRATION_SETTINGS_CHANGE_EVENT),
        );
    } catch {
        // Keep logout resilient even if localStorage is inaccessible.
    }
}


export function useIntegrationSettings() {
    const integrationSettings = useSyncExternalStore(
        subscribeToIntegrationSettings,
        getIntegrationSettingsSnapshot,
        () => DEFAULT_SNAPSHOT,
    );

    const setProviderEnabled = useCallback((provider, enabled) => {
        if (!SUPPORTED_PROVIDERS.has(provider)) {
            throw new Error(
                `Unsupported integration provider: ${String(provider)}`,
            );
        }

        const currentSettings = getIntegrationSettingsSnapshot();
        const normalizedEnabled = Boolean(enabled);

        if (currentSettings[provider].enabled === normalizedEnabled) {
            return;
        }

        persistIntegrationSettings({
            ...currentSettings,
            [provider]: {
                enabled: normalizedEnabled,
            },
        });
    }, []);

    const setGitHubIntegrationEnabled = useCallback(
        (enabled) => {
            setProviderEnabled("github", enabled);
        },
        [setProviderEnabled],
    );

    const setGitLabIntegrationEnabled = useCallback(
        (enabled) => {
            setProviderEnabled("gitlab", enabled);
        },
        [setProviderEnabled],
    );

    const setLlmIntegrationEnabled = useCallback(
        (enabled) => {
            setProviderEnabled("llm", enabled);
        },
        [setProviderEnabled],
    );

    const toggleGitHubIntegration = useCallback(() => {
        setGitHubIntegrationEnabled(!integrationSettings.github.enabled);
    }, [
        integrationSettings.github.enabled,
        setGitHubIntegrationEnabled,
    ]);

    const toggleGitLabIntegration = useCallback(() => {
        setGitLabIntegrationEnabled(!integrationSettings.gitlab.enabled);
    }, [
        integrationSettings.gitlab.enabled,
        setGitLabIntegrationEnabled,
    ]);

    const toggleLlmIntegration = useCallback(() => {
        setLlmIntegrationEnabled(!integrationSettings.llm.enabled);
    }, [
        integrationSettings.llm.enabled,
        setLlmIntegrationEnabled,
    ])

    return {
        integrationSettings,

        githubIntegrationEnabled: integrationSettings.github.enabled,
        gitlabIntegrationEnabled: integrationSettings.gitlab.enabled,
        llmIntegrationEnabled: integrationSettings.llm.enabled,

        setProviderEnabled,
        setGitHubIntegrationEnabled,
        setGitLabIntegrationEnabled,
        setLlmIntegrationEnabled,

        toggleGitHubIntegration,
        toggleGitLabIntegration,
        toggleLlmIntegration,
    };
}