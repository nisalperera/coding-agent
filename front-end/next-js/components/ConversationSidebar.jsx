// front-end/local/components/ConversationSidebar.jsx
"use client";

import { useEffect, useMemo } from "react";

function formatConversationDate(timestamp) {
    if (!timestamp) {
        return "New chat";
    }

    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
    }).format(new Date(timestamp));
}

function startOfDay(value) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

function getGroupName(timestamp, now) {
    const todayStart = startOfDay(now);
    const messageDay = startOfDay(timestamp);
    const dayDifference = Math.floor(
        (todayStart - messageDay) / (24 * 60 * 60 * 1000),
    );

    if (dayDifference <= 0) {
        return "Today";
    }

    if (dayDifference === 1) {
        return "Yesterday";
    }

    if (dayDifference <= 7) {
        return "Previous 7 days";
    }

    return "Older";
}

function groupConversations(conversations) {
    const now = Date.now();

    return conversations.reduce(
        (groups, conversation) => {
            const groupName = getGroupName(
                conversation.updatedAt ?? conversation.createdAt,
                now,
            );

            groups[groupName].push(conversation);
            return groups;
        },
        {
            Today: [],
            Yesterday: [],
            "Previous 7 days": [],
            Older: [],
        },
    );
}

function MenuIcon() {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-5 w-5"
        >
            <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
    );
}

function PlusIcon() {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-5 w-5"
        >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m-7-7h14" />
        </svg>
    );
}

function CollapseIcon({ collapsed }) {
    return (
        <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-4 w-4"
        >
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d={collapsed ? "m9 18 6-6-6-6" : "m15 18-6-6 6-6"}
            />
        </svg>
    );
}

function ConversationButton({
    conversation,
    active,
    sidebarCollapsed,
    onSelectConversation,
}) {
    const title = conversation.title || "New conversation";

    return (
        <button
            type="button"
            title={sidebarCollapsed ? title : undefined}
            onClick={() => onSelectConversation(conversation.id)}
            className={`group flex w-full min-w-0 items-center rounded-lg text-left text-sm transition ${sidebarCollapsed
                ? "h-10 justify-center px-2"
                : "gap-2 px-2.5 py-2"
                } ${active
                    ? "bg-brand-100 text-slate-900 dark:bg-indigo-200 dark:text-slate-950"
                    : "text-slate-700 hover:bg-slate-200/80 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
        >
            <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                className="h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M7 8h10M7 12h7m-7 4h5M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
                />
            </svg>

            {!sidebarCollapsed && (
                <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{title}</span>
                    <span
                        className={`mt-0.5 block truncate text-xs ${active
                                ? "text-slate-600 dark:text-slate-700"
                                : "text-slate-500 dark:text-slate-400"
                            }`}
                    >
                        {formatConversationDate(
                            conversation.updatedAt ?? conversation.createdAt,
                        )}
                    </span>
                </span>
            )}
        </button>
    );
}

export default function ConversationSidebar({
    conversations,
    activeConversationId,
    collapsed,
    mobileOpen,
    loading,
    onNewConversation,
    onSelectConversation,
    onToggleCollapsed,
    onCloseMobile,
}) {
    const groups = useMemo(
        () => groupConversations(conversations),
        [conversations],
    );

    useEffect(() => {
        if (!mobileOpen) {
            return undefined;
        }

        const handleEscape = (event) => {
            if (event.key === "Escape") {
                onCloseMobile();
            }
        };

        document.addEventListener("keydown", handleEscape);

        return () => {
            document.removeEventListener("keydown", handleEscape);
        };
    }, [mobileOpen, onCloseMobile]);

    const sidebarContent = (
        <>
            <div
                className={`flex shrink-0 items-center gap-2 border-b border-slate-200 p-3 dark:border-slate-800 ${collapsed ? "justify-center" : "justify-between"
                    }`}
            >
                {!collapsed && (
                    <button
                        type="button"
                        onClick={onNewConversation}
                        disabled={loading}
                        className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <PlusIcon />
                        <span>New chat</span>
                    </button>
                )}

                {collapsed && (
                    <button
                        type="button"
                        aria-label="Start a new chat"
                        title="New chat"
                        onClick={onNewConversation}
                        disabled={loading}
                        className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <PlusIcon />
                    </button>
                )}

                <button
                    type="button"
                    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    onClick={onToggleCollapsed}
                    className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800 md:flex"
                >
                    <CollapseIcon collapsed={collapsed} />
                </button>

                <button
                    type="button"
                    aria-label="Close conversation menu"
                    onClick={onCloseMobile}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-600 transition hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800 md:hidden"
                >
                    <span aria-hidden="true" className="text-xl leading-none">
                        ×
                    </span>
                </button>
            </div>

            <nav
                aria-label="Conversation history"
                className="min-h-0 flex-1 overflow-y-auto p-2"
            >
                {Object.entries(groups).map(([groupName, groupConversations]) => {
                    if (groupConversations.length === 0) {
                        return null;
                    }

                    return (
                        <section key={groupName} className="mb-4 last:mb-0">
                            {!collapsed && (
                                <h2 className="px-2.5 pb-1.5 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    {groupName}
                                </h2>
                            )}

                            <div className="space-y-1">
                                {groupConversations.map((conversation) => (
                                    <ConversationButton
                                        key={conversation.id}
                                        conversation={conversation}
                                        active={
                                            conversation.id === activeConversationId
                                        }
                                        sidebarCollapsed={collapsed}
                                        onSelectConversation={onSelectConversation}
                                    />
                                ))}
                            </div>
                        </section>
                    );
                })}
            </nav>

            <div className="shrink-0 border-t border-slate-200 p-2 dark:border-slate-800">
                <button
                    type="button"
                    onClick={onToggleCollapsed}
                    className={`hidden w-full items-center rounded-lg px-2.5 py-2 text-sm text-slate-600 transition hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800 md:flex ${collapsed ? "justify-center" : "gap-2"
                        }`}
                    aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                    title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                    <MenuIcon />
                    {!collapsed && <span>Collapse sidebar</span>}
                </button>
            </div>
        </>
    );

    return (
        <>
            <aside
                aria-label="Conversation sidebar"
                className={`hidden shrink-0 border-r border-slate-200 bg-slate-50 transition-[width] duration-200 dark:border-slate-800 dark:bg-slate-950 md:flex md:flex-col ${collapsed ? "w-16" : "w-72"
                    }`}
            >
                {sidebarContent}
            </aside>

            {mobileOpen && (
                <div className="fixed inset-0 z-50 md:hidden">
                    <button
                        type="button"
                        aria-label="Close conversation menu"
                        onClick={onCloseMobile}
                        className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm"
                    />

                    <aside
                        aria-label="Conversation sidebar"
                        className="relative flex h-full w-[min(18rem,calc(100vw-3rem))] flex-col border-r border-slate-200 bg-slate-50 shadow-2xl dark:border-slate-800 dark:bg-slate-950"
                    >
                        {sidebarContent}
                    </aside>
                </div>
            )}
        </>
    );
}
