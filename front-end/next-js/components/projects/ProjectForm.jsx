'use client';
import { useEffect, useId, useMemo, useState } from 'react';
import { PROJECT_TYPES, TECHNOLOGIES, emptyDraft, toDraft, toPayload, validateDraft, isDirty } from '../../lib/project-domain.mjs';
export default function ProjectForm({ project = null, onSubmit, onCancel, busy, error, onDirtyChange, submitLabel = 'Save changes', saveBlocked = false }) {
  const initial = useMemo(() => project ? toDraft(project) : emptyDraft(), [project]);
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState({});
  const [search, setSearch] = useState('');
  const id = useId();
  const dirty = isDirty(draft, initial);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => { if (Object.keys(errors).length) document.getElementById(`${id}-errors`)?.focus(); }, [errors, id]);
  useEffect(() => {
    function unload(event) { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } }
    function navigate(event) {
      const link = event.target.closest?.('a[href]');
      if (!link || event.defaultPrevented || (!dirty && !busy) || link.getAttribute('href').startsWith('#')) return;
      if (busy || !window.confirm('Discard your unsaved project changes?')) { event.preventDefault(); event.stopPropagation(); }
    }
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', navigate, true); };
  }, [dirty, busy]);
  function set(key, value) { setDraft(current => ({ ...current, [key]: value })); }
  function toggle(key, value) { setDraft(current => ({ ...current, [key]: current[key].includes(value) ? current[key].filter(item => item !== value) : [...current[key], value] })); }
  function submit(event) {
    event.preventDefault();
    const next = validateDraft(draft); setErrors(next);
    if (Object.keys(next).length) { document.getElementById(`${id}-errors`)?.focus(); return; }
    onSubmit(toPayload(draft));
  }
  function cancel() {
    if (busy || (dirty && !window.confirm('Discard your unsaved project changes?'))) return;
    setDraft(initial); setErrors({}); onCancel?.();
  }
  const inputClass = 'mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950';
  return <form onSubmit={submit} noValidate className="space-y-6">
    {(error || Object.keys(errors).length > 0) && <div id={`${id}-errors`} tabIndex={-1} role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error && <p>{error}</p>}{Object.values(errors).map(message => <p key={message}>{message}</p>)}</div>}
    <fieldset disabled={busy} className="space-y-6 disabled:opacity-60">
      <div><label htmlFor={`${id}-name`} className="font-medium">Project name (required)</label><input id={`${id}-name`} className={inputClass} value={draft.name} onChange={event => set('name', event.target.value)} aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? `${id}-name-error` : undefined} required />{errors.name && <p id={`${id}-name-error`} className="mt-1 text-sm text-red-600 dark:text-red-300">{errors.name}</p>}</div>
      <div><label htmlFor={`${id}-description`} className="font-medium">Description (optional)</label><textarea id={`${id}-description`} className={inputClass} rows={3} value={draft.description} onChange={event => set('description', event.target.value)} /></div>
      <fieldset><legend className="font-medium">Project type (required)</legend><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{PROJECT_TYPES.map(type => <label key={type.value} className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 ${draft.project_type === type.value ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40' : 'border-slate-300 dark:border-slate-700'}`}><input type="radio" name={`${id}-type`} value={type.value} checked={draft.project_type === type.value} onChange={() => set('project_type', type.value)} required />{type.label}</label>)}</div>{errors.project_type && <p className="mt-2 text-sm text-red-600 dark:text-red-300">{errors.project_type}</p>}</fieldset>
      <section aria-labelledby={`${id}-stack`}><h2 id={`${id}-stack`} className="font-medium">Technology stack</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Select applicable technologies. Frameworks do not automatically select languages. C++ can be used with General projects.</p>
        <label className="mt-4 block text-sm" htmlFor={`${id}-search`}>Filter technologies</label><input id={`${id}-search`} type="search" value={search} onChange={event => setSearch(event.target.value)} className={inputClass} />
        <div className="mt-4 space-y-5">{TECHNOLOGIES.map(group => {
          const options = group.options.filter(([, label]) => label.toLowerCase().includes(search.toLowerCase()));
          return <fieldset key={group.key}><legend className="text-sm font-semibold">{group.label}</legend><div className="mt-2 flex flex-wrap gap-3">{options.map(([value, label]) => <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700"><input type="checkbox" checked={draft[group.key].includes(value)} onChange={() => toggle(group.key, value)} />{label}</label>)}{options.length === 0 && <p className="text-sm text-slate-500">No matches in this group.</p>}</div></fieldset>;
        })}</div>
      </section>
    </fieldset>
    <div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4 dark:border-slate-800"><button type="button" disabled={busy} onClick={cancel} className="rounded-lg border border-slate-300 px-4 py-2 disabled:opacity-50 dark:border-slate-700">{onCancel ? 'Cancel' : 'Discard changes'}</button><button type="submit" disabled={busy || saveBlocked || (Boolean(project) && !dirty)} className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'Saving...' : submitLabel}</button></div>
  </form>;
}
