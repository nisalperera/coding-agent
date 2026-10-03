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
            <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 5v14m-7-7h14"
            />
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

function TrashIcon() {
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
                d="M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m-8 0 .8 13.2A2 2 0 0 0 9.8 22h4.4a2 2 0 0 0 2-1.8L17 7"
            />
        </svg>
    );
}

function ConversationButton({
    conversation,
    active,
    sidebarCollapsed,
    loading,
    onSelectConversation,
    onDeleteConversation,
}) {
    const title = conversation.title || "New conversation";

    const handleDelete = (event) => {
        event.preventDefault();
        event.stopPropagation();
        onDeleteConversation(conversation);
    };

    return (
        <div
            className={`group flex w-full min-w-0 items-center rounded-lg text-sm transition ${active
                    ? "bg-brand-100 text-slate-900 dark:bg-indigo-200 dark:text-slate-950"
                    : "text-slate-700 hover:bg-slate-200/80 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
        >
            <button
                type="button"
                title={sidebarCollapsed ? title : undefined}
                disabled={loading}
                onClick={() => onSelectConversation(conversation.id)}
                className={`flex min-w-0 flex-1 items-center text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${sidebarCollapsed
                        ? "h-10 justify-center px-2"
                        : "gap-2 px-2.5 py-2"
                    }`}
            >
                <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    className={`h-4 w-4 shrink-0 ${active
                            ? "text-slate-600 dark:text-slate-700"
                            : "text-slate-500 dark:text-slate-400"
                        }`}
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M7 8h10M7 12h7m-7 4h5M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"
                    />
                </svg>

                {!sidebarCollapsed && (
                    <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                            {title}
                        </span>

                        <span
                            className={`mt-0.5 block truncate text-xs ${active
                                    ? "text-slate-600 dark:text-slate-700"
                                    : "text-slate-500 dark:text-slate-400"
                                }`}
                        >
                            {formatConversationDate(
                                conversation.updatedAt ??
                                conversation.createdAt,
                            )}
                        </span>
                    </span>
                )}
            </button>

            {!sidebarCollapsed && (
                <button
                    type="button"
                    aria-label={`Delete conversation: ${title}`}
                    title="Delete conversation"
                    disabled={loading}
                    onClick={handleDelete}
                    className={`mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-40 ${active
                            ? "text-slate-700 hover:bg-slate-950/10 hover:text-red-700 dark:text-slate-700 dark:hover:bg-slate-950/20 dark:hover:text-red-800"
                            : "text-slate-400 opacity-0 hover:bg-red-100 hover:text-red-700 group-hover:opacity-100 group-focus-within:opacity-100 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                        }`}
                >
                    <TrashIcon />
                </button>
            )}
        </div>
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
    onDeleteConversation,
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
                    aria-label={
                        collapsed ? "Expand sidebar" : "Collapse sidebar"
                    }
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
                {Object.entries(groups).map(
                    ([groupName, groupConversations]) => {
                        if (groupConversations.length === 0) {
                            return null;
                        }

                        return (
                            <section
                                key={groupName}
                                className="mb-4 last:mb-0"
                            >
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
                                                conversation.id ===
                                                activeConversationId
                                            }
                                            sidebarCollapsed={collapsed}
                                            loading={loading}
                                            onSelectConversation={
                                                onSelectConversation
                                            }
                                            onDeleteConversation={
                                                onDeleteConversation
                                            }
                                        />
                                    ))}
                                </div>
                            </section>
                        );
                    },
                )}
            </nav>

            <div className="shrink-0 border-t border-slate-200 p-2 dark:border-slate-800">
                <button
                    type="button"
                    onClick={onToggleCollapsed}
                    className={`hidden w-full items-center rounded-lg px-2.5 py-2 text-sm text-slate-600 transition hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-slate-800 md:flex ${collapsed ? "justify-center" : "gap-2"
                        }`}
                    aria-label={
                        collapsed ? "Expand sidebar" : "Collapse sidebar"
                    }
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
