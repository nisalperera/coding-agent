// front-end/js/pkce.js
//
// Shared PKCE (Proof Key for Code Exchange, RFC 7636) helpers, used only by
// the GitLab "public client" connect flow (integrations.js). Google login
// no longer needs this in the browser — the backend performs PKCE itself
// against Google (see auth.js) — but GitLab's browser-only, secretless
// OAuth app still requires it here.

function base64Url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function generateRandomToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64Url(array);
}

export async function generateCodeChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(digest);
}
