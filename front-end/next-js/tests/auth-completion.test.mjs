import test from "node:test";
import assert from "node:assert/strict";
import { createAuthCompletionGuard } from "../lib/auth-completion.mjs";
const user = Object.freeze({ user_id: "a" });
const state = { status: "authenticated", user, identityKey: "a" };
test("verified current result completes", () => {
  const g = createAuthCompletionGuard(); g.activate();
  assert.equal(g.canComplete(g.begin(), user, state), true);
});
test("superseded null result never completes", () => {
  const g = createAuthCompletionGuard(); g.activate(); const t = g.begin();
  assert.equal(g.canComplete(t, null, state), false);
});
test("new submission invalidates earlier callbacks", () => {
  const g = createAuthCompletionGuard(); g.activate(); const t = g.begin(); g.begin();
  assert.equal(g.isCurrent(t), false);
  assert.equal(g.canComplete(t, user, state), false);
});
test("unmount and Strict Mode setup cannot revive old callbacks", () => {
  const g = createAuthCompletionGuard(); g.activate(); const t = g.begin();
  g.deactivate(); assert.equal(g.isCurrent(t), false); g.activate();
  assert.equal(g.canComplete(t, user, state), false);
  assert.equal(g.canComplete(g.begin(), user, state), true);
});
test("identity replacement, logout and reverified user object reject old result", () => {
  const g = createAuthCompletionGuard(); g.activate(); const t = g.begin();
  for (const next of [
    { status: "anonymous", user: null, identityKey: null },
    { status: "authenticated", user: { user_id: "b" }, identityKey: "b" },
    { ...state, user: { user_id: "a" } },
  ]) assert.equal(g.canComplete(t, user, next), false);
});
