"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
import UserAvatar from "../../components/UserAvatar";

export default function ProfilePage() {
    const router = useRouter();
    const { signedIn, user, loginWithGoogle, logout } = useAuth();

    const name = user?.name ?? "Signed in user";
    const email = user?.email ?? "";
    const image = user?.image ?? user?.picture ?? null;

    async function handleLogout() {
        await logout();
        router.replace("/");
    }

    if (!signedIn) {
        return (
            <main className="mx-auto flex min-h-[calc(100vh-73px)] max-w-3xl items-center px-4 py-10">
                <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8">
                    <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                        Account
                    </p>

                    <h1 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-50">
                        Sign in to view your profile
                    </h1>

                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                        Your profile uses the account details supplied by your Google login.
                    </p>

                    <div className="mt-6 flex flex-wrap gap-3">
                        <button
                            type="button"
                            onClick={loginWithGoogle}
                            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                        >
                            Sign in with Google
                        </button>

                        <Link
                            href="/"
                            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                            Back to chat
                        </Link>
                    </div>
                </section>
            </main>
        );
    }

    return (
        <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
            <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                    <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                        Account
                    </p>

                    <h1 className="mt-1 text-2xl font-semibold text-slate-950 dark:text-slate-50">
                        Profile
                    </h1>
                </div>

                <Link
                    href="/"
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                    Back to chat
                </Link>
            </div>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="bg-gradient-to-r from-blue-600/10 via-violet-600/10 to-transparent px-6 py-7 dark:from-blue-500/15 dark:via-violet-500/15 sm:px-8">
                    <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                        <UserAvatar
                            user={{ name, email, image }}
                            size="lg"
                            className="ring-4 ring-white dark:ring-slate-900"
                        />

                        <div className="min-w-0">
                            <h2 className="truncate text-xl font-semibold text-slate-950 dark:text-slate-50">
                                {name}
                            </h2>

                            {email && (
                                <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-400">
                                    {email}
                                </p>
                            )}

                            <p className="mt-3 inline-flex rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                                Signed in with Google
                            </p>
                        </div>
                    </div>
                </div>

                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    <div className="grid gap-1 px-6 py-5 sm:grid-cols-[10rem_1fr] sm:gap-4 sm:px-8">
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                            Display name
                        </p>

                        <p className="break-words text-sm text-slate-900 dark:text-slate-100">
                            {name}
                        </p>
                    </div>

                    <div className="grid gap-1 px-6 py-5 sm:grid-cols-[10rem_1fr] sm:gap-4 sm:px-8">
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                            Email address
                        </p>

                        <p className="break-words text-sm text-slate-900 dark:text-slate-100">
                            {email || "Not available"}
                        </p>
                    </div>

                    <div className="grid gap-1 px-6 py-5 sm:grid-cols-[10rem_1fr] sm:gap-4 sm:px-8">
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                            Profile image
                        </p>

                        <p className="break-all text-sm text-slate-900 dark:text-slate-100">
                            {image ? "Provided by your Google account" : "Using initials fallback"}
                        </p>
                    </div>
                </div>

                <div className="flex flex-col gap-3 border-t border-slate-200 px-6 py-5 dark:border-slate-800 sm:flex-row sm:justify-between sm:px-8">
                    <Link
                        href="/settings"
                        className="rounded-lg border border-slate-300 px-4 py-2 text-center text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                        Open settings
                    </Link>

                    <button
                        type="button"
                        onClick={handleLogout}
                        className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 dark:border-red-900/70 dark:text-red-400 dark:hover:bg-red-950/30"
                    >
                        Logout
                    </button>
                </div>
            </section>
        </main>
    );
}
