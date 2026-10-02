import './globals.css';
import 'highlight.js/styles/github-dark.css';
import { ThemeProvider } from '../components/ThemeProvider';

export const metadata = {
    title: "Nisal's Coding Agent",
    description: 'Agentic coding assistant with repo-aware tools and RAG-backed answers.',
    icons: { icon: '/favicon.ico' },
};

export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body className="h-screen overflow-hidden flex flex-col bg-slate-100 text-slate-800 transition-colors dark:bg-slate-950 dark:text-slate-100">
                <ThemeProvider>
                    {children}
                </ThemeProvider>
            </body>
        </html>
    );
}
