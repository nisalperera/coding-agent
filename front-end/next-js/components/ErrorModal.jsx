"use client";

import { useEffect, useId, useRef } from "react";

export default function ErrorModal({
    message,
    loading = false,
    onClose,
    onRetry,
}) {
    const dialogRef = useRef(null);
    const closeButtonRef = useRef(null);
    const titleId = useId();
    const descriptionId = useId();

    useEffect(() => {
        const dialog = dialogRef.current;
        const previouslyFocused = document.activeElement;

        if (dialog && !dialog.open) {
            dialog.showModal();
            closeButtonRef.current?.focus();
        }

        return () => {
            if (dialog?.open) {
                dialog.close();
            }

            if (
                previouslyFocused instanceof HTMLElement &&
                previouslyFocused.isConnected
            ) {
                previouslyFocused.focus();
            }
        };
    }, []);

    const canRetry =
        message.retryable &&
        message.retryPayload &&
        typeof onRetry === "function";

    return (
        <dialog
            ref={dialogRef}
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            aria-modal="true"
            onCancel={(event) => {
                event.preventDefault();
                onClose();
            }}
            className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-black/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        >
            <div className="flex items-start gap-4 border-b border-slate-200 px-6 py-5 dark:border-slate-700">
                <span
                    aria-hidden="true"
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-xl font-bold text-red-700 dark:bg-red-950 dark:text-red-300"
                >
                    !
                </span>

                <div className="min-w-0">
                    <h2
                        id={titleId}
                        className="text-lg font-semibold"
                    >
                        Request failed
                    </h2>

                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        Your conversation remains available.
                    </p>
                </div>
            </div>

            <div className="px-6 py-5">
                <p
                    id={descriptionId}
                    className="whitespace-pre-wrap break-words text-sm leading-6"
                >
                    {message.text || "An unexpected error occurred."}
                </p>
            </div>

            <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 px-6 py-4 dark:border-slate-700">
                <button
                    ref={closeButtonRef}
                    type="button"
                    onClick={onClose}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-600 dark:hover:bg-slate-800"
                >
                    Close
                </button>

                {canRetry && (
                    <button
                        type="button"
                        disabled={loading}
                        onClick={() => onRetry(message.id)}
                        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {loading ? "Please wait..." : "Retry"}
                    </button>
                )}
            </div>
        </dialog>
    );
}
