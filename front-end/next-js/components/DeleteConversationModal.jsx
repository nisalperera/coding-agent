// front-end/local/components/DeleteConversationModal.jsx
"use client";

import { useEffect, useRef } from "react";

export default function DeleteConversationModal({
    open,
    conversation,
    deleting,
    error,
    onClose,
    onConfirm,
}) {
    const cancelButtonRef = useRef(null);

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        const handleKeyDown = (event) => {
            if (event.key === "Escape" && !deleting) {
                onClose();
            }
        };

        document.addEventListener("keydown", handleKeyDown);

        const timeoutId = window.setTimeout(() => {
            cancelButtonRef.current?.focus();
        }, 0);

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            window.clearTimeout(timeoutId);
        };
    }, [deleting, onClose, open]);

    if (!open || !conversation) {
        return null;
    }

    const title = conversation.title || "New conversation";

    return (
        <div
            className="fixed inset-0 z-[70] flex items-center justify-center p-4"
            role="presentation"
        >
            <button
                type="button"
                aria-label="Close delete conversation dialog"
                disabled={deleting}
                onClick={onClose}
                className="absolute inset-0 cursor-default bg-slate-950/60 backdrop-blur-sm disabled:cursor-not-allowed"
            />

            <section
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="delete-conversation-title"
                aria-describedby="delete-conversation-description"
                className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            >
                <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300">
                        <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="h-5 w-5"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m-8 0 .8 13.2A2 2 0 0 0 9.8 22h4.4a2 2 0 0 0 2-1.8L17 7"
                            />
                        </svg>
                    </div>

                    <div className="min-w-0 flex-1">
                        <h2
                            id="delete-conversation-title"
                            className="text-base font-semibold text-slate-900 dark:text-slate-100"
                        >
                            Delete conversation?
                        </h2>

                        <p
                            id="delete-conversation-description"
                            className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300"
                        >
                            <span className="font-medium text-slate-900 dark:text-slate-100">
                                {title}
                            </span>{" "}
                            will be removed from your conversation history.
                        </p>

                    </div>
                </div>

                {error && (
                    <div
                        role="alert"
                        className="mt-5 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200"
                    >
                        <svg
                            aria-hidden="true"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="mt-0.5 h-4 w-4 shrink-0"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 9v4m0 4h.01M10.3 3.9 2.5 17.4A2 2 0 0 0 4.23 20.5h15.54a2 2 0 0 0 1.73-3.1L13.7 3.9a2 2 0 0 0-3.4 0Z"
                            />
                        </svg>

                        <p>{error}</p>
                    </div>
                )}

                <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button
                        ref={cancelButtonRef}
                        type="button"
                        disabled={deleting}
                        onClick={onClose}
                        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                        Cancel
                    </button>

                    <button
                        type="button"
                        disabled={deleting}
                        onClick={onConfirm}
                        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {deleting ? "Deleting..." : "Delete conversation"}
                    </button>
                </div>
            </section>
        </div>
    );
}
