"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useTheme } from '../../components/ThemeProvider';

export default function LoginPage() {
    const router = useRouter();
    const { loginWithGoogle, loginWithPassword } = useAuth();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const { dark, toggleTheme } = useTheme();

    async function handleSubmit(event) {
        event.preventDefault();
        setError("");
        setSubmitting(true);

        try {
            await loginWithPassword({
                email,
                password,
            });

            router.replace("/");
        } catch (loginError) {
            setError(loginError.message || "Unable to sign in");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <main className="mx-auto flex min-h-screen max-w-md items-center px-4 py-10">
            <section className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8">
                <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
                    Nisal&apos;s Coding Agent
                </p>

                <button
                    type="button"
                    onClick={toggleTheme}
                    className="absolute left-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                    aria-label="Toggle theme"
                    title="Toggle theme"
                >
                    <span aria-hidden="true">{dark ? "☀️" : "🌙"}</span>
                </button>

                <h1 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-slate-50">
                    Sign in
                </h1>

                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                    Sign in with your email and password, or continue with Google.
                </p>

                <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                    <label className="block">
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                            Email address
                        </span>

                        <input
                            type="email"
                            autoComplete="email"
                            required
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
                        />
                    </label>

                    <label className="block">
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                            Password
                        </span>

                        <input
                            type="password"
                            autoComplete="current-password"
                            required
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
                        />
                    </label>

                    {error && (
                        <p
                            role="alert"
                            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300"
                        >
                            {error}
                        </p>
                    )}

                    <button
                        type="submit"
                        disabled={submitting}
                        className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                    >
                        {submitting ? "Signing in..." : "Sign in"}
                    </button>
                </form>

                <div className="my-6 flex items-center gap-3">
                    <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                        OR
                    </span>
                    <div className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                </div>

                <button
                    type="button"
                    onClick={loginWithGoogle}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        className="h-4 w-4 shrink-0"
                        aria-hidden="true"
                    >
                        <path
                            fill="#4285F4"
                            d="M21.35 12.27c0-.79-.07-1.55-.21-2.27H12v4.3h5.23a4.47 4.47 0 0 1-1.94 2.93v2.79h3.14c1.84-1.69 2.92-4.19 2.92-7.75Z"
                        />
                        <path
                            fill="#34A853"
                            d="M12 21.75c2.62 0 4.82-.87 6.43-2.36l-3.14-2.79c-.87.59-1.99.94-3.29.94-2.53 0-4.68-1.71-5.45-4.01H3.31v2.88A9.72 9.72 0 0 0 12 21.75Z"
                        />
                        <path
                            fill="#FBBC05"
                            d="M6.55 13.53A5.84 5.84 0 0 1 6.24 12c0-.53.09-1.04.31-1.53V7.59H3.31A9.76 9.76 0 0 0 2.25 12c0 1.57.38 3.05 1.06 4.41l3.24-2.88Z"
                        />
                        <path
                            fill="#EA4335"
                            d="M12 6.46c1.43 0 2.71.49 3.72 1.46l2.79-2.79C16.81 3.53 14.61 2.25 12 2.25a9.72 9.72 0 0 0-8.69 5.34l3.24 2.88c.77-2.3 2.92-4.01 5.45-4.01Z"
                        />
                    </svg>

                    <span>Continue with Google</span>
                </button>

                <p className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
                    Don&apos;t have an account?{" "}
                    <Link
                        href="/register"
                        className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                    >
                        Create one
                    </Link>
                </p>
            </section>
        </main>
    );
}
