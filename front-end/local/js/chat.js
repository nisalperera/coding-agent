// front-end/js/chat.js
//
// Chat send/receive logic against POST /v1/chat/completions (see
// back-end/app/api/chat.py) and POST /v1/actions for resolving
// human-in-the-loop confirmations (see
// back-end/app/services/pending_actions_service.py).

import { apiFetch, apiStream, ApiError } from "./api.js";
import { consumeAgentStream } from "./stream.js";
import { getAttachments, clearAttachments, renderFileChips } from "./attachments.js";
import { getGitLabAccessToken } from "./integrations.js";
import {
  appendMessage,
  updateAssistantBubble,
  appendProgressMessage,
  updateProgressMessage,
  removeProgressMessage,
  appendConfirmation,
  scrollToBottom,
} from "./render.js";

let history = [];

function setLoading(loading) {
  const sendBtn = document.getElementById("send-btn");
  const inputEl = document.getElementById("input");
  const typingIndicator = document.getElementById("typing-indicator");
  if (sendBtn) sendBtn.disabled = loading;
  if (inputEl) inputEl.disabled = loading;
  typingIndicator?.classList.toggle("hidden", !loading);
}

/**
 * Resolves a pending human-in-the-loop action created by the backend. For
 * gitlab_* tools, attaches this browser's locally-stored GitLab token for
 * this one call only (see integrations.js) -- it is never persisted
 * server-side. This is a plain, non-streaming JSON call (POST /v1/actions
 * always returns a single flat object immediately), unlike send() below.
 */
async function resolvePendingAction(actionId, decision, toolName) {
  setLoading(true);
  try {
    const isGitlabTool = toolName && toolName.startsWith("gitlab_");
    const result = await apiFetch("/v1/actions", {
      method: "POST",
      body: {
        action: "action_pending",
        action_id: actionId,
        decision,
        gitlab_token: isGitlabTool ? getGitLabAccessToken() : null,
      },
    });
    appendMessage("assistant", result.result ?? "No response from agent.");
  } catch (err) {
    const detail = err instanceof ApiError ? err.message : String(err);
    appendMessage("assistant", `Could not resolve that action: ${detail}`);
  } finally {
    setLoading(false);
  }
}

export async function send() {
  const inputEl = document.getElementById("input");
  const message = inputEl.value.trim();
  const attachments = getAttachments();
  if (!message && attachments.length === 0) return;

  const filesForRequest = attachments.map(({ name, content }) => ({ name, content }));
  const filesForDisplay = attachments.map(({ name, size }) => ({ name, size }));

  history.push({ role: "user", content: message, attachments: filesForRequest });
  appendMessage("user", message || "(sent files only)", filesForDisplay);

  inputEl.value = "";
  inputEl.style.height = "auto";
  clearAttachments();
  renderFileChips();
  setLoading(true);

  let progressWrap = null;
  let answerBubble = null;
  let answerText = "";
  let handledTerminalEvent = false;

  try {
    const response = await apiStream("/v1/chat/completions", {
      message,
      history: history.slice(0, -1),
      attachments: filesForRequest,
    });

    await consumeAgentStream(response, {
      onProgress: (event) => {
        if (!progressWrap) {
          progressWrap = appendProgressMessage(event.message, event.percent);
        } else {
          updateProgressMessage(progressWrap, event.message, event.percent);
        }
      },
      onError: (event) => {
        removeProgressMessage(progressWrap);
        appendMessage("assistant", event.message ?? "The agent hit an error.");
        handledTerminalEvent = true;
      },
      onConfirmation: (event) => {
        removeProgressMessage(progressWrap);
        appendConfirmation(event.tool_name, event.args, (decision) =>
          resolvePendingAction(event.action_id, decision, event.tool_name)
        );
        handledTerminalEvent = true;
      },
      onAnswerStart: () => {
        removeProgressMessage(progressWrap);
        answerBubble = appendMessage("assistant", "");
      },
      onToken: (token) => {
        answerText += token;
        if (answerBubble) {
          updateAssistantBubble(answerBubble, answerText);
        }
      },
      onFallback: (event) => {
        // Defensive: a flat {result|error} object with no "type" is not
        // currently emitted by the backend, but handled here for
        // forward/backward compatibility with older response shapes.
        removeProgressMessage(progressWrap);
        const reply = event.result ?? event.error ?? "No response from agent.";
        appendMessage("assistant", reply);
        history.push({ role: "assistant", content: reply });
        handledTerminalEvent = true;
      },
    });

    if (answerBubble) {
      history.push({ role: "assistant", content: answerText });
    } else if (!handledTerminalEvent) {
      removeProgressMessage(progressWrap);
      appendMessage("assistant", "No response from agent.");
    }
  } catch (err) {
    removeProgressMessage(progressWrap);
    const detail = err instanceof ApiError ? err.message : err.message || String(err);
    appendMessage("assistant", `Request failed: ${detail}`);
  } finally {
    setLoading(false);
    inputEl.focus();
  }
}

export function resetHistory() {
  history = [];
}

export function autoResizeInput(el) {
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 160) + "px";
}

export function handleInputKeydown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}

export { scrollToBottom };
