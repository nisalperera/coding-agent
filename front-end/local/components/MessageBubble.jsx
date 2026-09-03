'use client';

import { useEffect, useRef } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';

function renderMarkdown(text) {
  return marked.parse(text ?? '');
}

function AssistantBubble({ text }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = renderMarkdown(text);
    ref.current.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
  }, [text]);

  return (
    <div className="flex items-start gap-3 justify-start">
      <div className="h-8 w-8 shrink-0 rounded-full bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-200 flex items-center justify-center text-sm font-semibold">
        {'\u{1F916}'}
      </div>
      <div
        ref={ref}
        className="prose-chat max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tl-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm sm:text-base prose prose-sm dark:prose-invert prose-p:my-1.5 prose-pre:my-2"
      />
    </div>
  );
}

function UserBubble({ text, files }) {
  return (
    <div className="flex items-start gap-3 justify-end">
      <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tr-sm bg-brand-600 text-white px-4 py-2.5 text-sm sm:text-base whitespace-pre-wrap break-words">
        {text}
        {files && files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {files.map((f) => (
              <span key={f.name} className="text-[11px] bg-white/15 rounded-full px-2 py-0.5">
                {'\u{1F4C4}'} {f.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressBubble({ text, percent }) {
  const label = `${text ?? 'Working...'}${typeof percent === 'number' ? ` (${percent}%)` : ''}`;
  return (
    <div className="flex items-start gap-3 justify-start">
      <div className="h-8 w-8 shrink-0 rounded-full bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-200 flex items-center justify-center text-sm font-semibold">
        {'\u23F3'}
      </div>
      <div className="rounded-2xl rounded-tl-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm text-slate-600 dark:text-slate-300">
        {label}
      </div>
    </div>
  );
}

function ConfirmationCard({ toolName, args, resolved, onResolve }) {
  return (
    <div className="flex items-start gap-3 justify-start">
      <div className="h-8 w-8 shrink-0 rounded-full bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-200 flex items-center justify-center text-sm font-semibold">
        {'\u26A0\uFE0F'}
      </div>
      <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tl-sm bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 px-4 py-3 text-sm">
        <p className="font-medium mb-1">Approve {toolName}?</p>
        <pre className="bg-slate-100 dark:bg-slate-900 rounded-lg p-2 text-xs overflow-x-auto mb-3">
          {JSON.stringify(args, null, 2)}
        </pre>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={resolved}
            onClick={() => onResolve('approve')}
            className="text-xs px-3 py-1.5 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50"
          >
            Approve
          </button>
          <button
            type="button"
            disabled={resolved}
            onClick={() => onResolve('deny')}
            className="text-xs px-3 py-1.5 rounded-full bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 transition disabled:opacity-50"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MessageBubble({ message, onResolveConfirmation }) {
  const wrapClass = 'msg-enter';

  switch (message.role) {
    case 'user':
      return (
        <div className={wrapClass}>
          <UserBubble text={message.text} files={message.files} />
        </div>
      );
    case 'progress':
      return (
        <div className={wrapClass}>
          <ProgressBubble text={message.text} percent={message.percent} />
        </div>
      );
    case 'confirmation':
      return (
        <div className={wrapClass}>
          <ConfirmationCard
            toolName={message.toolName}
            args={message.args}
            resolved={message.resolved}
            onResolve={(decision) =>
              onResolveConfirmation(message.id, message.actionId, decision, message.toolName)
            }
          />
        </div>
      );
    case 'assistant':
    default:
      return (
        <div className={wrapClass}>
          <AssistantBubble text={message.text} />
        </div>
      );
  }
}
