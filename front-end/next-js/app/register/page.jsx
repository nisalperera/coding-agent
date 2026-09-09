"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTheme } from "../../hooks/useTheme";
import { useAuth } from "../../hooks/useAuth";

export default function RegisterPage() {
    const router = useRouter();
    const { registerWithPassword, loginWithGoogle } = useAuth();

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const { dark, toggleTheme } = useTheme();

    async function handleSubmit(event) {
        event.preventDefault();
        setError("");

        if (password !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }

        if (password.length < 12) {
            setError("Use a password with at least 12 characters.");
            return;
        }

        setSubmitting(true);

        try {
            await registerWithPassword({
                name,
                email,
                password,
            });

            router.replace("/");
        } catch (registerError) {
            setError(registerError.message || "Unable to create account");
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
                    Create account
                </h1>

                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                    Your username is generated automatically from your email address.
                </p>

                <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                    <label className="block">
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                            Display name
                        </span>

                        <input
                            type="text"
                            autoComplete="name"
                            minLength="1"
                            maxLength="255"
                            required
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
                        />
                    </label>

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
                            autoComplete="new-password"
                            minLength="12"
                            required
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
                        />

                        <span className="mt-1.5 block text-xs text-slate-500 dark:text-slate-400">
                            At least 12 characters.
                        </span>
                    </label>

                    <label className="block">
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                            Confirm password
                        </span>

                        <input
                            type="password"
                            autoComplete="new-password"
                            minLength="12"
                            required
                            value={confirmPassword}
                            onChange={(event) => setConfirmPassword(event.target.value)}
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
                        {submitting ? "Creating account..." : "Create account"}
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
                    className="w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                    Continue with Google
                </button>

                <p className="mt-6 text-center text-sm text-slate-600 dark:text-slate-400">
                    Already have an account?{" "}
                    <Link
                        href="/login"
                        className="font-medium text-blue-600 hover:underline dark:text-blue-400"
                    >
                        Sign in
                    </Link>
                </p>
            </section>
        </main>
    );
}