"use client";

import { useEffect, useRef, useState } from "react";
import MessageBubble from "./MessageBubble";
import ErrorModal from "./ErrorModal";

export default function ChatLog({
    messages,
    loading,
    onResolveConfirmation,
    onRetryFailedMessage,
    dragProps,
    dragActive,
}) {
    const scrollRef = useRef(null);

    const [dismissedErrorIds, setDismissedErrorIds] = useState(
        () => new Set(),
    );

    const [selectedErrorId, setSelectedErrorId] = useState(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop =
                scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const selectedError = messages.find(
        (message) =>
            message.error &&
            message.id === selectedErrorId,
    );

    const nextError = messages.find(
        (message) =>
            message.error &&
            !dismissedErrorIds.has(message.id),
    );

    const activeError = selectedError ?? nextError ?? null;

    function closeError() {
        if (!activeError) {
            return;
        }

        setDismissedErrorIds((previous) => {
            const next = new Set(previous);
            next.add(activeError.id);
            return next;
        });

        setSelectedErrorId(null);
    }

    function retryError(messageId) {
        if (loading || !onRetryFailedMessage) {
            return;
        }

        closeError();

        // Keep the existing hook responsible for retrying the request.
        onRetryFailedMessage(messageId);
    }

    return (
        <>
            <main
                id="chat"
                ref={scrollRef}
                className="relative flex-1 overflow-y-auto"
                onDragEnter={dragProps.onDragEnter}
                onDragOver={dragProps.onDragOver}
                onDragLeave={dragProps.onDragLeave}
                onDrop={dragProps.onDrop}
            >
                <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
                    {messages.length === 0 && (
                        <div
                            id="empty-state"
                            className="py-16 text-center text-slate-400 dark:text-slate-500"
                        >
                            <div className="mb-2 text-3xl">
                                {"\u{1F916}"}
                            </div>

                            <p className="text-sm">
                                Ask about your repo, request an edit,
                                paste an error, or attach a file to debug.
                            </p>
                        </div>
                    )}

                    {messages.map((message) =>
                        message.error ? (
                            <div
                                key={message.id}
                                className="flex flex-col gap-2"
                            >
                                <MessageBubble
                                    message={{
                                        ...message,
                                        text: "Request failed",
                                        retryable: false,
                                    }}
                                    loading={loading}
                                    onResolveConfirmation={onResolveConfirmation}
                                />

                                <div className="flex justify-start">
                                    <button
                                        type="button"
                                        onClick={() => setSelectedErrorId(message.id)}
                                        className="rounded px-2 py-1 text-xs font-medium text-blue-600 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400"
                                    >
                                        View error
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <MessageBubble
                                key={message.id}
                                message={message}
                                loading={loading}
                                onResolveConfirmation={onResolveConfirmation}
                                onRetryFailedMessage={onRetryFailedMessage}
                            />
                        ),
                    )}
                </div>

                <div
                    id="drop-overlay"
                    className={`${dragActive ? "flex" : "hidden"
                        } absolute inset-0 z-30 m-2 items-center justify-center rounded-lg border-2 border-dashed border-brand-500 bg-brand-600/10`}
                >
                    <p className="text-sm font-medium text-brand-700 dark:text-brand-300 sm:text-base">
                        Drop files to attach
                    </p>
                </div>
            </main>

            {activeError && (
                <ErrorModal
                    key={activeError.id}
                    message={activeError}
                    loading={loading}
                    onClose={closeError}
                    onRetry={
                        onRetryFailedMessage
                            ? retryError
                            : undefined
                    }
                />
            )}
        </>
    );
}
