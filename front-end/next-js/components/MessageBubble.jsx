"use client";

import { useEffect, useRef } from "react";
import { marked } from "marked";
import hljs from "highlight.js";

function renderMarkdown(text) {
    return marked.parse(text ?? "");
}

function RetryButton({ loading, onRetry }) {
    return (
        <div
            role="alert"
            className="mt-3 flex flex-wrap items-center gap-3"
        >
            <button
                type="button"
                onClick={onRetry}
                disabled={loading}
                className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-900/80 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-950/50 dark:focus:ring-offset-slate-950"
            >
                <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M4 4v5h.58m15.07 2A8 8 0 0 0 5.64 6.16L4.58 9M20 20v-5h-.58M4.35 13A8 8 0 0 0 18.36 17.84L19.42 15"
                    />
                </svg>

                {loading ? "Retrying..." : "Retry"}
            </button>

            <span className="text-xs text-rose-700/80 dark:text-rose-300/80">
                The request did not complete.
            </span>
        </div>
    );
}

function AssistantBubble({
    text,
    error = false,
    retryable = false,
    loading = false,
    onRetry,
}) {
    const ref = useRef(null);

    useEffect(() => {
        if (!ref.current) {
            return;
        }

        ref.current.innerHTML = renderMarkdown(text);

        ref.current.querySelectorAll("pre code").forEach((block) => {
            hljs.highlightElement(block);
        });
    }, [text]);

    return (
        <div className="flex items-start gap-3 justify-start">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-brand-900 dark:text-brand-200">
                {"\u{1F916}"}
            </div>

            <div className="max-w-[85%] sm:max-w-[75%]">
                <div
                    ref={ref}
                    className={`prose-chat rounded-2xl rounded-tl-sm border px-4 py-2.5 text-sm prose prose-sm prose-p:my-1.5 prose-pre:my-2 dark:prose-invert sm:text-base ${error
                            ? "border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-900/80 dark:bg-rose-950/20 dark:text-rose-100"
                            : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
                        }`}
                />

                {error && retryable && typeof onRetry === "function" && (
                    <RetryButton loading={loading} onRetry={onRetry} />
                )}
            </div>
        </div>
    );
}

function UserBubble({ text, files }) {
    return (
        <div className="flex items-start gap-3 justify-end">
            <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-sm bg-brand-600 px-4 py-2.5 text-sm text-white sm:max-w-[75%] sm:text-base">
                {text}

                {files?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                        {files.map((file) => (
                            <span
                                key={file.name}
                                className="rounded-full bg-white/15 px-2 py-0.5 text-[11px]"
                            >
                                {"\u{1F4C4}"} {file.name}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function ProgressBubble({ text, percent }) {
    const label = `${text ?? "Working..."}${typeof percent === "number" ? ` (${percent}%)` : ""
        }`;

    return (
        <div className="flex items-start gap-3 justify-start">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-brand-900 dark:text-brand-200">
                {"\u23F3"}
            </div>

            <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                {label}
            </div>
        </div>
    );
}

function ConfirmationCard({ toolName, args, resolved, onResolve }) {
    return (
        <div className="flex items-start gap-3 justify-start">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-sm font-semibold text-amber-700 dark:bg-amber-900 dark:text-amber-200">
                {"\u26A0\uFE0F"}
            </div>

            <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-amber-300 bg-white px-4 py-3 text-sm dark:border-amber-700 dark:bg-slate-800 sm:max-w-[75%]">
                <p className="mb-1 font-medium">Approve {toolName}?</p>

                <pre className="mb-3 overflow-x-auto rounded-lg bg-slate-100 p-2 text-xs dark:bg-slate-900">
                    {JSON.stringify(args, null, 2)}
                </pre>

                <div className="flex gap-2">
                    <button
                        type="button"
                        disabled={resolved}
                        onClick={() => onResolve("approve")}
                        className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs text-white transition hover:bg-emerald-700 disabled:opacity-50"
                    >
                        Approve
                    </button>

                    <button
                        type="button"
                        disabled={resolved}
                        onClick={() => onResolve("deny")}
                        className="rounded-full bg-slate-200 px-3 py-1.5 text-xs transition hover:bg-slate-300 disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600"
                    >
                        Deny
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function MessageBubble({
    message,
    loading = false,
    onResolveConfirmation,
    onRetryFailedMessage,
}) {
    const wrapClass = "msg-enter";

    switch (message.role) {
        case "user":
            return (
                <div className={wrapClass}>
                    <UserBubble text={message.text} files={message.files} />
                </div>
            );

        case "progress":
            return (
                <div className={wrapClass}>
                    <ProgressBubble text={message.text} percent={message.percent} />
                </div>
            );

        case "confirmation":
            return (
                <div className={wrapClass}>
                    <ConfirmationCard
                        toolName={message.toolName}
                        args={message.args}
                        resolved={message.resolved}
                        onResolve={(decision) =>
                            onResolveConfirmation(message.id, message.actionId, decision)
                        }
                    />
                </div>
            );

        case "assistant":
        default:
            return (
                <div className={wrapClass}>
                    <AssistantBubble
                        text={message.text}
                        error={message.error}
                        retryable={message.retryable}
                        loading={loading}
                        onRetry={() => onRetryFailedMessage?.(message.id)}
                    />
                </div>
            );
    }
}
