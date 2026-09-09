// components/ThemeProvider.jsx
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

export function ThemeProvider({ children }) {
    const [theme, setThemeState] = useState("light");

    useEffect(() => {
        const savedTheme =
            window.localStorage.getItem("theme") === "dark"
                ? "dark"
                : "light";

        setThemeState(savedTheme);
        document.documentElement.classList.toggle("dark", savedTheme === "dark");
    }, []);

    const setTheme = useCallback((nextTheme) => {
        setThemeState(nextTheme);
        window.localStorage.setItem("theme", nextTheme);
        document.documentElement.classList.toggle("dark", nextTheme === "dark");
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