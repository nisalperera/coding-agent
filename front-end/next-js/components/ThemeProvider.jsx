"use client";

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";

const ThemeContext = createContext(null);

function normalizeTheme(value) {
    return value === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
    document.documentElement.classList.toggle(
        "dark",
        theme === "dark",
    );
}

export function ThemeProvider({ children }) {
    const [theme, setThemeState] = useState("light");

    useEffect(() => {
        let savedTheme = "light";

        try {
            savedTheme = normalizeTheme(
                window.localStorage.getItem("theme"),
            );
        } catch {
            // Keep the default when browser storage is unavailable.
        }

        // eslint-disable-next-line react-hooks/set-state-in-effect -- Restore the browser-only theme after hydration.
        setThemeState(savedTheme);

        applyTheme(savedTheme);
    }, []);

    const setTheme = useCallback((nextTheme) => {
        const normalizedTheme = normalizeTheme(nextTheme);

        setThemeState(normalizedTheme);
        applyTheme(normalizedTheme);

        try {
            window.localStorage.setItem("theme", normalizedTheme);
        } catch {
            // Theme changes still work without persistent storage.
        }
    }, []);

    const toggleTheme = useCallback(() => {
        setTheme(theme === "dark" ? "light" : "dark");
    }, [setTheme, theme]);

    const value = useMemo(
        () => ({
            theme,
            dark: theme === "dark",
            setTheme,
            toggleTheme,
        }),
        [setTheme, theme, toggleTheme],
    );

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);

    if (!context) {
        throw new Error("useTheme must be used inside ThemeProvider");
    }

    return context;
}
