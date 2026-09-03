'use client';

import { useEffect, useRef } from 'react';
import MessageBubble from './MessageBubble';

export default function ChatLog({ messages, onResolveConfirmation, dragProps, dragActive }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <main
      id="chat"
      ref={scrollRef}
      className="flex-1 overflow-y-auto relative"
      onDragEnter={dragProps.onDragEnter}
      onDragOver={dragProps.onDragOver}
      onDragLeave={dragProps.onDragLeave}
      onDrop={dragProps.onDrop}
    >
      <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-4">
        {messages.length === 0 && (
          <div id="empty-state" className="text-center text-slate-400 dark:text-slate-500 py-16">
            <div className="text-3xl mb-2">{'\u{1F916}'}</div>
            <p className="text-sm">Ask about your repo, request an edit, paste an error, or attach a file to debug.</p>
          </div>
        )}
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} onResolveConfirmation={onResolveConfirmation} />
        ))}
      </div>
      <div
        id="drop-overlay"
        className={`${
          dragActive ? 'flex' : 'hidden'
        } absolute inset-0 z-30 bg-brand-600/10 border-2 border-dashed border-brand-500 rounded-lg m-2 items-center justify-center`}
      >
        <p className="text-brand-700 dark:text-brand-300 font-medium text-sm sm:text-base">Drop files to attach</p>
      </div>
    </main>
  );
}
