'use client';
import { useEffect, useRef } from 'react';
export default function ProjectDialog({ title, children, busy = false, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const element = ref.current; const previous = document.activeElement;
    element.showModal();
    return () => { element.close(); previous?.focus?.(); };
  }, []);
  return <dialog ref={ref} aria-labelledby="project-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} className="m-auto max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-300 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-slate-950/60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
    <div className="mb-5 flex items-start justify-between gap-4"><h2 id="project-dialog-title" className="text-xl font-semibold">{title}</h2><button type="button" disabled={busy} onClick={onClose} aria-label="Close dialog" className="rounded px-2 py-1 disabled:opacity-40">Close</button></div>{children}
  </dialog>;
}
