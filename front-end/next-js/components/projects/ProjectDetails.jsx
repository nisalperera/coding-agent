'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { useProject } from '../../hooks/useProject';
import { softDeleteProject, updateProject } from '../../lib/projects';
import { PROJECT_TYPES, technologyLabels } from '../../lib/project-domain.mjs';
import { ProjectError } from './ProjectShell';
import ProjectDialog from './ProjectDialog';
import ProjectForm from './ProjectForm';
import { useIdentityLease } from '../VerifiedIdentityBoundary';
export default function ProjectDetails({ projectId, settings = false }) {
  const scope = useIdentityLease();
  const mutationRef = useRef(false);
  const { project, loading, error, reload, replace } = useProject(projectId);
  const router = useRouter();
  const [busy, setBusy] = useState(false); const [mutationError, setMutationError] = useState('');
  const [conflict, setConflict] = useState(false); const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState(false); const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(''); const [confirmation, setConfirmation] = useState('');
  const dirty = useRef(false);
  async function save(payload) {
    if (!scope.isCurrent() || mutationRef.current || conflict || !project) return;
    const operation = scope.begin(); mutationRef.current = true;
    setBusy(true); setMutationError(''); setNotice('');
    try { const saved = await updateProject(project.id, project.revision, payload, operation.signal); if (!operation.isCurrent()) return; replace(saved); dirty.current = false; setNotice('Project settings saved.'); }
    catch (error) { if (!operation.isCurrent()) return; setConflict([409, 412].includes(error.status)); setMutationError(error.message); }
    finally { if (operation.isCurrent()) { mutationRef.current = false; setBusy(false); } operation.close(); }
  }
  function refreshAfterConflict() {
    if (!scope.isCurrent()) return;
    if (!window.confirm('Discard this draft and reload the latest server settings?')) return;
    dirty.current = false; setConflict(false); setMutationError(''); setNotice(''); reload();
  }
  async function remove() {
    if (!scope.isCurrent() || mutationRef.current || !project || confirmation !== project.name) return;
    const operation = scope.begin(); mutationRef.current = true;
    setDeleteBusy(true); setDeleteError('');
    try { await softDeleteProject(project.id, project.revision, operation.signal); if (!operation.isCurrent()) return; dirty.current = false; setDeleting(false); router.replace('/projects?notice=soft-deleted'); }
    catch (error) { if (!operation.isCurrent()) return; setDeleteError(`${error.message} Refresh the project before retrying if the result is uncertain.`); }
    finally { if (operation.isCurrent()) { mutationRef.current = false; setDeleteBusy(false); } operation.close(); }
  }
  if (loading) return <p role="status">Loading project...</p>;
  if (error) return <ProjectError error={error} onRetry={reload} />;
  return <>
    <nav aria-label="Breadcrumb" className="mb-4 text-sm"><Link className="text-blue-600 underline dark:text-blue-300" href="/projects">Projects</Link><span> / {project.name}{settings ? ' / Settings' : ''}</span></nav>
    <h1 className="break-words text-2xl font-semibold">{settings ? 'General settings' : project.name}</h1>
    <nav aria-label="Project" className="my-5 flex gap-5 border-b border-slate-200 pb-3 text-sm dark:border-slate-800"><Link href={`/projects/${encodeURIComponent(project.id)}`} aria-current={!settings ? 'page' : undefined} className={!settings ? 'font-semibold text-blue-600 dark:text-blue-300' : ''}>Overview</Link><Link href={`/projects/${encodeURIComponent(project.id)}/settings`} aria-current={settings ? 'page' : undefined} className={settings ? 'font-semibold text-blue-600 dark:text-blue-300' : ''}>General settings</Link></nav>
    {notice && <p role="status" className="mb-5 rounded-lg border border-emerald-400 p-3">{notice}</p>}
    {settings ? <>
      {conflict && <section role="alert" className="mb-4 rounded-lg border border-amber-400 p-4"><h2 className="font-semibold">Settings changed on the server</h2><p className="mt-1 text-sm">Your draft is preserved below. Copy anything you need before reloading. Saving is blocked until you reload.</p><button type="button" onClick={refreshAfterConflict} className="mt-3 underline">Discard draft and reload</button></section>}
      <ProjectForm key={`${project.id}:${project.revision}`} project={project} onSubmit={save} busy={busy} saveBlocked={conflict} error={mutationError} onDirtyChange={value => { dirty.current = value; }} />
      <section className="mt-10 rounded-xl border border-red-300 p-5 dark:border-red-900"><h2 className="font-semibold">Delete project</h2><p className="my-3 text-sm">Soft deletion removes this project from active use without permanently erasing its data. Restoration is not available in this release.</p><button type="button" disabled={busy || conflict} onClick={() => { if (dirty.current && !window.confirm('Deletion will discard unsaved settings. Continue?')) return; setConfirmation(''); setDeleteError(''); setDeleting(true); }} className="rounded-lg border border-red-400 px-4 py-2 text-red-700 disabled:opacity-50 dark:text-red-300">Delete project</button></section>
    </> : <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><h2 className="font-semibold">Project overview</h2><p className="mt-3 whitespace-pre-wrap break-words">{project.description || 'No description.'}</p><dl className="mt-5 space-y-3"><div><dt className="text-sm text-slate-500">Project type</dt><dd>{PROJECT_TYPES.find(type => type.value === project.project_type)?.label}</dd></div><div><dt className="text-sm text-slate-500">Technology stack</dt><dd>{technologyLabels(project).join(', ') || 'No technologies selected'}</dd></div></dl><p className="mt-6 rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-800">This delivery provides project setup only. Project chat, documents, skills, and storage controls are not implemented here.</p></section>}
    {deleting && <ProjectDialog title="Soft-delete project?" busy={deleteBusy} onClose={() => { if (!deleteBusy) setDeleting(false); }}><p>This removes the project from active use. Its data is not permanently erased, and restoration is not available.</p><label htmlFor="delete-project-confirmation" className="mt-5 block text-sm">Type the exact project name to confirm: <span className="font-semibold">{project.name}</span></label><input id="delete-project-confirmation" autoComplete="off" disabled={deleteBusy} value={confirmation} onChange={event => setConfirmation(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950" />{deleteError && <p role="alert" className="mt-3 text-red-600 dark:text-red-300">{deleteError}</p>}<div className="mt-5 flex justify-end gap-3"><button type="button" disabled={deleteBusy} onClick={() => setDeleting(false)} className="rounded-lg border px-4 py-2">Cancel</button><button type="button" disabled={deleteBusy || confirmation !== project.name} onClick={remove} className="rounded-lg bg-red-600 px-4 py-2 text-white disabled:opacity-50">{deleteBusy ? 'Deleting...' : 'Soft-delete project'}</button></div></ProjectDialog>}
  </>;
}
