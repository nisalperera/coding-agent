// front-end/app.js
//
// Application logic for Nisal's Coding Agent front-end. Reads runtime
// configuration from window.APP_CONFIG (see config.js), which CI populates
// at deploy time. No secrets or environment-specific values live in this
// file — it is static and cacheable across deploys.


const LAMBDA_URL = window.APP_CONFIG.LAMBDA_URL;
const COGNITO_DOMAIN = window.APP_CONFIG.COGNITO_DOMAIN;
const CLIENT_ID = window.APP_CONFIG.COGNITO_CLIENT_ID;
const REDIRECT_URI = window.location.origin + "/callback";


// GitHub OAuth App (user-to-server flow). GitHub's token exchange requires
// a client secret, so the front-end only performs the authorize redirect;
// the actual code-for-token exchange happens server-side via the existing
// Lambda Function URL using the "github_oauth_callback" action (see
// back-end/lambda_function.py + back-end/github_oauth.py). The resulting
// token is stored server-side in DynamoDB and is used automatically for
// every github_* tool call this user's agent session makes — see
// call_repo_tool() in lambda_function.py.
const GITHUB_CLIENT_ID = window.APP_CONFIG.GITHUB_OAUTH_CLIENT_ID;
const GITHUB_REDIRECT_URI = window.location.origin + "/callback/github";
const GITHUB_SCOPES = "repo read:user";


// GitLab OAuth application registered as a "public"/native client, which
// allows a full Authorization Code + PKCE exchange directly from the
// browser without a client secret. Unlike GitHub, this token is NEVER sent
// to the backend to be stored — it lives only in this browser's
// localStorage, and is attached to each request body (as `gitlab_token`)
// only at the moment a gitlab_* tool call needs approving. The backend uses
// it for that single call and discards it immediately afterward.
const GITLAB_CLIENT_ID = window.APP_CONFIG.GITLAB_OAUTH_CLIENT_ID;
const GITLAB_OAUTH_DOMAIN = "https://gitlab.com";
const GITLAB_REDIRECT_URI = window.location.origin + "/callback/gitlab";
const GITLAB_SCOPES = "api read_repository write_repository";


const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB per file, adjust to match backend/API Gateway payload limits
let history = [];
let attachments = []; // [{ name, size, content }]


// ---- Theme -------------------------------------------------------------
function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  document.getElementById('theme-icon').textContent = dark ? '☀️' : '🌙';
  localStorage.setItem('theme', dark ? 'dark' : 'light');
}
function toggleTheme() {
  applyTheme(!document.documentElement.classList.contains('dark'));
}
(function initTheme() {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved ? saved === 'dark' : prefersDark);
})();


// ---- Shared PKCE helpers (used by Cognito login and GitLab connect) ----
function base64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function generateRandomToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64url(array);
}
async function generateCodeChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(digest);
}


// ---- Cognito Hosted UI auth (sign in to the agent itself) ---------------
async function loginWithProvider(provider) {
  const verifier = generateRandomToken();
  sessionStorage.setItem('pkce_verifier', verifier);
  const challenge = await generateCodeChallenge(verifier);
  const params = new URLSearchParams({
    client_id: CLIENT_ID, response_type: 'code', scope: 'openid email profile',
    redirect_uri: REDIRECT_URI, identity_provider: provider,
    code_challenge: challenge, code_challenge_method: 'S256',
  });
  window.location.href = `${COGNITO_DOMAIN}/oauth2/authorize?${params}`;
}


async function handleAuthCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  if (!code) return;
  const verifier = sessionStorage.getItem('pkce_verifier');
  const resp = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', client_id: CLIENT_ID, code,
      redirect_uri: REDIRECT_URI, code_verifier: verifier,
    }),
  });
  const tokens = await resp.json();
  localStorage.setItem('id_token', tokens.id_token);
  localStorage.setItem('access_token', tokens.access_token);
  localStorage.setItem('refresh_token', tokens.refresh_token);
  window.location.href = '/';
}


function decodeJwtEmail(idToken) {
  try {
    const payload = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.email || payload['cognito:username'] || '';
  } catch { return ''; }
}


function refreshAuthUI() {
  const signedIn = !!localStorage.getItem('access_token');
  document.getElementById('auth-signed-out').classList.toggle('hidden', signedIn);
  document.getElementById('auth-signed-in').classList.toggle('hidden', !signedIn);
  document.getElementById('auth-signed-in').classList.toggle('flex', signedIn);
  if (signedIn) {
    const idToken = localStorage.getItem('id_token');
    document.getElementById('user-email').textContent = idToken ? decodeJwtEmail(idToken) : '';
  }
}


function logout() {
  localStorage.removeItem('id_token');
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  sessionStorage.removeItem('pkce_verifier');
  history = [];
  refreshAuthUI();
  window.location.href = '/';
}


// ---- Repository integrations: GitHub / GitLab authorization ------------
function openIntegrationsModal() {
  const modal = document.getElementById('integrations-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  refreshIntegrationsUI();
}
function closeIntegrationsModal() {
  const modal = document.getElementById('integrations-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}


function refreshIntegrationsUI() {
  const githubConnected = localStorage.getItem('github_connected') === 'true';
  const githubUsername = localStorage.getItem('github_username') || '';
  document.getElementById('github-status-text').textContent = githubConnected
    ? `Connected${githubUsername ? ' as @' + githubUsername : ''}`
    : 'Not connected';
  const githubBtn = document.getElementById('github-connect-btn');
  githubBtn.textContent = githubConnected ? 'Disconnect' : 'Connect';
  githubBtn.onclick = githubConnected ? disconnectGitHub : connectGitHub;


  const gitlabConnected = localStorage.getItem('gitlab_connected') === 'true';
  const gitlabUsername = localStorage.getItem('gitlab_username') || '';
  document.getElementById('gitlab-status-text').textContent = gitlabConnected
    ? `Connected${gitlabUsername ? ' as @' + gitlabUsername : ''}`
    : 'Not connected';
  const gitlabBtn = document.getElementById('gitlab-connect-btn');
  gitlabBtn.textContent = gitlabConnected ? 'Disconnect' : 'Connect';
  gitlabBtn.onclick = gitlabConnected ? disconnectGitLab : connectGitLab;


  document.getElementById('integrations-dot').classList.toggle('hidden', !(githubConnected || gitlabConnected));


  // Header-level quick-auth buttons shown right after login
  const githubAuthBtn = document.getElementById('github-auth-btn');
  const githubAuthLabel = document.getElementById('github-auth-btn-label');
  githubAuthLabel.textContent = githubConnected
    ? `GitHub ✓${githubUsername ? ' @' + githubUsername : ''}`
    : 'Connect GitHub';
  githubAuthBtn.onclick = githubConnected ? disconnectGitHub : connectGitHub;
  githubAuthBtn.classList.toggle('opacity-70', githubConnected);


  const gitlabAuthBtn = document.getElementById('gitlab-auth-btn');
  const gitlabAuthLabel = document.getElementById('gitlab-auth-btn-label');
  gitlabAuthLabel.textContent = gitlabConnected
    ? `GitLab ✓${gitlabUsername ? ' @' + gitlabUsername : ''}`
    : 'Connect GitLab';
  gitlabAuthBtn.onclick = gitlabConnected ? disconnectGitLab : connectGitLab;
  gitlabAuthBtn.classList.toggle('opacity-70', gitlabConnected);
}


// GitHub: redirect-only from the front-end. The code exchange (which needs
// the OAuth App's client secret) happens server-side — handleGitHubCallback()
// below calls the existing Lambda Function URL with a
// {"action": "github_oauth_callback"} body, matching the same JSON-action
// dispatch convention lambda_function.py already uses for "approve_pending".
function connectGitHub() {
  const state = generateRandomToken();
  sessionStorage.setItem('github_oauth_state', state);
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_REDIRECT_URI,
    scope: GITHUB_SCOPES,
    state,
    allow_signup: 'false',
  });
  window.location.href = `https://github.com/login/oauth/authorize?${params}`;
}


async function handleGitHubCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = sessionStorage.getItem('github_oauth_state');
  sessionStorage.removeItem('github_oauth_state');
  window.history.replaceState({}, '', '/');
  if (!code) return;
  if (!state || state !== expected) {
    appendMessage('assistant', '⚠️ GitHub connection failed: state mismatch. Please try connecting again.');
    return;
  }
  try {
    const resp = await fetch(LAMBDA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
      },
      body: JSON.stringify({
        action: 'github_oauth_callback',
        code,
        redirect_uri: GITHUB_REDIRECT_URI,
      }),
    });
    if (!resp.ok) throw new Error(`backend returned ${resp.status}`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    localStorage.setItem('github_connected', 'true');
    localStorage.setItem('github_username', data.username || '');
    appendMessage('assistant', `✅ GitHub connected${data.username ? ' as **@' + data.username + '**' : ''}.`);
  } catch (err) {
    appendMessage('assistant', `⚠️ Could not finish connecting GitHub (${err.message}).`);
  } finally {
    refreshIntegrationsUI();
  }
}


// Disconnecting GitHub also revokes the token stored server-side (DynamoDB),
// via the "disconnect_integration" Lambda action — not just this browser's
// local flag. Best-effort: local state is cleared even if the network call
// fails, since the user's intent is "stop using my GitHub identity" either way.
async function disconnectGitHub() {
  try {
    const resp = await fetch(LAMBDA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
      },
      body: JSON.stringify({ action: 'disconnect_integration', provider: 'github' }),
    });
    if (!resp.ok) throw new Error(`backend returned ${resp.status}`);
  } catch (err) {
    appendMessage('assistant', `⚠️ Could not confirm GitHub token removal on the server (${err.message}). Cleared locally; if this keeps happening, revoke access from GitHub settings directly.`);
  }
  localStorage.removeItem('github_connected');
  localStorage.removeItem('github_username');
  refreshIntegrationsUI();
  appendMessage('assistant', 'GitHub disconnected — the stored server-side token was revoked.');
}


// GitLab: full PKCE flow, no client secret needed for a "public" OAuth app.
async function connectGitLab() {
  const verifier = generateRandomToken();
  sessionStorage.setItem('gitlab_pkce_verifier', verifier);
  const state = generateRandomToken();
  sessionStorage.setItem('gitlab_oauth_state', state);
  const challenge = await generateCodeChallenge(verifier);
  const params = new URLSearchParams({
    client_id: GITLAB_CLIENT_ID,
    redirect_uri: GITLAB_REDIRECT_URI,
    response_type: 'code',
    scope: GITLAB_SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  window.location.href = `${GITLAB_OAUTH_DOMAIN}/oauth/authorize?${params}`;
}


async function handleGitLabCallback() {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = sessionStorage.getItem('gitlab_oauth_state');
  const verifier = sessionStorage.getItem('gitlab_pkce_verifier');
  sessionStorage.removeItem('gitlab_oauth_state');
  sessionStorage.removeItem('gitlab_pkce_verifier');
  window.history.replaceState({}, '', '/');
  if (!code) return;
  if (!state || state !== expected) {
    appendMessage('assistant', '⚠️ GitLab connection failed: state mismatch. Please try connecting again.');
    return;
  }
  try {
    const resp = await fetch(`${GITLAB_OAUTH_DOMAIN}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GITLAB_CLIENT_ID,
        code,
        grant_type: 'authorization_code',
        redirect_uri: GITLAB_REDIRECT_URI,
        code_verifier: verifier,
      }),
    });
    if (!resp.ok) throw new Error(`GitLab returned ${resp.status}`);
    const tokens = await resp.json();
    localStorage.setItem('gitlab_access_token', tokens.access_token);
    localStorage.setItem('gitlab_refresh_token', tokens.refresh_token || '');
    localStorage.setItem('gitlab_connected', 'true');
    appendMessage('assistant', '✅ GitLab connected.');
  } catch (err) {
    appendMessage('assistant', `⚠️ Could not finish connecting GitLab (${err.message}).`);
  } finally {
    refreshIntegrationsUI();
  }
}


function disconnectGitLab() {
  localStorage.removeItem('gitlab_connected');
  localStorage.removeItem('gitlab_access_token');
  localStorage.removeItem('gitlab_refresh_token');
  localStorage.removeItem('gitlab_username');
  refreshIntegrationsUI();
  appendMessage('assistant', 'GitLab disconnected from this browser.');
}


// ---- File attachments ----------------------------------------------------
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


function renderFileChips() {
  const box = document.getElementById('file-chips');
  box.innerHTML = '';
  box.classList.toggle('hidden', attachments.length === 0);
  attachments.forEach((file, idx) => {
    const chip = document.createElement('div');
    chip.className = 'file-chip flex items-center gap-1.5 text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full pl-3 pr-1.5 py-1';
    chip.innerHTML = `<span class="max-w-[10rem] truncate">📄 ${file.name}</span><span class="text-slate-400">${formatBytes(file.size)}</span>`;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'h-5 w-5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 flex items-center justify-center';
    removeBtn.innerHTML = '&times;';
    removeBtn.onclick = () => { attachments.splice(idx, 1); renderFileChips(); };
    chip.appendChild(removeBtn);
    box.appendChild(chip);
  });
}


function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}


async function handleFileSelect(fileList) {
  for (const file of Array.from(fileList)) {
    if (file.size > MAX_FILE_BYTES) {
      appendMessage('assistant', `⚠️ Skipped **${file.name}** — exceeds the ${formatBytes(MAX_FILE_BYTES)} limit.`);
      continue;
    }
    try {
      const content = await readFileAsText(file);
      attachments.push({ name: file.name, size: file.size, content });
    } catch {
      appendMessage('assistant', `⚠️ Could not read **${file.name}** as text.`);
    }
  }
  document.getElementById('file-input').value = '';
  renderFileChips();
}


// Drag & drop support over the chat area
const dropOverlay = document.getElementById('drop-overlay');
let dragCounter = 0;
['dragenter', 'dragover'].forEach((evt) => {
  document.body.addEventListener(evt, (e) => {
    e.preventDefault();
    dragCounter++;
    dropOverlay.classList.remove('hidden');
    dropOverlay.classList.add('flex');
  });
});
['dragleave', 'drop'].forEach((evt) => {
  document.body.addEventListener(evt, (e) => {
    e.preventDefault();
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) {
      dropOverlay.classList.add('hidden');
      dropOverlay.classList.remove('flex');
    }
  });
});
document.body.addEventListener('drop', (e) => {
  if (e.dataTransfer?.files?.length) handleFileSelect(e.dataTransfer.files);
});


// ---- Chat ---------------------------------------------------------------
const chatEl = () => document.querySelector('#chat > div');
const inputEl = document.getElementById('input');
const sendBtn = document.getElementById('send-btn');


function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}
function handleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}
function scrollToBottom() {
  const chat = document.getElementById('chat');
  chat.scrollTop = chat.scrollHeight;
}
function renderContent(text) {
  return marked.parse(text ?? '');
}
function highlightAll(container) {
  container.querySelectorAll('pre code').forEach((block) => hljs.highlightElement(block));
}


function appendMessage(role, text, files = []) {
  document.getElementById('empty-state')?.remove();
  const wrap = document.createElement('div');
  wrap.className = `msg-enter flex items-start gap-3 ${role === 'user' ? 'justify-end' : 'justify-start'}`;


  const bubble = document.createElement('div');
  if (role === 'user') {
    bubble.className = 'max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tr-sm bg-brand-600 text-white px-4 py-2.5 text-sm sm:text-base whitespace-pre-wrap break-words';
    bubble.textContent = text;
    if (files.length) {
      const fileRow = document.createElement('div');
      fileRow.className = 'flex flex-wrap gap-1.5 mt-2';
      files.forEach((f) => {
        const tag = document.createElement('span');
        tag.className = 'text-[11px] bg-white/15 rounded-full px-2 py-0.5';
        tag.textContent = `📄 ${f.name}`;
        fileRow.appendChild(tag);
      });
      bubble.appendChild(fileRow);
    }
  } else {
    const avatar = document.createElement('div');
    avatar.className = 'h-8 w-8 shrink-0 rounded-full bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-200 flex items-center justify-center text-sm font-semibold';
    avatar.textContent = '🤖';
    wrap.appendChild(avatar);


    bubble.className = 'prose-chat max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tl-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm sm:text-base prose prose-sm dark:prose-invert prose-p:my-1.5 prose-pre:my-2';
    bubble.innerHTML = renderContent(text);
    highlightAll(bubble);
  }
  wrap.appendChild(bubble);
  chatEl().appendChild(wrap);
  scrollToBottom();
  return bubble;
}


// Renders an inline Approve/Deny card for a risky tool call the backend is
// asking the human to confirm (write_file, run_shell, or any github_*/gitlab_*
// repo-management tool — see RISKY_TOOLS in lambda_function.py). This is the
// human-in-the-loop UI referenced throughout the backend; previously `send()`
// silently swallowed `confirmation_required` responses as "No response from
// agent." with no way to ever approve or deny.
function appendConfirmation(actionId, toolName, args) {
  document.getElementById('empty-state')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'msg-enter flex items-start gap-3 justify-start';


  const avatar = document.createElement('div');
  avatar.className = 'h-8 w-8 shrink-0 rounded-full bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-200 flex items-center justify-center text-sm font-semibold';
  avatar.textContent = '⚠️';
  wrap.appendChild(avatar);


  const card = document.createElement('div');
  card.className = 'max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tl-sm bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 px-4 py-3 text-sm';


  const title = document.createElement('p');
  title.className = 'font-medium mb-1';
  title.textContent = `Approve ${toolName}?`;
  card.appendChild(title);


  const pre = document.createElement('pre');
  pre.className = 'bg-slate-100 dark:bg-slate-900 rounded-lg p-2 text-xs overflow-x-auto mb-3';
  pre.textContent = JSON.stringify(args, null, 2);
  card.appendChild(pre);


  const btnRow = document.createElement('div');
  btnRow.className = 'flex gap-2';


  const approveBtn = document.createElement('button');
  approveBtn.className = 'text-xs px-3 py-1.5 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 transition';
  approveBtn.textContent = 'Approve';


  const denyBtn = document.createElement('button');
  denyBtn.className = 'text-xs px-3 py-1.5 rounded-full bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 transition';
  denyBtn.textContent = 'Deny';


  const resolve = async (decision) => {
    approveBtn.disabled = true;
    denyBtn.disabled = true;
    approveBtn.classList.add('opacity-50');
    denyBtn.classList.add('opacity-50');
    await resolvePendingAction(actionId, decision, toolName);
  };
  approveBtn.onclick = () => resolve('approve');
  denyBtn.onclick = () => resolve('deny');


  btnRow.appendChild(approveBtn);
  btnRow.appendChild(denyBtn);
  card.appendChild(btnRow);


  wrap.appendChild(card);
  chatEl().appendChild(wrap);
  scrollToBottom();
}


// Resolves a pending human-in-the-loop action. For gitlab_* tools, attaches
// this browser's locally-stored GitLab token for this one call only — it is
// never written back to localStorage from here and is not persisted by the
// backend (see call_repo_tool() in lambda_function.py). GitHub tools don't
// need this: the backend already looks up the connecting user's stored
// GitHub token itself.
async function resolvePendingAction(actionId, decision, toolName) {
  setLoading(true);
  try {
    const isGitlabTool = toolName && toolName.startsWith('gitlab_');
    const resp = await fetch(LAMBDA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
      },
      body: JSON.stringify({
        action: 'approve_pending',
        action_id: actionId,
        decision,
        gitlab_token: isGitlabTool ? (localStorage.getItem('gitlab_access_token') || null) : null,
      }),
    });
    const result = await resp.json();
    appendMessage('assistant', result.result ?? result.error ?? 'No response from agent.');
  } catch (err) {
    appendMessage('assistant', `⚠️ Could not resolve that action: ${err.message}`);
  } finally {
    setLoading(false);
  }
}


function setLoading(loading) {
  sendBtn.disabled = loading;
  inputEl.disabled = loading;
  document.getElementById('typing-indicator').classList.toggle('hidden', !loading);
}


async function send() {
  const message = inputEl.value.trim();
  if (!message && attachments.length === 0) return;


  const filesForRequest = attachments.map(({ name, content }) => ({ name, content }));
  const filesForDisplay = attachments.map(({ name, size }) => ({ name, size }));


  history.push({ role: 'user', content: message, attachments: filesForRequest });
  appendMessage('user', message || '(sent files only)', filesForDisplay);


  inputEl.value = '';
  autoResize(inputEl);
  attachments = [];
  renderFileChips();
  setLoading(true);


  try {
    const resp = await fetch(LAMBDA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('access_token')}`,
      },
      body: JSON.stringify({
        message,
        history: history.slice(0, -1),
        attachments: filesForRequest,
      }),
    });
    const result = await resp.json();


    if (result.type === 'confirmation_required') {
      appendConfirmation(result.action_id, result.tool_name, result.args);
    } else if (result.type === 'error') {
      appendMessage('assistant', `⚠️ ${result.message ?? 'The agent hit an error.'}`);
    } else {
      const reply = result.result ?? result.error ?? 'No response from agent.';
      history.push({ role: 'assistant', content: reply });
      appendMessage('assistant', reply);
    }
  } catch (err) {
    appendMessage('assistant', `⚠️ Request failed: ${err.message}`);
  } finally {
    setLoading(false);
    inputEl.focus();
  }
}


// ---- Init ----------------------------------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
  const path = window.location.pathname;
  if (path === '/callback/github') {
    await handleGitHubCallback();
  } else if (path === '/callback/gitlab') {
    await handleGitLabCallback();
  } else if (path === '/callback') {
    await handleAuthCallback();
  }
  refreshAuthUI();
  refreshIntegrationsUI();
  inputEl.focus();
});
