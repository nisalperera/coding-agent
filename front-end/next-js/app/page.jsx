"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Header from "../components/Header";
import ChatLog from "../components/ChatLog";
import TypingIndicator from "../components/TypingIndicator";
import Composer from "../components/Composer";
import IntegrationsModal from "../components/IntegrationsModal";
import { useTheme } from "../components/ThemeProvider";
import { useAuth } from "../hooks/useAuth";
import { useAttachments } from "../hooks/useAttachments";
import { useChat } from "../hooks/useChat";
import { useIntegrationSettings } from "../hooks/useIntegrationSettings";

const EMPTY_INTEGRATIONS = Object.freeze({
    github: Object.freeze({
        connected: false,
        username: null,
        connectedAt: null,
    }),
    gitlab: Object.freeze({
        connected: false,
        username: null,
        connectedAt: null,
    }),
});

function LlmDisabledWarning() {
    return (
        <section
            role="alert"
            aria-labelledby="llm-disabled-title"
            className="mx-auto mb-4 w-full max-w-4xl px-4 sm:px-6"
        >
            <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
                <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 9v4m0 4h.01M10.3 3.9 2.5 17.4A2 2 0 0 0 4.23 20.5h15.54a2 2 0 0 0 1.73-3.1L13.7 3.9a2 2 0 0 0-3.4 0Z"
                    />
                </svg>

                <div className="min-w-0 flex-1">
                    <p
                        id="llm-disabled-title"
                        className="text-sm font-semibold"
                    >
                        LLM integration is disabled
                    </p>
                    <p className="mt-1 text-sm leading-6 text-amber-900 dark:text-amber-200">
                        Enable and save a custom LLM endpoint in{" "}
                        <a
                            href="/settings"
                            className="font-semibold underline underline-offset-2 hover:text-amber-950 dark:hover:text-amber-50"
                        >
                            Settings
                        </a>{" "}
                        before starting a chat.
                    </p>
                </div>
            </div>
        </section>
    );
}

function DisabledComposer() {
    return (
        <section
            aria-label="Chat disabled because LLM integration is disabled"
            className="border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950"
        >
            <div className="mx-auto w-full max-w-4xl px-4 py-4 sm:px-6">
                <div className="rounded-2xl border border-slate-200 bg-slate-100 p-3 opacity-70 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-end gap-3">
                        <button
                            type="button"
                            disabled
                            aria-label="Attachments unavailable while LLM integration is disabled"
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-600"
                        >
                            <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                className="h-5 w-5"
                            >
                                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                            </svg>
                        </button>

                        <div className="min-w-0 flex-1">
                            <textarea
                                id="input"
                                disabled
                                rows={1}
                                value=""
                                placeholder="Enable the LLM integration in Settings to start chatting."
                                aria-describedby="chat-disabled-description"
                                className="min-h-11 w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-500 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400 dark:placeholder:text-slate-600"
                            />
                        </div>

                        <button
                            type="button"
                            disabled
                            aria-label="Send message unavailable while LLM integration is disabled"
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-300 text-slate-500 dark:bg-slate-800 dark:text-slate-600"
                        >
                            <svg
                                aria-hidden="true"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                                className="h-5 w-5"
                            >
                                <path d="M3.4 2.5a1 1 0 0 1 1.06-.1l16 9a1 1 0 0 1 0 1.74l-16 9A1 1 0 0 1 3 21.26V15l8-3-8-3V3.4a1 1 0 0 1 .4-.9Z" />
                            </svg>
                        </button>
                    </div>

                    <p
                        id="chat-disabled-description"
                        className="mt-3 px-1 text-xs text-slate-600 dark:text-slate-400"
                    >
                        Chat is unavailable until the LLM integration is enabled.
                    </p>
                </div>
            </div>
        </section>
    );
}

export default function Page() {
    const auth = useAuth();
    const { loginWithGoogle } = auth;
    const theme = useTheme();

    const {
        integrationSettings,
        githubIntegrationEnabled,
        gitlabIntegrationEnabled,
        llmIntegrationEnabled,
    } = useIntegrationSettings();

    const {
        messages,
        loading,
        send,
        appendMessage,
        resolveConfirmation,
    } = useChat();

    const [integrationsOpen, setIntegrationsOpen] = useState(false);

    const integrationVisibility = useMemo(
        () => ({
            github: githubIntegrationEnabled,
            gitlab: gitlabIntegrationEnabled,
        }),
        [githubIntegrationEnabled, gitlabIntegrationEnabled],
    );

    const visibleIntegrations = useMemo(
        () => ({
            ...(integrationVisibility.github
                ? { github: EMPTY_INTEGRATIONS.github }
                : {}),
            ...(integrationVisibility.gitlab
                ? { gitlab: EMPTY_INTEGRATIONS.gitlab }
                : {}),
        }),
        [integrationVisibility.github, integrationVisibility.gitlab],
    );

    const hasVisibleIntegrations =
        integrationVisibility.github || integrationVisibility.gitlab;

    const chatDisabled = !llmIntegrationEnabled;

    const onAttachmentWarning = useCallback(
        (message) => appendMessage("assistant", message),
        [appendMessage],
    );

    const attachmentsState = useAttachments(onAttachmentWarning);

    useEffect(() => {
        if (!chatDisabled) {
            document.getElementById("input")?.focus();
        }
    }, [chatDisabled]);

    useEffect(() => {
        if (!hasVisibleIntegrations) {
            setIntegrationsOpen(false);
        }
    }, [hasVisibleIntegrations]);

    const handleUnauthenticatedIntegrationRequest = useCallback(() => {
        setIntegrationsOpen(false);
        loginWithGoogle();
    }, [loginWithGoogle]);

    const handleOpenIntegrations = useCallback(() => {
        if (!hasVisibleIntegrations) {
            return;
        }

        setIntegrationsOpen(true);
    }, [hasVisibleIntegrations]);

    return (
        <>
            <Header
                auth={auth}
                integrations={visibleIntegrations}
                integrationVisibility={integrationVisibility}
                onOpenIntegrations={handleOpenIntegrations}
                theme={theme}
            />

            <ChatLog
                messages={messages}
                onResolveConfirmation={resolveConfirmation}
                dragProps={{
                    onDragEnter: attachmentsState.onDragEnter,
                    onDragOver: attachmentsState.onDragOver,
                    onDragLeave: attachmentsState.onDragLeave,
                    onDrop: attachmentsState.onDrop,
                }}
                dragActive={attachmentsState.dragActive && !chatDisabled}
            />

            <TypingIndicator visible={loading && !chatDisabled} />

            {chatDisabled && <LlmDisabledWarning />}

            {chatDisabled ? (
                <DisabledComposer />
            ) : (
                <Composer
                    attachmentsState={attachmentsState}
                    onSend={send}
                    loading={loading}
                />
            )}

            <IntegrationsModal
                open={integrationsOpen && hasVisibleIntegrations}
                onClose={() => setIntegrationsOpen(false)}
                integrations={visibleIntegrations}
                integrationVisibility={integrationVisibility}
                loading={false}
                error={false}
                onRefresh={() => {}}
                onUnauthenticated={handleUnauthenticatedIntegrationRequest}
            />
        </>
    );
}
