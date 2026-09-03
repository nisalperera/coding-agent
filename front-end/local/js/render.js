// front-end/js/render.js
//
// DOM rendering helpers for chat bubbles, backend-readiness progress, and
// human-in-the-loop confirmation cards. Pure presentation — no networking.

function chatEl() {
  return document.querySelector("#chat > div");
}

export function scrollToBottom() {
  const chat = document.getElementById("chat");
  if (chat) chat.scrollTop = chat.scrollHeight;
}

function renderMarkdown(text) {
  return window.marked.parse(text ?? "");
}

function highlightAll(container) {
  container.querySelectorAll("pre code").forEach((block) => window.hljs.highlightElement(block));
}

export function appendMessage(role, text, files = []) {
  document.getElementById("empty-state")?.remove();

  const wrap = document.createElement("div");
  wrap.className = `msg-enter flex items-start gap-3 ${role === "user" ? "justify-end" : "justify-start"}`;

  const bubble = document.createElement("div");

  if (role === "user") {
    bubble.className =
      "max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tr-sm bg-brand-600 text-white px-4 py-2.5 text-sm sm:text-base whitespace-pre-wrap break-words";
    bubble.textContent = text;

    if (files.length) {
      const fileRow = document.createElement("div");
      fileRow.className = "flex flex-wrap gap-1.5 mt-2";
      files.forEach((f) => {
        const tag = document.createElement("span");
        tag.className = "text-[11px] bg-white/15 rounded-full px-2 py-0.5";
        tag.textContent = `\uD83D\uDCC4 ${f.name}`;
        fileRow.appendChild(tag);
      });
      bubble.appendChild(fileRow);
    }
  } else {
    const avatar = document.createElement("div");
    avatar.className =
      "h-8 w-8 shrink-0 rounded-full bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-200 flex items-center justify-center text-sm font-semibold";
    avatar.textContent = "\uD83E\uDD16";
    wrap.appendChild(avatar);

    bubble.className =
      "prose-chat max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tl-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm sm:text-base prose prose-sm dark:prose-invert prose-p:my-1.5 prose-pre:my-2";
    bubble.innerHTML = renderMarkdown(text);
    highlightAll(bubble);
  }

  wrap.appendChild(bubble);
  chatEl().appendChild(wrap);
  scrollToBottom();
  return bubble;
}

export function updateAssistantBubble(bubble, fullText) {
  bubble.innerHTML = renderMarkdown(fullText);
  highlightAll(bubble);
  scrollToBottom();
}

function formatProgressText(message, percent) {
  return `${message ?? "Working..."}${typeof percent === "number" ? ` (${percent}%)` : ""}`;
}

export function appendProgressMessage(message, percent) {
  document.getElementById("empty-state")?.remove();

  const wrap = document.createElement("div");
  wrap.className = "msg-enter flex items-start gap-3 justify-start";

  const avatar = document.createElement("div");
  avatar.className =
    "h-8 w-8 shrink-0 rounded-full bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-200 flex items-center justify-center text-sm font-semibold";
  avatar.textContent = "\u23F3";
  wrap.appendChild(avatar);

  const bubble = document.createElement("div");
  bubble.className =
    "rounded-2xl rounded-tl-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm text-slate-600 dark:text-slate-300";
  bubble.dataset.progressText = "true";
  bubble.textContent = formatProgressText(message, percent);
  wrap.appendChild(bubble);

  chatEl().appendChild(wrap);
  scrollToBottom();
  return wrap;
}

export function updateProgressMessage(wrapEl, message, percent) {
  if (!wrapEl) return;
  const bubble = wrapEl.querySelector("[data-progress-text]");
  if (bubble) bubble.textContent = formatProgressText(message, percent);
  scrollToBottom();
}

export function removeProgressMessage(wrapEl) {
  wrapEl?.remove();
}

/**
 * Renders an inline Approve/Deny card for a risky tool call the backend is
 * asking the human to confirm (write_file, run_shell, or any github_ or
 * gitlab_ prefixed repo-management tool -- see RISKY_TOOLS in
 * back-end/app/api/chat.py). onResolve(decision) is invoked with
 * "approve" or "deny" when a button is clicked.
 */
export function appendConfirmation(toolName, args, onResolve) {
  document.getElementById("empty-state")?.remove();

  const wrap = document.createElement("div");
  wrap.className = "msg-enter flex items-start gap-3 justify-start";

  const avatar = document.createElement("div");
  avatar.className =
    "h-8 w-8 shrink-0 rounded-full bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-200 flex items-center justify-center text-sm font-semibold";
  avatar.textContent = "\u26A0\uFE0F";
  wrap.appendChild(avatar);

  const card = document.createElement("div");
  card.className =
    "max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tl-sm bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 px-4 py-3 text-sm";

  const title = document.createElement("p");
  title.className = "font-medium mb-1";
  title.textContent = `Approve ${toolName}?`;
  card.appendChild(title);

  const pre = document.createElement("pre");
  pre.className = "bg-slate-100 dark:bg-slate-900 rounded-lg p-2 text-xs overflow-x-auto mb-3";
  pre.textContent = JSON.stringify(args, null, 2);
  card.appendChild(pre);

  const btnRow = document.createElement("div");
  btnRow.className = "flex gap-2";

  const approveBtn = document.createElement("button");
  approveBtn.className = "text-xs px-3 py-1.5 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 transition";
  approveBtn.textContent = "Approve";

  const denyBtn = document.createElement("button");
  denyBtn.className =
    "text-xs px-3 py-1.5 rounded-full bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 transition";
  denyBtn.textContent = "Deny";

  const resolve = async (decision) => {
    approveBtn.disabled = true;
    denyBtn.disabled = true;
    approveBtn.classList.add("opacity-50");
    denyBtn.classList.add("opacity-50");
    await onResolve(decision);
  };
  approveBtn.onclick = () => resolve("approve");
  denyBtn.onclick = () => resolve("deny");

  btnRow.appendChild(approveBtn);
  btnRow.appendChild(denyBtn);
  card.appendChild(btnRow);

  wrap.appendChild(card);
  chatEl().appendChild(wrap);
  scrollToBottom();
}
