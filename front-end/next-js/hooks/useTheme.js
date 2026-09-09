"use client";

import { useCallback, useEffect, useState } from "react";

const THEME_STORAGE_KEY = "coding-agent-theme";
const THEME_CHANGE_EVENT = "coding-agent-theme-change";

function getStoredTheme() {
    if (typeof window === "undefined") {
        return null;
    }

    try {
        const theme = window.localStorage.getItem(THEME_STORAGE_KEY);

        if (theme === "dark" || theme === "light") {
            return theme;
        }
    } catch {
        return null;
    }

    return null;
}

function getSystemTheme() {
    if (typeof window === "undefined") {
        return "light";
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
}

function resolveTheme() {
    return getStoredTheme() ?? getSystemTheme();
}

function applyTheme(theme) {
    if (typeof document === "undefined") {
        return;
    }

    const isDark = theme === "dark";

    document.documentElement.classList.toggle("dark", isDark);
    document.documentElement.style.colorScheme = theme;
}

export function useTheme() {
    const [theme, setThemeState] = useState("light");
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const initialTheme = resolveTheme();

        setThemeState(initialTheme);
        applyTheme(initialTheme);
        setReady(true);

        function handleThemeChange(event) {
            const nextTheme = event.detail?.theme;

            if (nextTheme !== "dark" && nextTheme !== "light") {
                return;
            }

            setThemeState(nextTheme);
            applyTheme(nextTheme);
        }

        function handleStorage(event) {
            if (event.key !== THEME_STORAGE_KEY) {
                return;
            }

            const nextTheme = event.newValue;

            if (nextTheme !== "dark" && nextTheme !== "light") {
                return;
            }

            setThemeState(nextTheme);
            applyTheme(nextTheme);
        }

        window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
        window.addEventListener("storage", handleStorage);

        return () => {
            window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
            window.removeEventListener("storage", handleStorage);
        };
    }, []);

    const setTheme = useCallback((nextTheme) => {
        const normalizedTheme = nextTheme === "dark" ? "dark" : "light";

        setThemeState(normalizedTheme);
        applyTheme(normalizedTheme);

        try {
            window.localStorage.setItem(THEME_STORAGE_KEY, normalizedTheme);
        } catch {
            // Theme still works during this browser session if localStorage is unavailable.
        }

        window.dispatchEvent(
            new CustomEvent(THEME_CHANGE_EVENT, {
                detail: {
                    theme: normalizedTheme,
                },
            }),
        );
    }, []);

    const toggleTheme = useCallback(() => {
        setTheme(theme === "dark" ? "light" : "dark");
    }, [setTheme, theme]);

    return {
        dark: theme === "dark",
        theme,
        ready,
        setTheme,
        toggleTheme,
    };
}
