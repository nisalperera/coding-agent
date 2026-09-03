// front-end/js/main.js
//
// Application bootstrap. Wires DOM events to the feature modules and
// dispatches on the current pathname for the two OAuth redirect targets
// this SPA handles client-side: "/callback/github", "/callback/gitlab".
// (Google's own callback is handled entirely server-side -- see auth.js.)

import { completeLoginFromUrlFragment, refreshCurrentUser } from "./auth.js";
import { refreshAuthUI, wireAuthButtons } from "./auth-ui.js";
import { handleGitHubCallback, handleGitLabCallback } from "./integrations.js";
import { refreshIntegrationsUI, wireIntegrationsButtons } from "./integrations-ui.js";
import { initTheme, toggleTheme } from "./theme.js";
import { initAttachments, handleFileSelect } from "./attachments.js";
import { appendMessage } from "./render.js";
import { send, autoResizeInput, handleInputKeydown } from "./chat.js";

function wireChatInput() {
  const inputEl = document.getElementById("input");
  const sendBtn = document.getElementById("send-btn");
  const fileInput = document.getElementById("file-input");
  const fileAttachBtn = document.getElementById("file-attach-btn");

  inputEl?.addEventListener("input", () => autoResizeInput(inputEl));
  inputEl?.addEventListener("keydown", handleInputKeydown);
  sendBtn?.addEventListener("click", send);
  fileInput?.addEventListener("change", (e) => handleFileSelect(e.target.files));
  // Previously an inline onclick="document.getElementById('file-input').click()"
  // on the paperclip button. Inline handlers cannot reference module-scoped
  // code, so this button is wired here instead (see index.html's script tags).
  fileAttachBtn?.addEventListener("click", () => fileInput?.click());
}

async function dispatchOnRoute() {
  const path = window.location.pathname;

  if (path === "/callback/github") {
    const result = await handleGitHubCallback();
    if (result?.message) appendMessage("assistant", result.message);
    return;
  }

  if (path === "/callback/gitlab") {
    const result = await handleGitLabCallback();
    if (result?.message) appendMessage("assistant", result.message);
    return;
  }

  // Google's OAuth callback is server-side; on success it redirects the
  // browser back here with "#token=..." in the URL fragment (see auth.js).
  await completeLoginFromUrlFragment();
}

window.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  document.getElementById("theme-toggle-btn")?.addEventListener("click", toggleTheme);

  wireAuthButtons();
  wireIntegrationsButtons();
  wireChatInput();
  initAttachments({ onWarning: (message) => appendMessage("assistant", message) });

  await dispatchOnRoute();
  await refreshCurrentUser();

  refreshAuthUI();
  refreshIntegrationsUI();
  document.getElementById("input")?.focus();
});
