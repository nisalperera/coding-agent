// front-end/js/integrations-ui.js
//
// DOM wiring for the GitHub/GitLab integrations modal and the header-level
// quick-connect buttons. Delegates all network/state logic to
// integrations.js and only handles rendering + event binding here.

import {
  isGitHubConnected,
  getGitHubUsername,
  connectGitHub,
  disconnectGitHub,
  isGitLabConnected,
  connectGitLab,
  disconnectGitLab,
} from "./integrations.js";
import { appendMessage } from "./render.js";

export function openIntegrationsModal() {
  const modal = document.getElementById("integrations-modal");
  modal?.classList.remove("hidden");
  modal?.classList.add("flex");
  refreshIntegrationsUI();
}

export function closeIntegrationsModal() {
  const modal = document.getElementById("integrations-modal");
  modal?.classList.add("hidden");
  modal?.classList.remove("flex");
}

async function onGitHubToggle() {
  const result = isGitHubConnected() ? await disconnectGitHub() : connectGitHub();
  if (result?.message) appendMessage("assistant", result.message);
  refreshIntegrationsUI();
}

async function onGitLabToggle() {
  const result = isGitLabConnected() ? disconnectGitLab() : await connectGitLab();
  if (result?.message) appendMessage("assistant", result.message);
  refreshIntegrationsUI();
}

export function refreshIntegrationsUI() {
  const githubConnected = isGitHubConnected();
  const githubUsername = getGitHubUsername();

  const githubStatus = document.getElementById("github-status-text");
  if (githubStatus) {
    githubStatus.textContent = githubConnected ? `Connected${githubUsername ? " as @" + githubUsername : ""}` : "Not connected";
  }
  const githubBtn = document.getElementById("github-connect-btn");
  if (githubBtn) {
    githubBtn.textContent = githubConnected ? "Disconnect" : "Connect";
    githubBtn.onclick = onGitHubToggle;
  }

  const gitlabConnected = isGitLabConnected();
  const gitlabStatus = document.getElementById("gitlab-status-text");
  if (gitlabStatus) {
    gitlabStatus.textContent = gitlabConnected ? "Connected" : "Not connected";
  }
  const gitlabBtn = document.getElementById("gitlab-connect-btn");
  if (gitlabBtn) {
    gitlabBtn.textContent = gitlabConnected ? "Disconnect" : "Connect";
    gitlabBtn.onclick = onGitLabToggle;
  }

  document.getElementById("integrations-dot")?.classList.toggle("hidden", !(githubConnected || gitlabConnected));

  const githubAuthBtn = document.getElementById("github-auth-btn");
  const githubAuthLabel = document.getElementById("github-auth-btn-label");
  if (githubAuthLabel) {
    githubAuthLabel.textContent = githubConnected ? `GitHub \u2713${githubUsername ? " @" + githubUsername : ""}` : "Connect GitHub";
  }
  if (githubAuthBtn) {
    githubAuthBtn.onclick = onGitHubToggle;
    githubAuthBtn.classList.toggle("opacity-70", githubConnected);
  }

  const gitlabAuthBtn = document.getElementById("gitlab-auth-btn");
  const gitlabAuthLabel = document.getElementById("gitlab-auth-btn-label");
  if (gitlabAuthLabel) {
    gitlabAuthLabel.textContent = gitlabConnected ? "GitLab \u2713" : "Connect GitLab";
  }
  if (gitlabAuthBtn) {
    gitlabAuthBtn.onclick = onGitLabToggle;
    gitlabAuthBtn.classList.toggle("opacity-70", gitlabConnected);
  }
}

export function wireIntegrationsButtons() {
  document.getElementById("integrations-open-btn")?.addEventListener("click", openIntegrationsModal);
  document.getElementById("integrations-close-btn")?.addEventListener("click", closeIntegrationsModal);
}
