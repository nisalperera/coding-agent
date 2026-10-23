'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import VerifiedIdentityBoundary from '../VerifiedIdentityBoundary';
import { useTheme } from '../ThemeProvider';
export default function ProjectShell({ children }) {
  const pathname = usePathname();
  const { dark, toggleTheme } = useTheme();
  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
      <nav aria-label="Application" className="flex flex-wrap gap-5 text-sm font-medium">
        <Link className="hover:underline focus-visible:outline-blue-500" href="/">Chat</Link>
        <Link className="hover:underline" href="/projects">Projects</Link>
        <Link className="hover:underline" href="/settings">Account settings</Link>
      </nav>
      <button type="button" onClick={toggleTheme} className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700">{dark ? 'Light theme' : 'Dark theme'}</button>
    </header>
    <main id="project-main" className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-8">
      <div className="mx-auto w-full max-w-5xl">
        <VerifiedIdentityBoundary key={pathname}>{children}</VerifiedIdentityBoundary>
      </div>
    </main>
  </div>;
}
export function ProjectError({ error, onRetry, collection = false }) {
  const status = error?.status;
  const unavailable = [0, 404, 405, 501, 502, 503, 504].includes(status);
  const title = status === 401 ? 'Your session has expired' : status === 403 ? 'Project access denied' :
    !collection && [404, 410].includes(status) ? 'Project unavailable' : unavailable ? 'Project service unavailable' : 'Unable to load projects';
  return <section role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
    <h2 className="font-semibold">{title}</h2>
    <p className="mt-2 break-words text-sm">{collection && [404, 405, 501].includes(status) ? 'This frontend requires project API support. No project data has been simulated or saved locally.' : error?.message || 'Please try again.'}</p>
    <div className="mt-4 flex gap-4">{status === 401 ? <Link href="/login" className="underline">Sign in</Link> : <button type="button" onClick={onRetry} className="underline">Retry</button>}<Link href="/projects" className="underline">Projects</Link></div>
  </section>;
}
