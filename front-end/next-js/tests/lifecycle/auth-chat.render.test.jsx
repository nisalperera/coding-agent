import React, { StrictMode, useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthSession } from "../../lib/auth-session.mjs";

const bridge = vi.hoisted(() => ({
  auth: null, listeners: new Set(), authRequest: vi.fn(), api: vi.fn(), stream: vi.fn(), consume: vi.fn(),
  replace: vi.fn(), lastChat: null, lastAuth: null,
}));
vi.mock("../../lib/auth", () => ({
  authSession: {
    getSnapshot: () => bridge.auth.getSnapshot(),
    subscribe: listener => {
      bridge.listeners.add(listener);
      const unsubscribe = bridge.auth.subscribe(listener);
      return () => { bridge.listeners.delete(listener); unsubscribe(); };
    },
    initialize: () => bridge.auth.initialize(), refresh: () => bridge.auth.refresh(),
    login: args => bridge.auth.login(args), register: args => bridge.auth.register(args),
    logout: () => bridge.auth.logout(),
  },
  loginWithGoogle: vi.fn(),
}));
vi.mock("../../lib/api", () => ({
  apiFetch: (...args) => bridge.api(...args), apiStream: (...args) => bridge.stream(...args),
}));
vi.mock("../../lib/stream", () => ({ consumeAgentStream: (...args) => bridge.consume(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: bridge.replace }) }));
vi.mock("next/link", () => ({ default: ({ children, ...props }) => <a {...props}>{children}</a> }));
vi.mock("../../components/ThemeProvider", () => ({ useTheme: () => ({ dark: false, toggleTheme: () => {} }) }));

import { useAuth } from "../../hooks/useAuth";
import { useChat } from "../../hooks/useChat";
import AuthSessionNotice from "../../components/AuthSessionNotice";
import LoginPage from "../../app/login/page";
import RegisterPage from "../../app/register/page";

const defer = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const statusError = status => Object.assign(new Error(`HTTP ${status}`), { status });
let principal, verificationFailure, logoutFailure, passwordGate, consoleErrors;
function HookView({ label = "view", effects }) {
  const auth = useAuth();
  const chat = useChat();
  // Record only committed API values, never render-phase external mutations.
  useEffect(() => { bridge.lastChat = chat; bridge.lastAuth = auth; });
  useEffect(() => {
    effects?.push("setup");
    return () => { effects?.push("cleanup"); };
  }, [effects]);
  return <section>
    <span data-testid="route">{label}</span>
    <span data-testid="auth-status">{auth.status}</span>
    <span data-testid="chat-loading">{String(chat.loading)}</span>
    <pre data-testid="chat-state">{JSON.stringify({ conversations: chat.conversations, messages: chat.messages })}</pre>
  </section>;
}
function mount(element) { return render(<StrictMode>{element}</StrictMode>); }
async function signedIn(id = "a") {
  principal = id;
  await act(async () => { await bridge.auth.login({ email: `${id}@example.test`, password: "test-password-only" }); });
}
async function ready() {
  await waitFor(() => expect(screen.getByTestId("auth-status").textContent).toBe("authenticated"));
  await waitFor(() => expect(bridge.lastChat?.conversationsLoading).toBe(false));
}
function defaultApi(path, options = {}) {
  if (options.method === "POST") return Promise.resolve({ id: options.body.conversation_id, status: "active" });
  if (options.method === "DELETE") return Promise.resolve({});
  if (path === "/v1/conversations") return Promise.resolve({ conversations: [{ id: `conversation-${principal}`, status: "active" }] });
  return Promise.resolve({ id: path.split("/").at(-1), messages: [
    { id: "stored", role: "assistant", content: [{ type: "text", text: `private-${principal}` }] },
  ] });
}
beforeEach(() => {
  principal = "a"; verificationFailure = null; logoutFailure = false; passwordGate = null;
  bridge.lastChat = null; bridge.lastAuth = null; bridge.listeners.clear();
  bridge.authRequest.mockReset(); bridge.api.mockReset(); bridge.stream.mockReset(); bridge.consume.mockReset(); bridge.replace.mockReset();
  bridge.authRequest.mockImplementation(async path => {
    if (path === "/v1/auth/me") { if (verificationFailure) throw statusError(verificationFailure); return { user: { user_id: principal } }; }
    if (path === "/v1/auth/logout") { if (logoutFailure) throw new Error("network unavailable"); return {}; }
    if (passwordGate) await passwordGate.promise;
    return {};
  });
  bridge.auth = createAuthSession({ request: bridge.authRequest });
  bridge.api.mockImplementation(defaultApi);
  bridge.stream.mockResolvedValue({ body: { cancel: vi.fn().mockResolvedValue(undefined) } });
  bridge.consume.mockImplementation(async (_response, handlers) => { handlers.onToken("answer"); handlers.onDone(); });
  consoleErrors = [];
  vi.spyOn(console, "error").mockImplementation((...args) => { consoleErrors.push(args.map(String).join(" ")); });
});
afterEach(async () => {
  await act(async () => { cleanup(); });
  expect(bridge.listeners.size).toBe(0);
  expect(consoleErrors).toEqual([]);
});

describe("actual hook and component lifecycle under root StrictMode", () => {
  it("replays effects while coalescing canonical auth initialization", async () => {
    const effects = [];
    const view = mount(<HookView effects={effects} />);
    await ready();
    expect(effects).toEqual(["setup", "cleanup", "setup"]);
    expect(bridge.authRequest.mock.calls.filter(([p]) => p === "/v1/auth/me")).toHaveLength(1);
    view.unmount();
    expect(effects).toEqual(["setup", "cleanup", "setup", "cleanup"]);
    expect(bridge.listeners.size).toBe(0);
  });
  it("multiple mounted auth consumers share initialization and clean subscriptions", async () => {
    function Consumer() { const a = useAuth(); return <span>{a.status}</span>; }
    const view = mount(<><Consumer /><Consumer /></>);
    await waitFor(() => expect(screen.getAllByText("authenticated")).toHaveLength(2));
    expect(bridge.authRequest.mock.calls.filter(([p]) => p === "/v1/auth/me")).toHaveLength(1);
    expect(bridge.listeners.size).toBe(2);
    view.unmount(); expect(bridge.listeners.size).toBe(0);
  });
  it("StrictMode cancels discarded bootstrap reads without posting a conversation", async () => {
    await bridge.auth.initialize();
    const first = defer(); let indexes = 0;
    bridge.api.mockImplementation((path, options = {}) => {
      if (path === "/v1/conversations" && !options.method && ++indexes === 1) return first.promise;
      return defaultApi(path, options);
    });
    mount(<HookView />); await ready();
    const indexesSent = bridge.api.mock.calls.filter(([p, o]) => p === "/v1/conversations" && !o?.method);
    expect(indexesSent.length).toBeGreaterThanOrEqual(2);
    expect(indexesSent[0][1].signal.aborted).toBe(true);
    await act(async () => { first.resolve({ conversations: [{ id: "stale-strict-replay" }] }); await first.promise; });
    expect(screen.getByTestId("chat-state").textContent).not.toContain("stale-strict-replay");
    expect(bridge.api.mock.calls.some(([,o]) => o?.method === "POST")).toBe(false);
  });
  it("rendered A to B replacement removes A messages and rejects delayed index", async () => {
    mount(<HookView />); await ready();
    expect(screen.getByTestId("chat-state").textContent).toContain("private-a");
    const pending = defer(); bridge.api.mockImplementationOnce(() => pending.promise);
    let old; act(() => { old = bridge.lastChat.refreshConversationIndex(); });
    await signedIn("b"); await ready();
    await act(async () => { pending.resolve({ conversations: [{ id: "late-a" }] }); await old; });
    expect(screen.getByTestId("chat-state").textContent).toContain("private-b");
    expect(screen.getByTestId("chat-state").textContent).not.toContain("private-a");
    expect(screen.getByTestId("chat-state").textContent).not.toContain("late-a");
  });
  it("batched A anonymous A transition does not revive old account operations", async () => {
    mount(<HookView />); await ready();
    const pending = defer(); bridge.api.mockImplementationOnce(() => pending.promise);
    let old; act(() => { old = bridge.lastChat.refreshConversationIndex(); });
    await act(async () => {
      await bridge.auth.logout();
      await bridge.auth.login({ email: "a@example.test", password: "test-password-only" });
    });
    await ready();
    await act(async () => { pending.resolve({ conversations: [{ id: "old-aba-response" }] }); await old; });
    expect(screen.getByTestId("chat-state").textContent).not.toContain("old-aba-response");
    expect(screen.getByTestId("chat-state").textContent).toContain("private-a");
  });
  it("navigation unmount aborts stream and late callbacks cannot affect remounted chat", async () => {
    const pending = defer(); let handlers;
    bridge.consume.mockImplementationOnce(async (_r, h) => { handlers = h; await pending.promise; h.onToken("OLD-ROUTE"); h.onDone(); });
    const view = mount(<HookView key="chat" label="chat" />); await ready();
    let sending; act(() => { sending = bridge.lastChat.send("draft", []); });
    await waitFor(() => expect(handlers).toBeDefined());
    const signal = bridge.stream.mock.calls[0][2].signal;
    view.rerender(<StrictMode><div>different route</div></StrictMode>);
    expect(signal.aborted).toBe(true); expect(bridge.listeners.size).toBe(0);
    view.rerender(<StrictMode><HookView key="new-chat" label="new-chat" /></StrictMode>); await ready();
    await act(async () => { pending.resolve(); await sending; });
    expect(screen.getByTestId("chat-state").textContent).not.toContain("OLD-ROUTE");
    expect(screen.getByTestId("chat-loading").textContent).toBe("false");
  });
  it("unmount during creation prevents the later stream request", async () => {
    const pending = defer();
    bridge.api.mockImplementation((path, options = {}) => path === "/v1/conversations" && !options.method
      ? Promise.resolve({ conversations: [] }) : options.method === "POST" ? pending.promise : defaultApi(path, options));
    const view = mount(<HookView />); await ready();
    let sending; act(() => { sending = bridge.lastChat.send("draft", []); });
    await waitFor(() => expect(bridge.api.mock.calls.some(([,o]) => o?.method === "POST")).toBe(true));
    const createCall = bridge.api.mock.calls.find(([,o]) => o?.method === "POST"); view.unmount();
    expect(createCall[1].signal.aborted).toBe(true);
    await act(async () => { pending.resolve({ id: createCall[1].body.conversation_id }); await sending; });
    expect(bridge.stream).not.toHaveBeenCalled();
  });
  it("late old-stream cleanup cannot clear a new route's busy indicator", async () => {
    const old = defer(), newer = defer(); let started = 0;
    bridge.consume.mockImplementation(async (_r,h) => {
      const n = ++started; await (n === 1 ? old.promise : newer.promise); h.onToken(n === 1 ? "OLD" : "NEW"); h.onDone();
    });
    const view = mount(<HookView key="old" />); await ready();
    let p, q; act(() => { p = bridge.lastChat.send("old", []); }); await waitFor(() => expect(started).toBe(1));
    view.rerender(<StrictMode><HookView key="new" /></StrictMode>); await ready();
    act(() => { q = bridge.lastChat.send("new", []); }); await waitFor(() => expect(started).toBe(2));
    await act(async () => { old.resolve(); await p; });
    expect(screen.getByTestId("chat-loading").textContent).toBe("true");
    await act(async () => { newer.resolve(); await q; });
    expect(screen.getByTestId("chat-loading").textContent).toBe("false");
    expect(screen.getByTestId("chat-state").textContent).not.toContain('"text":"OLD"');
  });
  it("renders verification failure and recovers through the actual retry button", async () => {
    verificationFailure = 500;
    mount(<AuthSessionNotice />);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Session verification is unavailable"));
    verificationFailure = null;
    fireEvent.click(screen.getByRole("button", { name: "Retry session verification" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(bridge.auth.getSnapshot().status).toBe("authenticated");
  });
  it("renders uncertain logout and retries logout rather than session verification", async () => {
    mount(<AuthSessionNotice />);
    await waitFor(() => expect(bridge.auth.getSnapshot().status).toBe("authenticated"));
    logoutFailure = true; await act(async () => { await bridge.auth.logout(); });
    expect(screen.getByRole("alert").textContent).toContain("server session may still be active");
    const meBefore = bridge.authRequest.mock.calls.filter(([p]) => p === "/v1/auth/me").length;
    logoutFailure = false; fireEvent.click(screen.getByRole("button", { name: "Retry logout" }));
    await waitFor(() => expect(bridge.auth.getSnapshot().logoutStatus).toBe("confirmed"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(bridge.authRequest.mock.calls.filter(([p]) => p === "/v1/auth/me")).toHaveLength(meBefore);
  });
});

function fillAuthForm(kind) {
  if (kind === "register") fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Test User" } });
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "test@example.test" } });
  fireEvent.change(screen.getByLabelText(/^Password/, { selector: 'input[type="password"]' }), { target: { value: "test-password-only" } });
  if (kind === "register") fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "test-password-only" } });
  fireEvent.submit(screen.getByRole("button", { name: kind === "login" ? "Sign in" : "Create account", exact: true }).closest("form"));
}
for (const kind of ["login", "register"]) {
  const Page = kind === "login" ? LoginPage : RegisterPage;
  describe(`${kind} page mounted callbacks`, () => {
    it("navigates only after current verified success", async () => {
      mount(<Page />); await waitFor(() => expect(bridge.auth.getSnapshot().status).toBe("authenticated"));
      fillAuthForm(kind);
      await waitFor(() => expect(bridge.replace.mock.calls).toEqual([["/"]]));
    });
    it("does not navigate when the page unmounts before completion", async () => {
      const view = mount(<Page />); await waitFor(() => expect(bridge.auth.getSnapshot().status).toBe("authenticated"));
      passwordGate = defer(); fillAuthForm(kind);
      await waitFor(() => expect(bridge.auth.getSnapshot().operationBusy).toBe(true));
      view.unmount();
      await act(async () => { passwordGate.resolve(); await bridge.auth.refresh(); });
      expect(bridge.replace).not.toHaveBeenCalled();
    });
    it("does not navigate or show false success when logout supersedes submission", async () => {
      mount(<Page />); await waitFor(() => expect(bridge.auth.getSnapshot().status).toBe("authenticated"));
      passwordGate = defer(); fillAuthForm(kind);
      await waitFor(() => expect(bridge.auth.getSnapshot().operationBusy).toBe(true));
      let loggingOut; act(() => { loggingOut = bridge.auth.logout(); });
      await act(async () => { passwordGate.resolve(); await loggingOut; });
      expect(bridge.replace).not.toHaveBeenCalled();
      expect(bridge.auth.getSnapshot().status).toBe("anonymous");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByRole("button", { name: kind === "login" ? "Sign in" : "Create account", exact: true }).disabled).toBe(false);
    });
  });
}
