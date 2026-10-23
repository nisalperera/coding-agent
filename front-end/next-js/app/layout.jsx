import './globals.css';
import AuthSessionNotice from '../components/AuthSessionNotice';
import 'highlight.js/styles/github-dark.css';
import { ThemeProvider } from '../components/ThemeProvider';

// @next-codemod-ignore Cache Components adoption: this segment temporarily allows blocking.
// Remove this opt-out after verifying the segment passes validation without it.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
// export const instant = false;

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
                    <AuthSessionNotice />
                    {children}
                </ThemeProvider>
            </body>
        </html>
    );
}
