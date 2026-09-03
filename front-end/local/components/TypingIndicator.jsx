'use client';

export default function TypingIndicator({ visible }) {
  return (
    <div className={`${visible ? '' : 'hidden'} max-w-3xl mx-auto w-full px-4 pb-1 -mt-2`}>
      <div className="flex items-center gap-1 text-slate-400 text-sm pl-11">
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-slate-400 inline-block" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-slate-400 inline-block" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-slate-400 inline-block" />
      </div>
    </div>
  );
}
