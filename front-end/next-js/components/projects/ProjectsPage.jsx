'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createProject, listProjects } from '../../lib/projects';
import { technologyLabels, PROJECT_TYPES } from '../../lib/project-domain.mjs';
import { ProjectError } from './ProjectShell';
import ProjectDialog from './ProjectDialog';
import ProjectForm from './ProjectForm';
export default function ProjectsPage() {
  const router = useRouter(); const params = useSearchParams();
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState(null);
  const state = result?.version === version
    ? { ...result, loading: false }
    : { loading: true, error: null, projects: [] };
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [query, setQuery] = useState(''); const dirty = useRef(false);
  const notice = params.get('notice') === 'soft-deleted'
    ? 'Project soft-deleted. It was removed from active projects; its data was not permanently erased.'
    : '';
  function dismissNotice() {
    const next = new URLSearchParams(params.toString());
    next.delete('notice');
    const queryString = next.toString();
    router.replace(queryString ? `/projects?${queryString}` : '/projects', { scroll: false });
  }
  useEffect(() => {
    const controller = new AbortController();
    listProjects(controller.signal).then(projects => { if (!controller.signal.aborted) setResult({ version, projects, error: null }); }).catch(error => { if (!controller.signal.aborted) setResult({ version, projects: [], error }); });
    return () => controller.abort();
  }, [version]);
  function close() { if (!busy && (!dirty.current || window.confirm('Discard your unsaved project changes?'))) { setOpen(false); dirty.current = false; } }
  async function create(payload) {
    if (busy) return; setBusy(true); setError('');
    try { const project = await createProject(payload); dirty.current = false; setOpen(false); router.push(`/projects/${encodeURIComponent(project.id)}`); }
    catch (error) { setError(`${error.message} If the outcome is uncertain, close this dialog and refresh the list before retrying.`); }
    finally { setBusy(false); }
  }
  const visible = state.projects.filter(item => `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Projects</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Private workspaces for your technology stack.</p></div><button type="button" disabled={state.loading || Boolean(state.error)} onClick={() => { setError(''); dirty.current = false; setOpen(true); }} className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50">Create project</button></div>
    {notice && <div role="status" className="mb-5 rounded-lg border border-emerald-400 p-4"><p>{notice}</p><button onClick={dismissNotice} type="button" className="mt-2 underline">Dismiss</button></div>}
    {state.loading ? <p role="status">Loading projects...</p> : state.error ? <ProjectError collection error={state.error} onRetry={() => setVersion(value => value + 1)} /> : <>
      <label htmlFor="project-search" className="text-sm font-medium">Search projects</label><input id="project-search" type="search" value={query} onChange={event => setQuery(event.target.value)} className="mb-6 mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900" />
      {visible.length === 0 ? <section className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700"><h2 className="font-semibold">{state.projects.length ? 'No matching projects' : 'No projects yet'}</h2><p className="mt-2 text-sm">{state.projects.length ? 'Try another search.' : 'Create your first private project to configure its stack.'}</p></section> : <div className="grid gap-4 sm:grid-cols-2">{visible.map(project => <article key={project.id} className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><h2 className="break-words text-lg font-semibold"><Link className="hover:underline" href={`/projects/${encodeURIComponent(project.id)}`}>{project.name}</Link></h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{PROJECT_TYPES.find(item => item.value === project.project_type)?.label}</p><p className="mt-3 whitespace-pre-wrap break-words text-sm">{project.description || 'No description.'}</p><p className="mt-3 text-sm">{technologyLabels(project).join(', ') || 'No technologies selected'}</p><div className="mt-5 flex gap-4 text-sm text-blue-600 dark:text-blue-300"><Link href={`/projects/${encodeURIComponent(project.id)}`}>Open project</Link><Link href={`/projects/${encodeURIComponent(project.id)}/settings`}>Settings</Link></div></article>)}</div>}
    </>}
    {open && <ProjectDialog title="Create project" busy={busy} onClose={close}><ProjectForm onSubmit={create} onCancel={() => { dirty.current = false; setOpen(false); }} busy={busy} error={error} onDirtyChange={value => { dirty.current = value; }} submitLabel="Create project" /></ProjectDialog>}
  </>;
}
