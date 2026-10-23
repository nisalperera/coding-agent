let nextMessageId = 1;

function makeMessageId() {
    nextMessageId += 1;
    return `local-${nextMessageId}`;
}

function makeConversationId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }

    return `conversation-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;
}

function now() {
    return Date.now();
}

function createLocalConversation() {
    const timestamp = now();

    return {
        id: makeConversationId(),
        title: "New conversation",
        client: "web",
        status: "active",
        createdAt: timestamp,
        updatedAt: timestamp,
        lastMessageAt: timestamp,
        messages: [],
        history: [],
        loaded: true,
        loading: false,
        creating: false,
    };
}

function normalizeConversationSummary(conversation) {
    return {
        id: conversation.id,
        title: conversation.title || "New conversation",
        client: conversation.client || "web",
        status: conversation.status || "active",
        createdAt: conversation.created_at ?? conversation.createdAt ?? now(),
        updatedAt: conversation.updated_at ?? conversation.updatedAt ?? now(),
        lastMessageAt:
            conversation.last_message_at ??
            conversation.lastMessageAt ??
            conversation.updated_at ??
            conversation.updatedAt ??
            now(),
        messages: [],
        history: [],
        loaded: false,
        loading: false,
        creating: false,
    };
}

function getConversationTitle(message) {
    const normalized = String(message ?? "")
        .replace(/\s+/g, " ")
        .trim();

    if (!normalized) {
        return "New conversation";
    }

    const maxLength = 56;

    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function getTextFromContent(content) {
    if (!Array.isArray(content)) {
        return "";
    }

    return content
        .filter((part) => part?.type === "text")
        .map((part) => part.text ?? "")
        .filter(Boolean)
        .join("\n");
}

function getFilesFromContent(content) {
    if (!Array.isArray(content)) {
        return [];
    }

    return content
        .filter((part) => part?.type === "file" || part?.type === "image")
        .map((part) => ({
            name: part.filename || "Attachment",
            size: part.size_bytes ?? null,
            storageKey: part.storage_key ?? null,
            mimeType: part.mime_type ?? null,
        }));
}

function toUiMessage(message) {
    const text = getTextFromContent(message.content);
    const files = getFilesFromContent(message.content);

    return {
        id: message.id ?? message.message_id ?? makeMessageId(),
        role: message.role,
        text,
        files,
        error: message.status === "failed",
        retryable: false,
        persisted: true,
        createdAt: message.created_at ?? message.createdAt ?? now(),
    };
}

function toHistoryEntry(message) {
    if (!["system", "user", "assistant", "tool"].includes(message.role)) {
        return null;
    }

    const content = getTextFromContent(message.content);

    if (!content && message.role !== "tool") {
        return null;
    }

    const entry = {
        role: message.role,
        content,
    };

    if (message.tool_call_id) {
        entry.tool_call_id = message.tool_call_id;
    }

    if (message.tool_name) {
        entry.name = message.tool_name;
    }

    return entry;
}

function fromConversationDetail(detail) {
    const rawMessages = Array.isArray(detail.messages) ? detail.messages : [];

    return {
        id: detail.id,
        title: detail.title || "New conversation",
        client: detail.client || "web",
        status: detail.status || "active",
        createdAt: detail.created_at ?? now(),
        updatedAt: detail.updated_at ?? now(),
        lastMessageAt:
            detail.last_message_at ??
            detail.updated_at ??
            detail.created_at ??
            now(),
        messages: rawMessages.map(toUiMessage),
        history: rawMessages.map(toHistoryEntry).filter(Boolean),
        loaded: true,
        loading: false,
        creating: false,
    };
}

function replaceConversation(conversations, conversationId, updater) {
    return conversations.map((conversation) =>
        conversation.id === conversationId
            ? updater(conversation)
            : conversation,
    );
}

function orderConversations(conversations) {
    return [...conversations].sort(
        (left, right) =>
            Number(right.lastMessageAt ?? right.updatedAt ?? 0) -
            Number(left.lastMessageAt ?? left.updatedAt ?? 0),
    );
}

// Browser chat state. Server ownership and mutation idempotency remain backend concerns.
const EMPTY = Object.freeze({ conversations: [], activeConversationId: null, messages: [],
  loading: false, progress: null, conversationsLoading: false, conversationsError: null });
const stale = () => Object.assign(new Error("Stale chat operation"), { stale: true });
const messageOf = error => error?.message || String(error);
const retryableError = error => error?.status == null || [408, 429].includes(Number(error.status)) || Number(error.status) >= 500;

export function createChatController({ request, stream, consume, auth, uuid }) {
  let snapshot = EMPTY;
  let scope = null;
  let generation = 0;
  let mounted = false;
  let unsubscribe = null;
  let busy = null;
  let actionsGeneration = -1, actions = null;
  const lanes = new Map();
  const listeners = new Set();
  const stamp = () => {
    const s = auth.getSnapshot();
    return { status: s.status, identityKey: s.identityKey, user: s.user };
  };
  const same = (a, b) => a && b && a.status === b.status && a.identityKey === b.identityKey && a.user === b.user;
  const current = token => mounted && token.generation === generation &&
    lanes.get(token.lane) === token && same(scope, stamp()) && !token.controller.signal.aborted;
  const notify = () => { for (const listener of listeners) listener(); };
  function publish(patch) {
    snapshot = { ...snapshot, ...patch };
    snapshot.messages = snapshot.conversations.find(c => c.id === snapshot.activeConversationId)?.messages ?? [];
    notify();
  }
  function invalidate() {
    generation += 1;
    for (const token of lanes.values()) token.controller.abort();
    lanes.clear(); busy = null;
  }
  function begin(lane) {
    lanes.get(lane)?.controller.abort();
    const token = { lane, generation, controller: new AbortController() };
    lanes.set(lane, token);
    return token;
  }
  function check(token) { if (!current(token)) throw stale(); }
  async function call(token, path, options = {}) {
    check(token);
    const result = await request(path, { ...options, signal: token.controller.signal });
    check(token);
    return result;
  }
  function finish(token) {
    if (lanes.get(token.lane) === token) lanes.delete(token.lane);
  }
  function update(token, id, fn) {
    if (!current(token)) return;
    publish({ conversations: orderConversations(replaceConversation(snapshot.conversations, id, fn)) });
  }
  function append(token, id, role, text, extra = {}) {
    const messageId = makeMessageId();
    update(token, id, c => ({ ...c, updatedAt: now(), lastMessageAt: now(),
      messages: [...c.messages, { id: messageId, role, text, ...extra, createdAt: now() }] }));
    return messageId;
  }
  function patchMessage(token, id, messageId, patch) {
    update(token, id, c => ({ ...c, messages: c.messages.map(m => m.id === messageId ? { ...m, ...patch } : m) }));
  }
  function available() { return mounted && same(scope, stamp()) && ["authenticated", "anonymous"].includes(scope?.status); }
  function newLocal() {
    const c = createLocalConversation();
    if (uuid) c.id = uuid();
    return { ...c, persisted: false };
  }
  function acquire() {
    if (!available() || busy || snapshot.conversationsLoading) return null;
    const token = begin("mutation"); busy = token;
    publish({ loading: true, progress: null });
    return token;
  }
  function release(token) {
    if (current(token) && busy === token) {
      busy = null; publish({ loading: false, progress: null });
    }
    finish(token);
  }
  async function ensure(token, id) {
    check(token);
    let c = snapshot.conversations.find(item => item.id === id);
    if (!c) throw new Error("Conversation was not found locally.");
    if (scope.status !== "authenticated" || c.persisted) return c;
    const created = await call(token, "/v1/conversations", { method: "POST", body: {
      conversation_id: c.id, title: c.title, client: "web",
    } });
    if (!created || created.id !== id) throw new Error("Invalid conversation creation response.");
    update(token, id, item => ({ ...item, ...normalizeConversationSummary(created),
      messages: item.messages, history: item.history, loaded: item.loaded, persisted: true }));
    c = snapshot.conversations.find(item => item.id === id);
    return c;
  }
  async function loadWith(token, id, force = false) {
    check(token);
    const c = snapshot.conversations.find(item => item.id === id);
    if (!c || scope.status !== "authenticated" || (c.loaded && !force)) return c ?? null;
    update(token, id, item => ({ ...item, loading: true }));
    try {
      const detail = await call(token, `/v1/conversations/${encodeURIComponent(id)}`);
      if (!detail || detail.id !== id) throw new Error("Invalid conversation response.");
      const normalized = { ...fromConversationDetail(detail), persisted: true };
      update(token, id, () => normalized);
      return normalized;
    } catch (error) {
      if (current(token)) update(token, id, item => ({ ...item, loading: false }));
      throw error;
    }
  }
  async function refreshConversationIndex() {
    if (!available() || scope.status !== "authenticated" || busy) return [];
    lanes.get("detail")?.controller.abort();
    const token = begin("index");
    publish({ conversationsLoading: true, conversationsError: null });
    try {
      const result = await call(token, "/v1/conversations");
      if (!Array.isArray(result?.conversations)) throw new Error("Invalid conversation index response.");
      const old = new Map(snapshot.conversations.map(c => [c.id, c]));
      let conversations = result.conversations.filter(c => c.status !== "deleted").map(raw => {
        const c = normalizeConversationSummary(raw), local = old.get(c.id);
        return { ...c, ...(local ? { messages: local.messages, history: local.history, loaded: local.loaded } : {}), persisted: true };
      });
      if (!conversations.length) conversations = [newLocal()];
      conversations = orderConversations(conversations);
      const id = conversations.some(c => c.id === snapshot.activeConversationId) ? snapshot.activeConversationId : conversations[0].id;
      publish({ conversations, activeConversationId: id });
      await loadWith(token, id);
      return conversations;
    } catch (error) {
      if (current(token)) publish({ conversationsError: messageOf(error) });
      return [];
    } finally {
      if (current(token)) publish({ conversationsLoading: false });
      finish(token);
    }
  }
  function syncAuth() {
    const next = stamp();
    if (same(scope, next)) return;
    invalidate(); scope = next;
    const local = newLocal();
    publish({ ...EMPTY, conversations: [local], activeConversationId: local.id });
    if (scope.status === "authenticated") void refreshConversationIndex();
  }
  async function startNewConversation() {
    const token = acquire(); if (!token) return null;
    try {
      const c = newLocal();
      publish({ conversations: [c, ...snapshot.conversations], activeConversationId: c.id });
      await ensure(token, c.id);
      return c.id;
    } catch (error) {
      if (current(token)) publish({ conversationsError: `Could not create a new conversation: ${messageOf(error)}` });
      return null;
    } finally { release(token); }
  }
  async function selectConversation(id) {
    if (!available() || busy || snapshot.conversationsLoading || !snapshot.conversations.some(c => c.id === id)) return;
    const token = begin("detail");
    publish({ activeConversationId: id, progress: null });
    try { await loadWith(token, id); }
    catch (error) { if (current(token)) publish({ conversationsError: messageOf(error) }); }
    finally { finish(token); }
  }
  async function deleteConversation(id) {
    const token = acquire(); if (!token) return false;
    try {
      const c = snapshot.conversations.find(item => item.id === id);
      if (!c) return false;
      if (scope.status === "authenticated" && c.persisted) await call(token,
        `/v1/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
      check(token);
      let conversations = snapshot.conversations.filter(item => item.id !== id);
      if (!conversations.length) conversations = [newLocal()];
      const activeConversationId = snapshot.activeConversationId === id ? conversations[0].id : snapshot.activeConversationId;
      publish({ conversations, activeConversationId });
      await loadWith(token, activeConversationId);
      return true;
    } catch (error) {
      if (current(token)) publish({ conversationsError: `Could not delete or refresh the conversation: ${messageOf(error)}` });
      return false;
    } finally { release(token); }
  }
  async function send(message, attachments = [], retry = null) {
    if ((!message && !attachments.length) || snapshot.conversationsLoading) return;
    const token = acquire(); if (!token) return;
    const id = snapshot.activeConversationId;
    let answerId = null, answerText = "", terminal = null;
    let retryPayload = null;
    try {
      let c = await ensure(token, id);
      if (!c.loaded) c = await loadWith(token, id);
      check(token);
      const files = attachments.map(({ name, content }) => ({ name, content }));
      const turnId = retry?.turnId ?? makeMessageId();
      const history = retry ? retry.history : c.history;
      retryPayload = { message, attachments: files, turnId, history: history.map(entry => ({ ...entry })) };
      if (retry) {
        // Never rewrite an intervening user turn while retrying an older failure.
        if (c.history.at(-1)?.localTurnId !== turnId) throw new Error("Only the latest failed turn can be retried.");
        update(token, id, item => ({ ...item, messages: item.messages.filter(m => m.role === "user" || (m.id !== retry.failedMessageId && m.turnId !== turnId)) }));
      } else {
        update(token, id, item => ({ ...item, title: item.title === "New conversation" ? getConversationTitle(message) : item.title,
          history: [...item.history, { role: "user", content: message, attachments: files, localTurnId: turnId }] }));
        append(token, id, "user", message || "(sent files only)", { turnId, files: attachments.map(({ name, size }) => ({ name, size })) });
      }
      check(token);
      const response = await stream("/v1/chat/completions", { conversation_id: id, message,
        history: history.map(entry => { const clean = { ...entry }; delete clean.localTurnId; return clean; }), attachments: files,
      }, { signal: token.controller.signal });
      if (!current(token)) { void response?.body?.cancel().catch(() => {}); return; }
      const live = () => current(token) && terminal === null;
      const ensureAnswer = () => {
        if (answerId === null) answerId = append(token, id, "assistant", "", { turnId });
      };
      const fail = event => {
        if (!live()) return;
        terminal = "error";
        if (answerId) patchMessage(token, id, answerId, { error: true, retryable: false });
        append(token, id, "assistant", event.message || "The agent hit an error.", {
          turnId, error: true, retryable: retryableError(event), retryPayload,
        });
        publish({ progress: null });
      };
      await consume(response, {
        onProgress(event) { if (live()) publish({ progress: { message: event.message ?? "Working...",
          percent: event.percent != null && Number.isFinite(Number(event.percent)) ? Number(event.percent) : null } }); },
        onAnswerStart() { if (live()) { ensureAnswer(); publish({ progress: null }); } },
        onToken(text) { if (live()) { ensureAnswer(); answerText += text; patchMessage(token, id, answerId, { text: answerText }); } },
        onError(event) { fail({ ...event, status: event.status ?? event.status_code }); },
        onConfirmation(event) {
          if (!live()) return; terminal = "confirmation";
          append(token, id, "confirmation", "", { turnId, toolName: event.tool_name, args: event.args,
            actionId: event.action_id, resolved: false, resolutionStatus: "idle" });
          publish({ progress: null });
        },
        onFallback(event) {
          if (!live()) return;
          if (event.error) { fail({ message: String(event.error), status: event.status }); return; }
          terminal = "fallback";
          const text = String(event.result ?? "No response from agent.");
          if (answerId) patchMessage(token, id, answerId, { text });
          else answerId = append(token, id, "assistant", text, { turnId });
          answerText = text;
        },
        onDone() { if (live()) { terminal = "done"; publish({ progress: null }); } },
      });
      check(token);
      if (terminal === "done" || terminal === "fallback") {
        if (answerId) update(token, id, item => ({ ...item, history: [...item.history, { role: "assistant", content: answerText }] }));
        else if (terminal === "done") append(token, id, "assistant", "No response from agent.", { turnId });
      } else if (!terminal) {
        fail({ message: "The response stream ended without a terminal event. The server outcome is unknown." });
      }
    } catch (error) {
      if (current(token) && !terminal) {
        if (answerId) patchMessage(token, id, answerId, { error: true, retryable: false });
        append(token, id, "assistant", `Request failed: ${messageOf(error)}`, {
          error: true, retryable: Boolean(retryPayload) && retryableError(error), retryPayload,
          turnId: retryPayload?.turnId,
        });
      }
    } finally { release(token); }
  }
  async function retryFailedMessage(messageId) {
    if (!available() || busy) return;
    const c = snapshot.conversations.find(item => item.id === snapshot.activeConversationId);
    const failed = c?.messages.find(m => m.id === messageId);
    if (!failed?.retryable || !failed.retryPayload) return;
    if (c.history.at(-1)?.localTurnId !== failed.retryPayload.turnId) {
      publish({ conversationsError: "Only the latest failed turn can be retried. Start a new message instead." }); return;
    }
    await send(failed.retryPayload.message, failed.retryPayload.attachments,
      { ...failed.retryPayload, failedMessageId: messageId });
  }
  async function resolveConfirmation(messageId, actionId, decision) {
    const token = acquire(); if (!token) return;
    const id = snapshot.activeConversationId;
    try {
      const c = snapshot.conversations.find(item => item.id === id);
      const card = c?.messages.find(m => m.id === messageId && m.role === "confirmation");
      if (!card || card.actionId !== actionId || card.resolved || ![undefined, "idle", "failed"].includes(card.resolutionStatus)) return;
      if (!["approve", "deny"].includes(decision)) return;
      patchMessage(token, id, messageId, { resolutionStatus: "pending", resolutionError: null });
      publish({ progress: { message: "Submitting your request...", percent: null } });
      try {
        const result = await call(token, "/v1/actions", { method: "POST", body: {
          action: "action_pending", action_id: actionId, decision,
        } });
        if (!result || typeof result !== "object" || !Object.hasOwn(result, "result") || result.error) {
          throw new Error("The action response did not confirm an outcome.");
        }
        patchMessage(token, id, messageId, { resolved: true, resolutionStatus: "confirmed" });
        const reply = typeof result.result === "string" ? result.result : JSON.stringify(result.result);
        append(token, id, "assistant", reply ?? "Action completed.");
        update(token, id, item => ({ ...item, history: [...item.history, { role: "assistant", content: reply ?? "Action completed." }] }));
      } catch (error) {
        if (!current(token)) return;
        // Transport, server, parse, timeout and ambiguous failures are never replayed automatically.
        const rejected = [400, 401, 403, 404, 422, 429].includes(Number(error.status));
        patchMessage(token, id, messageId, { resolved: false,
          resolutionStatus: rejected ? "failed" : "uncertain",
          resolutionError: rejected ? `Submission rejected: ${messageOf(error)}` :
            "The server outcome could not be confirmed. Do not resubmit until it has been reconciled." });
      }
    } finally { release(token); }
  }
  const api = {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => mounted && same(scope, stamp()) ? snapshot : EMPTY,
    getServerSnapshot: () => EMPTY,
    start() {
      if (mounted) return;
      mounted = true; scope = null;
      unsubscribe = auth.subscribe(syncAuth); syncAuth();
    },
    stop() { mounted = false; unsubscribe?.(); unsubscribe = null; invalidate(); scope = null; snapshot = EMPTY; },
    getActions() {
      if (actionsGeneration !== generation || !actions) {
        const captured = generation;
        const names = ["send", "retryFailedMessage", "resolveConfirmation", "deleteConversation", "startNewConversation", "selectConversation", "refreshConversationIndex", "appendMessage"];
        actions = Object.fromEntries(names.map(name => [name, (...args) => {
          if (captured !== generation || !available()) return null;
          return api[name](...args);
        }]));
        actionsGeneration = generation;
      }
      return actions;
    },
    send, retryFailedMessage, resolveConfirmation, deleteConversation, startNewConversation, selectConversation, refreshConversationIndex,
    appendMessage(role, text, extra = {}) {
      if (!available()) return null;
      const token = begin("notice");
      const id = append(token, snapshot.activeConversationId, role, text, extra);
      finish(token); return id;
    },
  };
  return api;
}
