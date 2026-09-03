// front-end/js/auth-ui.js
//
// DOM wiring for the signed-in/signed-out header state. Separate from
// auth.js (which only knows about network/session state) so presentation
// logic doesn't leak into the API layer.

import { isSignedIn, getCachedUser, loginWithGoogle, logout } from "./auth.js";
import { resetHistory } from "./chat.js";

export function refreshAuthUI() {
  const signedIn = isSignedIn();
  document.getElementById("auth-signed-out")?.classList.toggle("hidden", signedIn);
  document.getElementById("auth-signed-in")?.classList.toggle("hidden", !signedIn);
  document.getElementById("auth-signed-in")?.classList.toggle("flex", signedIn);

  if (signedIn) {
    const user = getCachedUser();
    const emailEl = document.getElementById("user-email");
    if (emailEl) emailEl.textContent = user?.email ?? "";
  }
}

export async function handleLogout() {
  await logout();
  resetHistory();
  refreshAuthUI();
  window.location.href = "/";
}

export function wireAuthButtons() {
  document.getElementById("google-login-btn")?.addEventListener("click", loginWithGoogle);
  document.getElementById("logout-btn")?.addEventListener("click", handleLogout);
}
