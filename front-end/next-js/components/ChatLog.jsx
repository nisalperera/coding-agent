"use client";

import { useEffect, useRef } from "react";
import MessageBubble from "./MessageBubble";

export default function ChatLog({
    messages,
    loading,
    onResolveConfirmation,
    onRetryFailedMessage,
    dragProps,
    dragActive,
}) {
    const scrollRef = useRef(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    return (
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
                        <div className="mb-2 text-3xl">{"\u{1F916}"}</div>
                        <p className="text-sm">
                            Ask about your repo, request an edit, paste an error, or attach a
                            file to debug.
                        </p>
                    </div>
                )}

                {messages.map((message) => (
                    <MessageBubble
                        key={message.id}
                        message={message}
                        loading={loading}
                        onResolveConfirmation={onResolveConfirmation}
                        onRetryFailedMessage={onRetryFailedMessage}
                    />
                ))}
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
    );
}
