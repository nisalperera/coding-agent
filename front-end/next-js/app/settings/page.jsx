"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useTheme } from '../../components/ThemeProvider';

const SETTINGS_STORAGE_KEY = "coding-agent-settings";

const DEFAULT_SETTINGS = {
    sendWithEnter: true,
    streamResponses: true,
    showSources: true,
    confirmRiskyActions: true,
    compactMode: false,
};

function Toggle({ checked, label, description, onChange, disabled = false }) {
    return (
        <label
            className={`flex cursor-pointer items-start justify-between gap-5 px-6 py-5 sm:px-8 ${disabled ? "cursor-not-allowed opacity-50" : ""
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

export default function SettingsPage() {
    const { signedIn, loginWithGoogle } = useAuth();
    const { dark, toggleTheme } = useTheme();

    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    const [saved, setSaved] = useState(false);
    const [ready, setReady] = useState(false);

    useEffect(() => {
        try {
            const storedSettings = window.localStorage.getItem(SETTINGS_STORAGE_KEY);

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
            return;
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

    function updateSetting(key, value) {
        setSettings((current) => ({
            ...current,
            [key]: value,
        }));
    }

    function resetSettings() {
        setSettings(DEFAULT_SETTINGS);
    }

    return (
        <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
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

            {!signedIn && (
                <section className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-200">
                    <p className="font-medium">You are not signed in.</p>

                    <p className="mt-1">
                        These local preferences still work in this browser. Sign in to use
                        repository integrations and access your profile.
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

            <div className="space-y-6">
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
                            onChange={(value) => updateSetting("compactMode", value)}
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
                            onChange={(value) => updateSetting("sendWithEnter", value)}
                        />

                        <Toggle
                            checked={settings.streamResponses}
                            label="Stream agent responses"
                            description="Show assistant output progressively while it is generated."
                            onChange={(value) => updateSetting("streamResponses", value)}
                        />

                        <Toggle
                            checked={settings.showSources}
                            label="Show retrieval sources"
                            description="Display codebase or RAG citations with agent responses when available."
                            onChange={(value) => updateSetting("showSources", value)}
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
        </main>
    );
}
