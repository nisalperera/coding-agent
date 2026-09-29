'use client';

import { useCallback, useRef, useState } from 'react';
import { formatBytes } from '../hooks/useAttachments';

export default function Composer({ attachmentsState, onSend, loading }) {
  const [value, setValue] = useState('');
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const { attachments, clearAttachments, removeAttachment, handleFileSelect } = attachmentsState;

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, []);

  const doSend = useCallback(() => {
    const message = value.trim();
    if (!message && attachments.length === 0) return;
    onSend(message, attachments);
    setValue('');
    clearAttachments();
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [value, attachments, onSend, clearAttachments]);

  const onKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    },
    [doSend]
  );

  return (
    <footer className="shrink-0 border-t border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur">
      <div className="max-w-3xl mx-auto px-4 py-3">
        {attachments.length > 0 && (
          <div id="file-chips" className="flex flex-wrap gap-2 mb-2">
            {attachments.map((file, idx) => (
              <div
                key={`${file.name}-${idx}`}
                className="file-chip flex items-center gap-1.5 text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full pl-3 pr-1.5 py-1"
              >
                <span className="max-w-[10rem] truncate">{file.name}</span>
                <span className="text-slate-400">{formatBytes(file.size)}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(idx)}
                  className="h-5 w-5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm focus-within:ring-2 focus-within:ring-brand-500">
          <input
            id="file-input"
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFileSelect(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            id="file-attach-btn"
            type="button"
            aria-label="Attach file"
            onClick={() => fileInputRef.current?.click()}
            className="h-9 w-9 shrink-0 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 flex items-center justify-center transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21.44 11.05 12.25 20.24a5.5 5.5 0 0 1-7.78-7.78l8.49-8.48a3.5 3.5 0 0 1 4.95 4.95l-8.49 8.49a1.5 1.5 0 0 1-2.12-2.12l7.07-7.07"
              />
            </svg>
          </button>
          <textarea
            id="input"
            ref={textareaRef}
            rows={1}
            placeholder="Message the coding agent..."
            value={value}
            disabled={loading}
            onChange={(e) => {
              setValue(e.target.value);
              autoResize();
            }}
            onKeyDown={onKeyDown}
            className="flex-1 resize-none bg-transparent outline-none text-sm sm:text-base max-h-40 py-1.5"
          />
          <button
            id="send-btn"
            type="button"
            aria-label="Send message"
            disabled={loading}
            onClick={doSend}
            className="h-9 w-9 shrink-0 rounded-full bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed text-white flex items-center justify-center transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 -rotate-90">
              <path d="M3.4 20.6 22 12 3.4 3.4 3 10l13 2-13 2z" />
            </svg>
          </button>
        </div>
        <p className="text-[11px] text-slate-400 mt-1.5 text-center">
          Enter to send &middot; Shift+Enter for a new line &middot; Attach files up to 2&nbsp;MB each
        </p>
      </div>
    </footer>
  );
}
