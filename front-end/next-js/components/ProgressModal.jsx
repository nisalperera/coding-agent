"use client";

import { useEffect, useRef } from "react";

function clampPercent(value) {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
        return null;
    }

    return Math.max(0, Math.min(100, Math.round(numericValue)));
}

export default function ProgressModal({
    open,
    message = "Working...",
    percent,
}) {
    const titleRef = useRef(null);
    const normalizedPercent = clampPercent(percent);
    const isDeterminate = normalizedPercent !== null;

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        titleRef.current?.focus();

        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [open]);

    if (!open) {
        return null;
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-4 backdrop-blur-sm"
            role="presentation"
        >
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="agent-progress-title"
                aria-describedby="agent-progress-description"
                className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            >
                <div className="flex items-start gap-3">
                    <div
                        aria-hidden="true"
                        className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
                    >
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="h-5 w-5 animate-spin"
                        >
                            <path
                                strokeLinecap="round"
                                d="M12 2a10 10 0 1 1-7.07 2.93"
                            />
                        </svg>
                    </div>

                    <div className="min-w-0 flex-1">
                        <h2
                            id="agent-progress-title"
                            ref={titleRef}
                            tabIndex={-1}
                            className="text-base font-semibold text-slate-950 outline-none dark:text-slate-50"
                        >
                            Agent is working
                        </h2>

                        <p
                            id="agent-progress-description"
                            aria-live="polite"
                            aria-atomic="true"
                            className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-300"
                        >
                            {message || "Processing your request..."}
                        </p>
                    </div>
                </div>

                <div className="mt-5">
                    <div
                        role="progressbar"
                        aria-label="Agent task progress"
                        aria-valuemin={isDeterminate ? 0 : undefined}
                        aria-valuemax={isDeterminate ? 100 : undefined}
                        aria-valuenow={isDeterminate ? normalizedPercent : undefined}
                        aria-valuetext={
                            isDeterminate
                                ? `${normalizedPercent}% complete`
                                : "Progress is being calculated"
                        }
                        className="h-2.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
                    >
                        {isDeterminate ? (
                            <div
                                className="h-full rounded-full bg-indigo-600 transition-[width] duration-300 ease-out dark:bg-indigo-400"
                                style={{ width: `${normalizedPercent}%` }}
                            />
                        ) : (
                            <div className="h-full w-2/5 animate-pulse rounded-full bg-indigo-600 dark:bg-indigo-400" />
                        )}
                    </div>

                    <div className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span>
                            {isDeterminate
                                ? "Please wait while the agent completes this step."
                                : "Preparing the task..."}
                        </span>

                        {isDeterminate && (
                            <span className="font-medium tabular-nums">
                                {normalizedPercent}%
                            </span>
                        )}
                    </div>
                </div>
            </section>
        </div>
    );
}
