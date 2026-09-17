"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../../hooks/useAuth";
import { useTheme } from "../../components/ThemeProvider";
import { useIntegrationSettings } from "../../hooks/useIntegrationSettings";

const SETTINGS_STORAGE_KEY = "coding-agent-settings";

const DEFAULT_SETTINGS = Object.freeze({
    sendWithEnter: true,
    streamResponses: true,
    showSources: true,
    confirmRiskyActions: true,
    compactMode: false,
});

const DEFAULT_INTEGRATION_SETTINGS = Object.freeze({
    github: Object.freeze({
        clientId: "",
        clientSecret: "",
        clientIdConfigured: false,
        clientSecretConfigured: false,
        baseUrl: "https://github.com",
        scopes: ["read:user", "repo"],
    }),
    gitlab: Object.freeze({
        clientId: "",
        clientSecret: "",
        clientIdConfigured: false,
        clientSecretConfigured: false,
        baseUrl: "https://gitlab.com",
        scopes: ["read_user", "api"],
    }),
    llm: Object.freeze({
        enabled: false,
        providerName: "Custom",
        endpointUrl: "",
        model: "",
        apiKey: "",
        apiKeyConfigured: false,
        temperature: 0.2,
        maxTokens: 4096,
        streamResponses: true,
    }),
});

const GITHUB_SCOPE_OPTIONS = [
    { value: "read:user", label: "Read user profile" },
    { value: "user:email", label: "Read user email addresses" },
    { value: "repo", label: "Full repository access" },
    { value: "public_repo", label: "Public repository access" },
    { value: "workflow", label: "Manage GitHub Actions workflows" },
    { value: "read:org", label: "Read organization membership" },
];

const GITLAB_SCOPE_OPTIONS = [
    { value: "read_user", label: "Read user profile" },
    { value: "read_api", label: "Read API resources" },
    { value: "api", label: "Full API access" },
    { value: "read_repository", label: "Read repositories" },
    { value: "write_repository", label: "Write repositories" },
];

function createDefaultIntegrationSettings() {
    return {
        github: {
            ...DEFAULT_INTEGRATION_SETTINGS.github,
            scopes: [...DEFAULT_INTEGRATION_SETTINGS.github.scopes],
        },
        gitlab: {
            ...DEFAULT_INTEGRATION_SETTINGS.gitlab,
            scopes: [...DEFAULT_INTEGRATION_SETTINGS.gitlab.scopes],
        },
        llm: {
            ...DEFAULT_INTEGRATION_SETTINGS.llm,
        },
    };
}

function normalizeStringArray(value, fallback) {
    if (!Array.isArray(value)) {
        return [...fallback];
    }

    return value.filter((item) => typeof item === "string");
}

function normalizeFiniteNumber(value, fallback) {
    const numericValue = Number(value);

    return Number.isFinite(numericValue) ? numericValue : fallback;
}

function mapBackendSettingsToFormState(serverSettings) {
    const github = serverSettings?.github ?? {};
    const gitlab = serverSettings?.gitlab ?? {};
    const llm = serverSettings?.llm ?? {};

    return {
        github: {
            ...DEFAULT_INTEGRATION_SETTINGS.github,
            clientId: "",
            clientSecret: "",
            clientIdConfigured: github.clientIdConfigured === true,
            clientSecretConfigured: github.clientSecretConfigured === true,
            baseUrl:
                typeof github.baseUrl === "string" && github.baseUrl.trim()
                    ? github.baseUrl
                    : DEFAULT_INTEGRATION_SETTINGS.github.baseUrl,
            scopes: normalizeStringArray(
                github.scopes,
                DEFAULT_INTEGRATION_SETTINGS.github.scopes,
            ),
        },
        gitlab: {
            ...DEFAULT_INTEGRATION_SETTINGS.gitlab,
            clientId: "",
            clientSecret: "",
            clientIdConfigured: gitlab.clientIdConfigured === true,
            clientSecretConfigured: gitlab.clientSecretConfigured === true,
            baseUrl:
                typeof gitlab.baseUrl === "string" && gitlab.baseUrl.trim()
                    ? gitlab.baseUrl
                    : DEFAULT_INTEGRATION_SETTINGS.gitlab.baseUrl,
            scopes: normalizeStringArray(
                gitlab.scopes,
                DEFAULT_INTEGRATION_SETTINGS.gitlab.scopes,
            ),
        },
        llm: {
            ...DEFAULT_INTEGRATION_SETTINGS.llm,
            enabled: llm.enabled === true,
            providerName:
                typeof llm.providerName === "string"
                    ? llm.providerName
                    : DEFAULT_INTEGRATION_SETTINGS.llm.providerName,
            endpointUrl:
                typeof llm.endpointUrl === "string"
                    ? llm.endpointUrl
                    : DEFAULT_INTEGRATION_SETTINGS.llm.endpointUrl,
            model:
                typeof llm.model === "string"
                    ? llm.model
                    : DEFAULT_INTEGRATION_SETTINGS.llm.model,
            apiKey: "",
            apiKeyConfigured: llm.apiKeyConfigured === true,
            temperature: normalizeFiniteNumber(
                llm.temperature,
                DEFAULT_INTEGRATION_SETTINGS.llm.temperature,
            ),
            maxTokens: normalizeFiniteNumber(
                llm.maxTokens,
                DEFAULT_INTEGRATION_SETTINGS.llm.maxTokens,
            ),
            streamResponses: llm.streamResponses === true,
        },
    };
}

function Toggle({ checked, label, description, onChange, disabled = false }) {
    return (
        <label
            className={`flex items-start justify-between gap-5 rounded-lg px-4 py-3 ${
                disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
            }`}
        >
            <span>
                <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                    {label}
                </span>
                <span className="mt-1 block text-sm leading-5 text-slate-500 dark:text-slate-400">
                    {description}
                </span>
            </span>
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(event) => onChange(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-blue-600 disabled:cursor-not-allowed"
            />
        </label>
    );
}

function TabButton({ active, tabId, panelId, children, onClick }) {
    return (
        <button
            id={tabId}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={panelId}
            tabIndex={active ? 0 : -1}
            onClick={onClick}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                active
                    ? "bg-white text-blue-700 shadow-sm dark:bg-slate-800 dark:text-blue-300"
                    : "text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-slate-100"
            }`}
        >
            {children}
        </button>
    );
}

function TextField({
    id,
    label,
    description,
    value,
    onChange,
    type = "text",
    placeholder = "",
    disabled = false,
    min,
    max,
    step,
}) {
    return (
        <div>
            <label
                htmlFor={id}
                className="block text-sm font-medium text-slate-900 dark:text-slate-100"
            >
                {label}
            </label>
            {description && (
                <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    {description}
                </p>
            )}
            <input
                id={id}
                type={type}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                disabled={disabled}
                min={min}
                max={max}
                step={step}
                spellCheck={false}
                autoComplete={
                    type === "password"
                        ? "new-password"
                        : type === "url"
                          ? "url"
                          : "off"
                }
                className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
            />
        </div>
    );
}

function MultiSelectField({
    id,
    label,
    description,
    value,
    options,
    onChange,
    disabled = false,
}) {
    const [open, setOpen] = useState(false);
    const dropdownRef = useRef(null);
    const selectedOptions = options.filter((option) =>
        value.includes(option.value),
    );

    useEffect(() => {
        function handleClickOutside(event) {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target)
            ) {
                setOpen(false);
            }
        }

        function handleEscape(event) {
            if (event.key === "Escape") {
                setOpen(false);
            }
        }

        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("keydown", handleEscape);

        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("keydown", handleEscape);
        };
    }, []);

    useEffect(() => {
        if (disabled) {
            setOpen(false);
        }
    }, [disabled]);

    function toggleOption(optionValue) {
        if (disabled) {
            return;
        }

        const nextValue = value.includes(optionValue)
            ? value.filter((selectedValue) => selectedValue !== optionValue)
            : [...value, optionValue];

        onChange(nextValue);
    }

    function removeOption(optionValue) {
        if (disabled) {
            return;
        }

        onChange(
            value.filter((selectedValue) => selectedValue !== optionValue),
        );
    }

    return (
        <div ref={dropdownRef}>
            <label
                id={`${id}-label`}
                className="block text-sm font-medium text-slate-900 dark:text-slate-100"
            >
                {label}
            </label>
            <p
                id={`${id}-description`}
                className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400"
            >
                {description}
            </p>
            <div className="relative mt-2">
                <button
                    id={`${id}-trigger`}
                    type="button"
                    disabled={disabled}
                    aria-haspopup="listbox"
                    aria-expanded={open}
                    aria-controls={`${id}-listbox`}
                    aria-labelledby={`${id}-label`}
                    aria-describedby={`${id}-description`}
                    onClick={() => {
                        if (!disabled) {
                            setOpen((current) => !current);
                        }
                    }}
                    className="flex w-full items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-950 outline-none transition hover:border-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:hover:border-slate-600"
                >
                    <span
                        className={
                            selectedOptions.length > 0
                                ? "text-slate-900 dark:text-slate-100"
                                : "text-slate-400 dark:text-slate-500"
                        }
                    >
                        {selectedOptions.length === 0
                            ? "Select OAuth scopes"
                            : `${selectedOptions.length} scope${
                                  selectedOptions.length === 1 ? "" : "s"
                              } selected`}
                    </span>
                    <svg
                        aria-hidden="true"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className={`h-4 w-4 shrink-0 text-slate-500 transition-transform dark:text-slate-400 ${
                            open ? "rotate-180" : ""
                        }`}
                    >
                        <path
                            fillRule="evenodd"
                            d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.09 1.04l-4.25 4.5a.75.75 0 0 1-1.09 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
                            clipRule="evenodd"
                        />
                    </svg>
                </button>
                {open && !disabled && (
                    <div
                        id={`${id}-listbox`}
                        role="listbox"
                        aria-multiselectable="true"
                        aria-labelledby={`${id}-label`}
                        className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900"
                    >
                        {options.map((option) => {
                            const selected = value.includes(option.value);

                            return (
                                <label
                                    key={option.value}
                                    role="option"
                                    aria-selected={selected}
                                    className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                                        selected
                                            ? "bg-blue-50 text-blue-950 dark:bg-blue-950/40 dark:text-blue-100"
                                            : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                                    }`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selected}
                                        disabled={disabled}
                                        onChange={() =>
                                            toggleOption(option.value)
                                        }
                                        className="h-4 w-4 shrink-0 cursor-pointer accent-blue-600 disabled:cursor-not-allowed"
                                    />
                                    <span className="min-w-0 flex-1">
                                        {option.label}
                                    </span>
                                    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                        {option.value}
                                    </code>
                                </label>
                            );
                        })}
                    </div>
                )}
            </div>
            <div aria-live="polite" className="mt-3">
                {selectedOptions.length > 0 ? (
                    <>
                        <p className="mb-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                            Selected scopes
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {selectedOptions.map((option) => (
                                <div
                                    key={option.value}
                                    className={`flex items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 dark:border-blue-900/70 dark:bg-blue-950/30 ${
                                        disabled ? "opacity-50" : ""
                                    }`}
                                >
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-blue-950 dark:text-blue-100">
                                            {option.label}
                                        </p>
                                        <code className="mt-1 inline-block rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800 dark:bg-blue-900/60 dark:text-blue-200">
                                            {option.value}
                                        </code>
                                    </div>
                                    <button
                                        type="button"
                                        disabled={disabled}
                                        onClick={() => removeOption(option.value)}
                                        aria-label={`Remove ${option.label}`}
                                        className="shrink-0 rounded-md p-1 text-blue-700 transition hover:bg-blue-100 hover:text-blue-950 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-900/60 dark:hover:text-blue-100"
                                    >
                                        <svg
                                            aria-hidden="true"
                                            viewBox="0 0 20 20"
                                            fill="currentColor"
                                            className="h-4 w-4"
                                        >
                                            <path d="M4.3 4.3a1 1 0 0 1 1.4 0L10 8.59l4.3-4.3a1 1 0 1 1 1.4 1.42L11.42 10l4.28 4.3a1 1 0 0 1-1.4 1.4L10 11.42l-4.3 4.28a1 1 0 0 1-1.4-1.4L8.58 10 4.3 5.7a1 1 0 0 1 0-1.4Z" />
                                        </svg>
                                    </button>
                                </div>
                            ))}
                        </div>
                    </>
                ) : (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        No OAuth scopes selected.
                    </p>
                )}
            </div>
        </div>
    );
}

function IntegrationCard({ title, description, children }) {
    return (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800">
                <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">
                    {title}
                </h2>
                <p className="mt-1 text-sm leading-5 text-slate-500 dark:text-slate-400">
                    {description}
                </p>
            </div>
            <div className="space-y-5 px-6 py-6">{children}</div>
        </section>
    );
}

function ConfiguredStatus({ configured, children }) {
    if (!configured) {
        return null;
    }

    return (
        <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
            {children}
        </p>
    );
}

function DisabledProviderNotice({ children }) {
    return (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {children}
        </p>
    );
}

export default function SettingsPage() {
    const { signedIn, loginWithGoogle } = useAuth();
    const { dark, toggleTheme } = useTheme();
    const {
        githubIntegrationEnabled,
        gitlabIntegrationEnabled,
        setGitHubIntegrationEnabled,
        setGitLabIntegrationEnabled,
    } = useIntegrationSettings();

    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    const [integrationSettings, setIntegrationSettings] = useState(
        createDefaultIntegrationSettings,
    );
    const [saved, setSaved] = useState(false);
    const [ready, setReady] = useState(false);
    const [activeTab, setActiveTab] = useState("app");
    const [integrationSettingsLoading, setIntegrationSettingsLoading] =
        useState(false);
    const [integrationSettingsSaving, setIntegrationSettingsSaving] =
        useState(false);
    const [integrationSettingsError, setIntegrationSettingsError] =
        useState("");
    const [integrationSettingsSaved, setIntegrationSettingsSaved] =
        useState(false);

    const integrationFormDisabled =
        !signedIn ||
        integrationSettingsLoading ||
        integrationSettingsSaving;

    const githubSettingsDisabled =
        integrationFormDisabled || !githubIntegrationEnabled;

    const gitlabSettingsDisabled =
        integrationFormDisabled || !gitlabIntegrationEnabled;

    const llmSettingsDisabled =
        integrationFormDisabled || !integrationSettings.llm.enabled;

    useEffect(() => {
        try {
            const storedSettings = window.localStorage.getItem(
                SETTINGS_STORAGE_KEY,
            );

            if (storedSettings) {
                setSettings({
                    ...DEFAULT_SETTINGS,
                    ...JSON.parse(storedSettings),
                });
            }
        } catch {
            setSettings(DEFAULT_SETTINGS);
        } finally {
            setReady(true);
        }
    }, []);

    useEffect(() => {
        if (!ready) {
            return undefined;
        }

        try {
            window.localStorage.setItem(
                SETTINGS_STORAGE_KEY,
                JSON.stringify(settings),
            );
            setSaved(true);

            const timeoutId = window.setTimeout(() => {
                setSaved(false);
            }, 1800);

            return () => window.clearTimeout(timeoutId);
        } catch {
            return undefined;
        }
    }, [settings, ready]);

    useEffect(() => {
        let cancelled = false;

        async function loadIntegrationSettings() {
            if (!signedIn) {
                if (!cancelled) {
                    setIntegrationSettings(createDefaultIntegrationSettings());
                    setIntegrationSettingsError("");
                    setIntegrationSettingsLoading(false);
                    setIntegrationSettingsSaved(false);
                }

                return;
            }

            setIntegrationSettingsLoading(true);
            setIntegrationSettingsError("");

            try {
                const response = await apiFetch("/v1/auth/me", {
                    method: "GET",
                    credentials: "include",
                });

                const serverSettings = response?.settings;

                if (!serverSettings || typeof serverSettings !== "object") {
                    throw new Error(
                        "The authenticated user response did not include settings.",
                    );
                }

                if (!cancelled) {
                    setIntegrationSettings(
                        mapBackendSettingsToFormState(serverSettings),
                    );
                    setGitHubIntegrationEnabled(
                        serverSettings.github?.enabled === true,
                    );
                    setGitLabIntegrationEnabled(
                        serverSettings.gitlab?.enabled === true,
                    );
                }
            } catch (error) {
                if (!cancelled) {
                    setIntegrationSettingsError(
                        error instanceof Error
                            ? error.message
                            : "Unable to load saved integration settings.",
                    );
                }
            } finally {
                if (!cancelled) {
                    setIntegrationSettingsLoading(false);
                }
            }
        }

        loadIntegrationSettings();

        return () => {
            cancelled = true;
        };
    }, [
        signedIn,
        setGitHubIntegrationEnabled,
        setGitLabIntegrationEnabled,
    ]);

    function updateSetting(key, value) {
        setSettings((current) => ({
            ...current,
            [key]: value,
        }));
    }

    function updateIntegrationSetting(section, key, value) {
        setIntegrationSettings((current) => ({
            ...current,
            [section]: {
                ...current[section],
                [key]: value,
            },
        }));
    }

    function resetSettings() {
        setSettings(DEFAULT_SETTINGS);
    }

    function buildIntegrationSettingsPayload() {
        const githubClientId = integrationSettings.github.clientId.trim();
        const githubClientSecret =
            integrationSettings.github.clientSecret.trim();
        const gitlabClientId = integrationSettings.gitlab.clientId.trim();
        const gitlabClientSecret =
            integrationSettings.gitlab.clientSecret.trim();
        const llmApiKey = integrationSettings.llm.apiKey.trim();

        return {
            github: {
                enabled: githubIntegrationEnabled,
                baseUrl: integrationSettings.github.baseUrl.trim(),
                scopes: integrationSettings.github.scopes,
                ...(githubClientId ? { clientId: githubClientId } : {}),
                ...(githubClientSecret
                    ? { clientSecret: githubClientSecret }
                    : {}),
            },
            gitlab: {
                enabled: gitlabIntegrationEnabled,
                baseUrl: integrationSettings.gitlab.baseUrl.trim(),
                scopes: integrationSettings.gitlab.scopes,
                ...(gitlabClientId ? { clientId: gitlabClientId } : {}),
                ...(gitlabClientSecret
                    ? { clientSecret: gitlabClientSecret }
                    : {}),
            },
            llm: {
                enabled: integrationSettings.llm.enabled,
                providerName: integrationSettings.llm.providerName.trim(),
                endpointUrl: integrationSettings.llm.endpointUrl.trim(),
                model: integrationSettings.llm.model.trim(),
                temperature: integrationSettings.llm.temperature,
                maxTokens: integrationSettings.llm.maxTokens,
                streamResponses: integrationSettings.llm.streamResponses,
                ...(llmApiKey ? { apiKey: llmApiKey } : {}),
            },
        };
    }

    async function saveIntegrationSettings() {
        if (!signedIn || integrationSettingsSaving) {
            return;
        }

        setIntegrationSettingsSaving(true);
        setIntegrationSettingsError("");
        setIntegrationSettingsSaved(false);

        try {
            const response = await apiFetch("/v1/settings/update", {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                },
                credentials: "include",
                body: buildIntegrationSettingsPayload(),
            });

            const savedSettings = response?.settings ?? response;

            if (!savedSettings || typeof savedSettings !== "object") {
                throw new Error(
                    "The server did not return the updated integration settings.",
                );
            }

            setIntegrationSettings(
                mapBackendSettingsToFormState(savedSettings),
            );
            setGitHubIntegrationEnabled(
                savedSettings.github?.enabled === true,
            );
            setGitLabIntegrationEnabled(
                savedSettings.gitlab?.enabled === true,
            );
            setIntegrationSettingsSaved(true);

            window.setTimeout(() => {
                setIntegrationSettingsSaved(false);
            }, 3000);
        } catch (error) {
            setIntegrationSettingsError(
                error instanceof Error
                    ? error.message
                    : "Unable to save integration settings.",
            );
        } finally {
            setIntegrationSettingsSaving(false);
        }
    }

    return (
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-10">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                <div>
                    <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                        Account
                    </p>
                    <h1 className="mt-1 text-2xl font-semibold text-slate-950 dark:text-slate-50">
                        Settings
                    </h1>
                </div>
                <div className="flex items-center gap-3">
                    {saved && (
                        <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                            Saved locally
                        </span>
                    )}
                    <Link
                        href="/"
                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                        Back to chat
                    </Link>
                </div>
            </div>

            <div
                role="tablist"
                aria-label="Settings sections"
                className="mb-6 inline-flex rounded-xl bg-slate-100 p-1 dark:bg-slate-900"
            >
                <TabButton
                    active={activeTab === "app"}
                    tabId="app-settings-tab"
                    panelId="app-settings-panel"
                    onClick={() => setActiveTab("app")}
                >
                    App Settings
                </TabButton>
                <TabButton
                    active={activeTab === "integrations"}
                    tabId="integration-settings-tab"
                    panelId="integration-settings-panel"
                    onClick={() => setActiveTab("integrations")}
                >
                    Integration Settings
                </TabButton>
            </div>

            {activeTab === "app" && (
                <div
                    id="app-settings-panel"
                    role="tabpanel"
                    aria-labelledby="app-settings-tab"
                    className="space-y-6"
                >
                    {!signedIn && (
                        <section className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-200">
                            <p className="font-medium">You are not signed in.</p>
                            <p className="mt-1">
                                These local preferences still work in this browser. Sign
                                in to use repository integrations and access your profile.
                            </p>
                            <button
                                type="button"
                                onClick={loginWithGoogle}
                                className="mt-3 rounded-lg border border-amber-500/60 px-3 py-1.5 text-xs font-medium transition hover:bg-amber-100 dark:hover:bg-amber-900/30"
                            >
                                Sign in with Google
                            </button>
                        </section>
                    )}

                    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                        <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800 sm:px-8">
                            <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">
                                Appearance
                            </h2>
                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                Control how the coding-agent interface is displayed.
                            </p>
                        </div>
                        <div className="divide-y divide-slate-200 dark:divide-slate-800">
                            <Toggle
                                checked={dark}
                                label="Dark mode"
                                description="Use the dark color theme across the coding agent."
                                onChange={() => toggleTheme()}
                            />
                            <Toggle
                                checked={settings.compactMode}
                                label="Compact chat layout"
                                description="Reduce visual spacing in the conversation interface."
                                onChange={(value) =>
                                    updateSetting("compactMode", value)
                                }
                            />
                        </div>
                    </section>

                    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                        <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800 sm:px-8">
                            <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">
                                Chat behavior
                            </h2>
                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                Configure interaction behavior for the web coding agent.
                            </p>
                        </div>
                        <div className="divide-y divide-slate-200 dark:divide-slate-800">
                            <Toggle
                                checked={settings.sendWithEnter}
                                label="Send messages with Enter"
                                description="Use Shift+Enter to add a new line when this option is enabled."
                                onChange={(value) =>
                                    updateSetting("sendWithEnter", value)
                                }
                            />
                            <Toggle
                                checked={settings.streamResponses}
                                label="Stream agent responses"
                                description="Show assistant output progressively while it is generated."
                                onChange={(value) =>
                                    updateSetting("streamResponses", value)
                                }
                            />
                            <Toggle
                                checked={settings.showSources}
                                label="Show retrieval sources"
                                description="Display codebase or RAG citations with agent responses when available."
                                onChange={(value) =>
                                    updateSetting("showSources", value)
                                }
                            />
                        </div>
                    </section>

                    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                        <div className="border-b border-slate-200 px-6 py-5 dark:border-slate-800 sm:px-8">
                            <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">
                                Agent safety
                            </h2>
                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                These options control safeguards for tool-using agent actions.
                            </p>
                        </div>
                        <div className="divide-y divide-slate-200 dark:divide-slate-800">
                            <Toggle
                                checked={settings.confirmRiskyActions}
                                label="Confirm high-impact actions"
                                description="Require confirmation before actions that modify repositories, send messages, or change external resources."
                                onChange={(value) =>
                                    updateSetting("confirmRiskyActions", value)
                                }
                            />
                        </div>
                    </section>

                    <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between sm:px-8">
                        <div>
                            <h2 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                                Reset local settings
                            </h2>
                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                Restore the default browser-stored interface preferences.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={resetSettings}
                            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                            Reset settings
                        </button>
                    </section>
                </div>
            )}

            {activeTab === "integrations" && (
                <div
                    id="integration-settings-panel"
                    role="tabpanel"
                    aria-labelledby="integration-settings-tab"
                    className="space-y-6"
                >
                    {!signedIn && (
                        <section className="rounded-2xl border border-amber-300 bg-amber-50 px-6 py-5 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-200 sm:px-8">
                            <p className="font-semibold">
                                Sign in before saving integration settings.
                            </p>
                            <p className="mt-2 leading-6">
                                OAuth credentials and LLM API keys can be saved only from
                                an authenticated session.
                            </p>
                            <button
                                type="button"
                                onClick={loginWithGoogle}
                                className="mt-4 rounded-lg border border-amber-500/60 px-3 py-2 text-xs font-medium transition hover:bg-amber-100 dark:hover:bg-amber-900/30"
                            >
                                Sign in with Google
                            </button>
                        </section>
                    )}

                    <div className="grid gap-6 lg:grid-cols-2">
                        <IntegrationCard
                            title="GitHub"
                            description="Configure GitHub OAuth and repository access permissions."
                        >
                            <Toggle
                                checked={githubIntegrationEnabled}
                                label="Enable GitHub integration"
                                description="Allow repository-aware features through GitHub."
                                onChange={setGitHubIntegrationEnabled}
                                disabled={integrationFormDisabled}
                            />
                            {!githubIntegrationEnabled && (
                                <DisabledProviderNotice>
                                    Enable GitHub integration to edit its OAuth configuration.
                                </DisabledProviderNotice>
                            )}
                            <fieldset
                                disabled={githubSettingsDisabled}
                                className="space-y-5 rounded-xl border border-slate-200 p-4 transition-opacity disabled:opacity-50 dark:border-slate-800"
                            >
                                <legend className="sr-only">
                                    GitHub integration configuration
                                </legend>
                                <TextField
                                    id="github-base-url"
                                    label="GitHub base URL"
                                    description="Use github.com or your GitHub Enterprise Server URL."
                                    type="url"
                                    value={integrationSettings.github.baseUrl}
                                    onChange={(value) =>
                                        updateIntegrationSetting(
                                            "github",
                                            "baseUrl",
                                            value,
                                        )
                                    }
                                    placeholder="https://github.com"
                                    disabled={githubSettingsDisabled}
                                />
                                <div className="space-y-2">
                                    <TextField
                                        id="github-client-id"
                                        label="OAuth client ID"
                                        description={
                                            integrationSettings.github.clientIdConfigured
                                                ? "A client ID is configured. Enter a value only to replace it."
                                                : "Enter the GitHub OAuth client ID."
                                        }
                                        value={integrationSettings.github.clientId}
                                        onChange={(value) =>
                                            updateIntegrationSetting(
                                                "github",
                                                "clientId",
                                                value,
                                            )
                                        }
                                        placeholder={
                                            integrationSettings.github.clientIdConfigured
                                                ? "Configured. Enter a new value to replace it."
                                                : "GitHub OAuth client ID"
                                        }
                                        disabled={githubSettingsDisabled}
                                    />
                                    <ConfiguredStatus
                                        configured={
                                            integrationSettings.github
                                                .clientIdConfigured
                                        }
                                    >
                                        Client ID configured on the server.
                                    </ConfiguredStatus>
                                </div>
                                <div className="space-y-2">
                                    <TextField
                                        id="github-client-secret"
                                        label="OAuth client secret"
                                        description={
                                            integrationSettings.github
                                                .clientSecretConfigured
                                                ? "A secret is configured. Leave blank to keep it, or enter a value to replace it."
                                                : "Stored securely by the backend and never persisted in browser storage."
                                        }
                                        type="password"
                                        value={
                                            integrationSettings.github.clientSecret
                                        }
                                        onChange={(value) =>
                                            updateIntegrationSetting(
                                                "github",
                                                "clientSecret",
                                                value,
                                            )
                                        }
                                        placeholder={
                                            integrationSettings.github
                                                .clientSecretConfigured
                                                ? "Configured. Enter a new value to replace it."
                                                : "GitHub OAuth client secret"
                                        }
                                        disabled={githubSettingsDisabled}
                                    />
                                    <ConfiguredStatus
                                        configured={
                                            integrationSettings.github
                                                .clientSecretConfigured
                                        }
                                    >
                                        Client secret configured on the server.
                                    </ConfiguredStatus>
                                </div>
                                <MultiSelectField
                                    id="github-scopes"
                                    label="OAuth scopes"
                                    description="Choose only the permissions required by the integration."
                                    value={integrationSettings.github.scopes}
                                    options={GITHUB_SCOPE_OPTIONS}
                                    onChange={(scopes) =>
                                        updateIntegrationSetting(
                                            "github",
                                            "scopes",
                                            scopes,
                                        )
                                    }
                                    disabled={githubSettingsDisabled}
                                />
                            </fieldset>
                        </IntegrationCard>

                        <IntegrationCard
                            title="GitLab"
                            description="Configure GitLab OAuth and repository access permissions."
                        >
                            <Toggle
                                checked={gitlabIntegrationEnabled}
                                label="Enable GitLab integration"
                                description="Allow repository-aware features through GitLab."
                                onChange={setGitLabIntegrationEnabled}
                                disabled={integrationFormDisabled}
                            />
                            {!gitlabIntegrationEnabled && (
                                <DisabledProviderNotice>
                                    Enable GitLab integration to edit its OAuth configuration.
                                </DisabledProviderNotice>
                            )}
                            <fieldset
                                disabled={gitlabSettingsDisabled}
                                className="space-y-5 rounded-xl border border-slate-200 p-4 transition-opacity disabled:opacity-50 dark:border-slate-800"
                            >
                                <legend className="sr-only">
                                    GitLab integration configuration
                                </legend>
                                <TextField
                                    id="gitlab-base-url"
                                    label="GitLab base URL"
                                    description="Use gitlab.com or your self-managed GitLab URL."
                                    type="url"
                                    value={integrationSettings.gitlab.baseUrl}
                                    onChange={(value) =>
                                        updateIntegrationSetting(
                                            "gitlab",
                                            "baseUrl",
                                            value,
                                        )
                                    }
                                    placeholder="https://gitlab.com"
                                    disabled={gitlabSettingsDisabled}
                                />
                                <div className="space-y-2">
                                    <TextField
                                        id="gitlab-client-id"
                                        label="OAuth application ID"
                                        description={
                                            integrationSettings.gitlab.clientIdConfigured
                                                ? "An application ID is configured. Enter a value only to replace it."
                                                : "Enter the GitLab OAuth application ID."
                                        }
                                        value={integrationSettings.gitlab.clientId}
                                        onChange={(value) =>
                                            updateIntegrationSetting(
                                                "gitlab",
                                                "clientId",
                                                value,
                                            )
                                        }
                                        placeholder={
                                            integrationSettings.gitlab.clientIdConfigured
                                                ? "Configured. Enter a new value to replace it."
                                                : "GitLab application ID"
                                        }
                                        disabled={gitlabSettingsDisabled}
                                    />
                                    <ConfiguredStatus
                                        configured={
                                            integrationSettings.gitlab
                                                .clientIdConfigured
                                        }
                                    >
                                        Application ID configured on the server.
                                    </ConfiguredStatus>
                                </div>
                                <div className="space-y-2">
                                    <TextField
                                        id="gitlab-client-secret"
                                        label="OAuth secret"
                                        description={
                                            integrationSettings.gitlab
                                                .clientSecretConfigured
                                                ? "A secret is configured. Leave blank to keep it, or enter a value to replace it."
                                                : "Stored securely by the backend and never persisted in browser storage."
                                        }
                                        type="password"
                                        value={
                                            integrationSettings.gitlab.clientSecret
                                        }
                                        onChange={(value) =>
                                            updateIntegrationSetting(
                                                "gitlab",
                                                "clientSecret",
                                                value,
                                            )
                                        }
                                        placeholder={
                                            integrationSettings.gitlab
                                                .clientSecretConfigured
                                                ? "Configured. Enter a new value to replace it."
                                                : "GitLab OAuth secret"
                                        }
                                        disabled={gitlabSettingsDisabled}
                                    />
                                    <ConfiguredStatus
                                        configured={
                                            integrationSettings.gitlab
                                                .clientSecretConfigured
                                        }
                                    >
                                        OAuth secret configured on the server.
                                    </ConfiguredStatus>
                                </div>
                                <MultiSelectField
                                    id="gitlab-scopes"
                                    label="OAuth scopes"
                                    description="Choose only the permissions required by the integration."
                                    value={integrationSettings.gitlab.scopes}
                                    options={GITLAB_SCOPE_OPTIONS}
                                    onChange={(scopes) =>
                                        updateIntegrationSetting(
                                            "gitlab",
                                            "scopes",
                                            scopes,
                                        )
                                    }
                                    disabled={gitlabSettingsDisabled}
                                />
                            </fieldset>
                        </IntegrationCard>

                        <IntegrationCard
                            title="LLM endpoint"
                            description="Configure the model endpoint used by the coding agent."
                        >
                            <Toggle
                                checked={integrationSettings.llm.enabled}
                                label="Enable custom LLM endpoint"
                                description="Use an externally configured LLM provider or self-hosted endpoint."
                                onChange={(value) =>
                                    updateIntegrationSetting(
                                        "llm",
                                        "enabled",
                                        value,
                                    )
                                }
                                disabled={integrationFormDisabled}
                            />
                            {!integrationSettings.llm.enabled && (
                                <DisabledProviderNotice>
                                    Enable the custom LLM endpoint to edit its provider configuration.
                                </DisabledProviderNotice>
                            )}
                            <fieldset
                                disabled={llmSettingsDisabled}
                                className="space-y-5 rounded-xl border border-slate-200 p-4 transition-opacity disabled:opacity-50 dark:border-slate-800"
                            >
                                <legend className="sr-only">
                                    LLM endpoint configuration
                                </legend>
                                <TextField
                                    id="llm-provider-name"
                                    label="Provider name"
                                    value={integrationSettings.llm.providerName}
                                    onChange={(value) =>
                                        updateIntegrationSetting(
                                            "llm",
                                            "providerName",
                                            value,
                                        )
                                    }
                                    placeholder="OpenAI, Anthropic, Ollama, vLLM, or custom"
                                    disabled={llmSettingsDisabled}
                                />
                                <TextField
                                    id="llm-endpoint-url"
                                    label="Endpoint URL"
                                    type="url"
                                    value={integrationSettings.llm.endpointUrl}
                                    onChange={(value) =>
                                        updateIntegrationSetting(
                                            "llm",
                                            "endpointUrl",
                                            value,
                                        )
                                    }
                                    placeholder="https://api.example.com/v1"
                                    disabled={llmSettingsDisabled}
                                />
                                <TextField
                                    id="llm-model"
                                    label="Model ID"
                                    value={integrationSettings.llm.model}
                                    onChange={(value) =>
                                        updateIntegrationSetting(
                                            "llm",
                                            "model",
                                            value,
                                        )
                                    }
                                    placeholder="model-name-or-deployment-id"
                                    disabled={llmSettingsDisabled}
                                />
                                <div className="space-y-2">
                                    <TextField
                                        id="llm-api-key"
                                        label="API key"
                                        description={
                                            integrationSettings.llm.apiKeyConfigured
                                                ? "An API key is configured. Leave blank to keep it, or enter a value to replace it."
                                                : "Stored securely by the backend and never persisted in browser storage."
                                        }
                                        type="password"
                                        value={integrationSettings.llm.apiKey}
                                        onChange={(value) =>
                                            updateIntegrationSetting(
                                                "llm",
                                                "apiKey",
                                                value,
                                            )
                                        }
                                        placeholder={
                                            integrationSettings.llm.apiKeyConfigured
                                                ? "Configured. Enter a new value to replace it."
                                                : "LLM provider API key"
                                        }
                                        disabled={llmSettingsDisabled}
                                    />
                                    <ConfiguredStatus
                                        configured={
                                            integrationSettings.llm.apiKeyConfigured
                                        }
                                    >
                                        API key configured on the server.
                                    </ConfiguredStatus>
                                </div>
                                <TextField
                                    id="llm-temperature"
                                    label="Temperature"
                                    description="Controls output variability, from 0 to 2."
                                    type="number"
                                    min="0"
                                    max="2"
                                    step="0.1"
                                    value={integrationSettings.llm.temperature}
                                    onChange={(value) =>
                                        updateIntegrationSetting(
                                            "llm",
                                            "temperature",
                                            Number(value),
                                        )
                                    }
                                    disabled={llmSettingsDisabled}
                                />
                                <TextField
                                    id="llm-max-tokens"
                                    label="Maximum output tokens"
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={integrationSettings.llm.maxTokens}
                                    onChange={(value) =>
                                        updateIntegrationSetting(
                                            "llm",
                                            "maxTokens",
                                            Number(value),
                                        )
                                    }
                                    disabled={llmSettingsDisabled}
                                />
                                <Toggle
                                    checked={
                                        integrationSettings.llm.streamResponses
                                    }
                                    label="Stream responses"
                                    description="Show model output progressively while it is generated."
                                    onChange={(value) =>
                                        updateIntegrationSetting(
                                            "llm",
                                            "streamResponses",
                                            value,
                                        )
                                    }
                                    disabled={llmSettingsDisabled}
                                />
                            </fieldset>
                        </IntegrationCard>
                    </div>

                    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:px-8">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h2 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                                    Save integration settings
                                </h2>
                                <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                                    Settings are saved to your authenticated account.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={saveIntegrationSettings}
                                disabled={integrationFormDisabled}
                                className="inline-flex shrink-0 items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-slate-900"
                            >
                                {integrationSettingsSaving
                                    ? "Saving..."
                                    : "Save integration settings"}
                            </button>
                        </div>
                        {integrationSettingsLoading && (
                            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                                Loading saved integration settings...
                            </p>
                        )}
                        {integrationSettingsSaved && (
                            <p
                                role="status"
                                className="mt-4 text-sm font-medium text-emerald-600 dark:text-emerald-400"
                            >
                                Integration settings saved successfully.
                            </p>
                        )}
                        {integrationSettingsError && (
                            <p
                                role="alert"
                                className="mt-4 text-sm font-medium text-red-600 dark:text-red-400"
                            >
                                {integrationSettingsError}
                            </p>
                        )}
                    </section>
                </div>
            )}
        </main>
    );
}
