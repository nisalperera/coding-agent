// front-end/local/hooks/useChat.js
//
// Persistent conversation-aware chat state.
//
// Responsibilities:
// - Load authenticated users' conversation metadata from GET /v1/conversations.
// - Lazily load selected conversation messages from GET /v1/conversations/{id}.
// - Create each browser-created UUID conversation through POST /v1/conversations.
// - Keep UI messages separate from normalized LLM history.
// - Send conversation_id with each streaming chat request.
// - Preserve the existing retry, progress, confirmation, and streaming behavior.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, apiStream, ApiError } from "../lib/api";
import { consumeAgentStream } from "../lib/stream";

let nextMessageId = 1;

function makeMessageId() {
    nextMessageId += 1;
    return `local-${nextMessageId}`;
}

function makeConversationId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }

    return `conversation-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;
}

function now() {
    return Date.now();
}

function createLocalConversation() {
    const timestamp = now();

    return {
        id: makeConversationId(),
        title: "New conversation",
        client: "web",
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
        lastMessageAt: timestamp,
        messages: [],
        history: [],
        loaded: true,
        loading: false,
        creating: false,
    };
}

function normalizeConversationSummary(conversation) {
    return {
        id: conversation.id,
        title: conversation.title || "New conversation",
        client: conversation.client || "web",
        status: conversation.status || "active",
        createdAt: conversation.created_at ?? conversation.createdAt ?? now(),
        updatedAt: conversation.updated_at ?? conversation.updatedAt ?? now(),
        lastMessageAt:
            conversation.last_message_at ??
            conversation.lastMessageAt ??
            conversation.updated_at ??
            conversation.updatedAt ??
            now(),
        messages: [],
        history: [],
        loaded: false,
        loading: false,
        creating: false,
    };
}

function getConversationTitle(message) {
    const normalized = String(message ?? "")
        .replace(/\s+/g, " ")
        .trim();

    if (!normalized) {
        return "New conversation";
    }

    const maxLength = 56;

    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function getTextFromContent(content) {
    if (!Array.isArray(content)) {
        return "";
    }

    return content
        .filter((part) => part?.type === "text")
        .map((part) => part.text ?? "")
        .filter(Boolean)
        .join("\n");
}

function getFilesFromContent(content) {
    if (!Array.isArray(content)) {
        return [];
    }

    return content
        .filter((part) => part?.type === "file" || part?.type === "image")
        .map((part) => ({
            name: part.filename || "Attachment",
            size: part.size_bytes ?? null,
            storageKey: part.storage_key ?? null,
            mimeType: part.mime_type ?? null,
        }));
}

function toUiMessage(message) {
    const text = getTextFromContent(message.content);
    const files = getFilesFromContent(message.content);

    return {
        id: message.id ?? message.message_id ?? makeMessageId(),
        role: message.role,
        text,
        files,
        error: message.status === "failed",
        retryable: false,
        persisted: true,
        createdAt: message.created_at ?? message.createdAt ?? now(),
    };
}

function toHistoryEntry(message) {
    if (!["system", "user", "assistant", "tool"].includes(message.role)) {
        return null;
    }

    const content = getTextFromContent(message.content);

    if (!content && message.role !== "tool") {
        return null;
    }

    const entry = {
        role: message.role,
        content,
    };

    if (message.tool_call_id) {
        entry.tool_call_id = message.tool_call_id;
    }

    if (message.tool_name) {
        entry.name = message.tool_name;
    }

    return entry;
}

function fromConversationDetail(detail) {
    const rawMessages = Array.isArray(detail.messages) ? detail.messages : [];

    return {
        id: detail.id,
        title: detail.title || "New conversation",
        client: detail.client || "web",
        status: detail.status || "active",
        createdAt: detail.created_at ?? now(),
        updatedAt: detail.updated_at ?? now(),
        lastMessageAt:
            detail.last_message_at ??
            detail.updated_at ??
            detail.created_at ??
            now(),
        messages: rawMessages.map(toUiMessage),
        history: rawMessages.map(toHistoryEntry).filter(Boolean),
        loaded: true,
        loading: false,
        creating: false,
    };
}

function replaceConversation(conversations, conversationId, updater) {
    return conversations.map((conversation) =>
        conversation.id === conversationId
            ? updater(conversation)
            : conversation,
    );
}

function orderConversations(conversations) {
    return [...conversations].sort(
        (left, right) =>
            Number(right.lastMessageAt ?? right.updatedAt ?? 0) -
            Number(left.lastMessageAt ?? left.updatedAt ?? 0),
    );
}

function isNotFoundError(error) {
    return error instanceof ApiError && error.status === 404;
}

export function useChat({ signedIn = false } = {}) {
    const initialConversationRef = useRef(createLocalConversation());
    const streamConversationIdRef = useRef(null);
    const loadRequestRef = useRef(0);

    const [conversations, setConversations] = useState([
        initialConversationRef.current,
    ]);
    const [activeConversationId, setActiveConversationId] = useState(
        initialConversationRef.current.id,
    );
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState(null);
    const [conversationsLoading, setConversationsLoading] = useState(false);
    const [conversationsError, setConversationsError] = useState(null);

    const activeConversation =
        conversations.find(
            (conversation) => conversation.id === activeConversationId,
        ) ?? null;

    const messages = activeConversation?.messages ?? [];

    const updateConversation = useCallback((conversationId, updater) => {
        setConversations((previous) =>
            orderConversations(
                replaceConversation(previous, conversationId, updater),
            ),
        );
    }, []);

    const appendMessage = useCallback(
        (role, text, extra = {}, conversationId = activeConversationId) => {
            const id = makeMessageId();
            const timestamp = now();

            updateConversation(conversationId, (conversation) => ({
                ...conversation,
                updatedAt: timestamp,
                lastMessageAt: timestamp,
                messages: [
                    ...conversation.messages,
                    {
                        id,
                        role,
                        text,
                        ...extra,
                        createdAt: timestamp,
                    },
                ],
            }));

            return id;
        },
        [activeConversationId, updateConversation],
    );

    const updateMessage = useCallback(
        (id, patch, conversationId = activeConversationId) => {
            updateConversation(conversationId, (conversation) => ({
                ...conversation,
                updatedAt: now(),
                messages: conversation.messages.map((message) =>
                    message.id === id ? { ...message, ...patch } : message,
                ),
            }));
        },
        [activeConversationId, updateConversation],
    );

    const removeMessage = useCallback(
        (id, conversationId = activeConversationId) => {
            if (id == null) {
                return;
            }

            updateConversation(conversationId, (conversation) => ({
                ...conversation,
                updatedAt: now(),
                messages: conversation.messages.filter(
                    (message) => message.id !== id,
                ),
            }));
        },
        [activeConversationId, updateConversation],
    );

    const appendHistory = useCallback(
        (entry, conversationId) => {
            updateConversation(conversationId, (conversation) => ({
                ...conversation,
                updatedAt: now(),
                lastMessageAt: now(),
                history: [...conversation.history, entry],
            }));
        },
        [updateConversation],
    );

    const ensureConversationExists = useCallback(
        async (conversationId) => {
            const conversation = conversations.find(
                (item) => item.id === conversationId,
            );

            if (!conversation) {
                throw new Error("Conversation was not found locally.");
            }

            if (!signedIn || !conversation.creating) {
                return conversation;
            }

            const created = await apiFetch("/v1/conversations", {
                method: "POST",
                body: {
                    conversation_id: conversation.id,
                    title: conversation.title || "New conversation",
                    client: "web",
                },
            });

            const normalized = normalizeConversationSummary(created);

            updateConversation(conversationId, (current) => ({
                ...current,
                ...normalized,
                messages: current.messages,
                history: current.history,
                loaded: current.loaded,
                creating: false,
            }));

            return {
                ...conversation,
                ...normalized,
                creating: false,
            };
        },
        [conversations, signedIn, updateConversation],
    );

    const loadConversation = useCallback(
        async (conversationId, { force = false } = {}) => {
            const currentConversation = conversations.find(
                (conversation) => conversation.id === conversationId,
            );

            if (!currentConversation) {
                return null;
            }

            if (!signedIn) {
                return currentConversation;
            }

            if (currentConversation.loaded && !force) {
                return currentConversation;
            }

            if (currentConversation.loading) {
                return currentConversation;
            }

            const requestId = loadRequestRef.current + 1;
            loadRequestRef.current = requestId;

            updateConversation(conversationId, (conversation) => ({
                ...conversation,
                loading: true,
            }));

            try {
                const detail = await apiFetch(
                    `/v1/conversations/${encodeURIComponent(conversationId)}`,
                );

                if (loadRequestRef.current !== requestId) {
                    return null;
                }

                const normalized = fromConversationDetail(detail);

                setConversations((previous) =>
                    orderConversations(
                        replaceConversation(previous, conversationId, (current) => ({
                            ...current,
                            ...normalized,
                            loading: false,
                        })),
                    ),
                );

                return normalized;
            } catch (error) {
                if (loadRequestRef.current !== requestId) {
                    return null;
                }

                if (isNotFoundError(error)) {
                    updateConversation(conversationId, (conversation) => ({
                        ...conversation,
                        loading: false,
                        loaded: true,
                    }));

                    return currentConversation;
                }

                updateConversation(conversationId, (conversation) => ({
                    ...conversation,
                    loading: false,
                }));

                throw error;
            }
        },
        [conversations, signedIn, updateConversation],
    );

    const refreshConversationIndex = useCallback(async () => {
        if (!signedIn) {
            return [];
        }

        setConversationsLoading(true);
        setConversationsError(null);

        try {
            const result = await apiFetch("/v1/conversations");
            const remoteConversations = Array.isArray(result.conversations)
                ? result.conversations
                : [];

            const normalized = remoteConversations.map(
                normalizeConversationSummary,
            );

            setConversations((previous) => {
                const localById = new Map(
                    previous.map((conversation) => [
                        conversation.id,
                        conversation,
                    ]),
                );

                const merged = normalized.map((remoteConversation) => {
                    const localConversation = localById.get(
                        remoteConversation.id,
                    );

                    if (!localConversation) {
                        return remoteConversation;
                    }

                    return {
                        ...remoteConversation,
                        messages: localConversation.messages,
                        history: localConversation.history,
                        loaded: localConversation.loaded,
                        loading: false,
                        creating: false,
                    };
                });

                return orderConversations(merged);
            });

            return normalized;
        } catch (error) {
            const detail =
                error instanceof ApiError
                    ? error.message
                    : error?.message || String(error);

            setConversationsError(detail);
            throw error;
        } finally {
            setConversationsLoading(false);
        }
    }, [signedIn]);

    useEffect(() => {
        let ignore = false;

        async function loadAfterAuthentication() {
            if (!signedIn) {
                setLoading(false);
                setProgress(null);
                setConversationsLoading(false);
                setConversationsError(null);

                const freshConversation = createLocalConversation();

                setConversations([freshConversation]);
                setActiveConversationId(freshConversation.id);

                return;
            }

            try {
                setConversationsLoading(true);
                setConversationsError(null);

                const result = await apiFetch("/v1/conversations");

                if (ignore) {
                    return;
                }

                const remoteConversations = Array.isArray(result.conversations)
                    ? result.conversations
                    : [];

                if (remoteConversations.length === 0) {
                    const newConversation = createLocalConversation();

                    const created = await apiFetch("/v1/conversations", {
                        method: "POST",
                        body: {
                            conversation_id: newConversation.id,
                            title: newConversation.title,
                            client: "web",
                        },
                    });

                    if (ignore) {
                        return;
                    }

                    const normalized = normalizeConversationSummary(created);

                    setConversations([
                        {
                            ...newConversation,
                            ...normalized,
                            messages: [],
                            history: [],
                            loaded: true,
                            loading: false,
                            creating: false,
                        },
                    ]);

                    setActiveConversationId(normalized.id);
                    return;
                }

                const normalized = remoteConversations
                    .map(normalizeConversationSummary)
                    .filter((conversation) => conversation.status === "active");

                if (normalized.length === 0) {
                    const newConversation = createLocalConversation();

                    const created = await apiFetch("/v1/conversations", {
                        method: "POST",
                        body: {
                            conversation_id: newConversation.id,
                            title: newConversation.title,
                            client: "web",
                        },
                    });

                    if (ignore) {
                        return;
                    }

                    const createdConversation = normalizeConversationSummary(created);

                    setConversations([
                        {
                            ...newConversation,
                            ...createdConversation,
                            messages: [],
                            history: [],
                            loaded: true,
                            loading: false,
                            creating: false,
                        },
                    ]);

                    setActiveConversationId(createdConversation.id);
                    return;
                }

                const ordered = orderConversations(normalized);
                const initialConversationId = ordered[0].id;

                setConversations(ordered);
                setActiveConversationId(initialConversationId);

                const detail = await apiFetch(
                    `/v1/conversations/${encodeURIComponent(
                        initialConversationId,
                    )}`,
                );

                if (ignore) {
                    return;
                }

                const initialConversation = fromConversationDetail(detail);

                setConversations((previous) =>
                    orderConversations(
                        replaceConversation(
                            previous,
                            initialConversationId,
                            () => initialConversation,
                        ),
                    ),
                );
            } catch (error) {
                if (ignore) {
                    return;
                }

                const detail =
                    error instanceof ApiError
                        ? error.message
                        : error?.message || String(error);

                setConversationsError(detail);

                const fallbackConversation = createLocalConversation();

                setConversations([fallbackConversation]);
                setActiveConversationId(fallbackConversation.id);
            } finally {
                if (!ignore) {
                    setConversationsLoading(false);
                }
            }
        }

        loadAfterAuthentication();

        return () => {
            ignore = true;
            loadRequestRef.current += 1;
        };
    }, [signedIn]);

    const startNewConversation = useCallback(async () => {
        if (loading || conversationsLoading) {
            return null;
        }

        const conversation = createLocalConversation();

        setConversations((previous) =>
            orderConversations([
                {
                    ...conversation,
                    creating: signedIn,
                },
                ...previous,
            ]),
        );

        setActiveConversationId(conversation.id);
        setProgress(null);

        if (!signedIn) {
            return conversation.id;
        }

        try {
            const created = await apiFetch("/v1/conversations", {
                method: "POST",
                body: {
                    conversation_id: conversation.id,
                    title: conversation.title,
                    client: "web",
                },
            });

            const normalized = normalizeConversationSummary(created);

            updateConversation(conversation.id, (current) => ({
                ...current,
                ...normalized,
                messages: current.messages,
                history: current.history,
                loaded: true,
                loading: false,
                creating: false,
            }));

            return conversation.id;
        } catch (error) {
            const detail =
                error instanceof ApiError
                    ? error.message
                    : error?.message || String(error);

            setConversationsError(`Could not create a new conversation: ${detail}`);

            updateConversation(conversation.id, (current) => ({
                ...current,
                creating: false,
            }));

            return null;
        }
    }, [
        conversationsLoading,
        loading,
        signedIn,
        updateConversation,
    ]);

    const selectConversation = useCallback(
        async (conversationId) => {
            if (
                loading ||
                conversationsLoading ||
                !conversations.some((item) => item.id === conversationId)
            ) {
                return;
            }

            setActiveConversationId(conversationId);
            setProgress(null);

            try {
                await loadConversation(conversationId);
            } catch (error) {
                const detail =
                    error instanceof ApiError
                        ? error.message
                        : error?.message || String(error);

                setConversationsError(
                    `Could not load this conversation: ${detail}`,
                );
            }
        },
        [
            conversations,
            conversationsLoading,
            loadConversation,
            loading,
        ],
    );

    const resolvePendingAction = useCallback(
        async (actionId, decision, conversationId) => {
            setLoading(true);
            setProgress({
                message: "Submitting your request...",
                percent: null,
            });

            try {
                const result = await apiFetch("/v1/actions", {
                    method: "POST",
                    body: {
                        action: "action_pending",
                        action_id: actionId,
                        decision,
                    },
                });

                const reply = result.result ?? "No response from agent.";

                appendMessage("assistant", reply, {}, conversationId);
                appendHistory(
                    {
                        role: "assistant",
                        content: reply,
                    },
                    conversationId,
                );
            } catch (error) {
                const detail =
                    error instanceof ApiError ? error.message : String(error);

                appendMessage(
                    "assistant",
                    `Could not resolve that action: ${detail}`,
                    {
                        error: true,
                        retryable: false,
                    },
                    conversationId,
                );
            } finally {
                setProgress(null);
                setLoading(false);
            }
        },
        [appendHistory, appendMessage],
    );

    const send = useCallback(
        async (message, attachments) => {
            if ((!message && attachments.length === 0) || loading) {
                return;
            }

            const conversationId = activeConversationId;
            const conversation = conversations.find(
                (item) => item.id === conversationId,
            );

            if (!conversation) {
                return;
            }

            let activeConversationForRequest = conversation;

            try {
                activeConversationForRequest =
                    await ensureConversationExists(conversationId);
            } catch (error) {
                const detail =
                    error instanceof ApiError
                        ? error.message
                        : error?.message || String(error);

                appendMessage(
                    "assistant",
                    `Could not create the conversation: ${detail}`,
                    {
                        error: true,
                        retryable: true,
                        retryPayload: {
                            message,
                            attachments,
                        },
                    },
                    conversationId,
                );

                return;
            }

            const filesForRequest = attachments.map(({ name, content }) => ({
                name,
                content,
            }));

            const filesForDisplay = attachments.map(({ name, size }) => ({
                name,
                size,
            }));

            const retryPayload = {
                message,
                attachments: filesForRequest,
            };

            const historyForRequest = activeConversationForRequest.history;

            const timestamp = now();

            updateConversation(conversationId, (currentConversation) => ({
                ...currentConversation,
                title:
                    currentConversation.title === "New conversation" &&
                        currentConversation.messages.length === 0
                        ? getConversationTitle(message)
                        : currentConversation.title,
                updatedAt: timestamp,
                lastMessageAt: timestamp,
                history: [
                    ...currentConversation.history,
                    {
                        role: "user",
                        content: message,
                        attachments: filesForRequest,
                    },
                ],
            }));

            appendMessage(
                "user",
                message || "(sent files only)",
                { files: filesForDisplay },
                conversationId,
            );

            setLoading(true);
            streamConversationIdRef.current = conversationId;

            let answerId = null;
            let answerText = "";
            let handledTerminalEvent = false;

            try {
                const response = await apiStream("/v1/chat/completions", {
                    conversation_id: conversationId,
                    message,
                    history: historyForRequest,
                    attachments: filesForRequest,
                });

                await consumeAgentStream(response, {
                    onProgress: (event) => {
                        if (
                            streamConversationIdRef.current !== conversationId
                        ) {
                            return;
                        }

                        setProgress({
                            message: event.message ?? "Working...",
                            percent: Number.isFinite(Number(event.percent))
                                ? Number(event.percent)
                                : null,
                        });
                    },

                    onError: (event) => {
                        if (
                            streamConversationIdRef.current !== conversationId
                        ) {
                            return;
                        }

                        setProgress(null);

                        const status = Number(
                            event.status ?? event.status_code,
                        );

                        const retryable =
                            !Number.isFinite(status) ||
                            status === 408 ||
                            status === 429 ||
                            status >= 500;

                        appendMessage(
                            "assistant",
                            event.message ?? "The agent hit an error.",
                            {
                                error: true,
                                retryable,
                                retryPayload: retryable
                                    ? retryPayload
                                    : null,
                            },
                            conversationId,
                        );

                        handledTerminalEvent = true;
                    },

                    onConfirmation: (event) => {
                        if (
                            streamConversationIdRef.current !== conversationId
                        ) {
                            return;
                        }

                        setProgress(null);

                        appendMessage(
                            "confirmation",
                            "",
                            {
                                toolName: event.tool_name,
                                args: event.args,
                                actionId: event.action_id,
                                resolved: false,
                            },
                            conversationId,
                        );

                        handledTerminalEvent = true;
                    },

                    onAnswerStart: () => {
                        if (
                            streamConversationIdRef.current !== conversationId
                        ) {
                            return;
                        }

                        setProgress(null);

                        answerId = appendMessage(
                            "assistant",
                            "",
                            {},
                            conversationId,
                        );
                    },

                    onToken: (token) => {
                        if (
                            streamConversationIdRef.current !== conversationId
                        ) {
                            return;
                        }

                        answerText += token;

                        if (answerId != null) {
                            updateMessage(
                                answerId,
                                { text: answerText },
                                conversationId,
                            );
                        }
                    },

                    onFallback: (event) => {
                        if (
                            streamConversationIdRef.current !== conversationId
                        ) {
                            return;
                        }

                        setProgress(null);

                        const reply =
                            event.result ??
                            event.error ??
                            "No response from agent.";

                        appendMessage(
                            "assistant",
                            reply,
                            {},
                            conversationId,
                        );

                        appendHistory(
                            {
                                role: "assistant",
                                content: reply,
                            },
                            conversationId,
                        );

                        handledTerminalEvent = true;
                    },

                    onDone: () => {
                        if (
                            streamConversationIdRef.current !== conversationId
                        ) {
                            return;
                        }

                        setProgress(null);
                    },
                });

                if (answerId != null) {
                    appendHistory(
                        {
                            role: "assistant",
                            content: answerText,
                        },
                        conversationId,
                    );
                } else if (!handledTerminalEvent) {
                    setProgress(null);

                    appendMessage(
                        "assistant",
                        "No response from agent.",
                        {},
                        conversationId,
                    );
                }
            } catch (error) {
                setProgress(null);

                const detail =
                    error instanceof ApiError
                        ? error.message
                        : error?.message || String(error);

                const status = error instanceof ApiError ? error.status : null;

                const retryable =
                    status == null ||
                    status === 408 ||
                    status === 429 ||
                    status >= 500;

                appendMessage(
                    "assistant",
                    `Request failed: ${detail}`,
                    {
                        error: true,
                        retryable,
                        retryPayload: retryable ? retryPayload : null,
                    },
                    conversationId,
                );
            } finally {
                if (streamConversationIdRef.current === conversationId) {
                    streamConversationIdRef.current = null;
                }

                setProgress(null);
                setLoading(false);
            }
        },
        [
            activeConversationId,
            appendHistory,
            appendMessage,
            conversations,
            ensureConversationExists,
            loading,
            updateConversation,
            updateMessage,
        ],
    );

    const retryFailedMessage = useCallback(
        async (failedMessageId) => {
            if (loading) {
                return;
            }

            const conversationId = activeConversationId;
            const conversation = conversations.find(
                (item) => item.id === conversationId,
            );

            const failedMessage = conversation?.messages.find(
                (message) => message.id === failedMessageId,
            );

            if (!failedMessage?.retryPayload) {
                return;
            }

            removeMessage(failedMessageId, conversationId);

            await send(
                failedMessage.retryPayload.message,
                failedMessage.retryPayload.attachments,
            );
        },
        [
            activeConversationId,
            conversations,
            loading,
            removeMessage,
            send,
        ],
    );

    const resolveConfirmation = useCallback(
        async (messageId, actionId, decision) => {
            const conversationId = activeConversationId;

            updateMessage(
                messageId,
                { resolved: true },
                conversationId,
            );

            await resolvePendingAction(actionId, decision, conversationId);
        },
        [activeConversationId, resolvePendingAction, updateMessage],
    );

    return {
        conversations,
        activeConversationId,
        messages,
        loading,
        progress,
        conversationsLoading,
        conversationsError,
        send,
        appendMessage,
        startNewConversation,
        selectConversation,
        refreshConversationIndex,
        resolveConfirmation,
        retryFailedMessage,
    };
}
