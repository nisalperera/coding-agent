export const INITIAL_AUTH = Object.freeze({
  status: "loading", user: null, identityKey: null,
  error: null, logoutStatus: "idle", operationBusy: false,
});

export function safeUser(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = value.user_id ?? value.id;
  if (typeof id !== "string" || !id.trim()) return null;
  const result = { user_id: id };
  for (const key of ["id", "name", "email", "picture", "avatar_url"]) {
    if (typeof value[key] === "string") result[key] = value[key];
  }
  return Object.freeze(result);
}

export function createAuthSession({ request, clearSettings = () => {}, hydrateSettings = () => {}, writeUser = () => {} }) {
  let snapshot = INITIAL_AUTH;
  let epoch = 0;
  let pending = null;
  let initialized = false;
  let mutationTail = null;
  const listeners = new Set();
  const emit = (next) => {
    snapshot = Object.freeze({ ...snapshot, ...next });
    for (const listener of listeners) listener();
  };
  const reset = () => { clearSettings(); writeUser(null); };
  const accept = (data) => {
    const user = safeUser(data?.user ?? data);
    if (!user) throw new Error("Invalid authentication response.");
    if (snapshot.identityKey !== user.user_id) clearSettings();
    hydrateSettings(data?.settings ?? {});
    writeUser(user);
    emit({ status: "authenticated", user, identityKey: user.user_id, error: null, logoutStatus: "idle" });
    return user;
  };
  function verify(ticket = epoch) {
    if (ticket !== epoch) return Promise.resolve(null);
    if (pending?.ticket === ticket) return pending.task;
    const task = (async () => {
      try {
        const data = await request("/v1/auth/me", { method: "GET" });
        if (ticket !== epoch) return null;
        return accept(data);
      } catch (error) {
        if (ticket !== epoch) return null;
        reset();
        emit({ status: error?.status === 401 ? "anonymous" : "error", user: null, identityKey: null,
          error: error?.status === 401 ? null : "Session verification is unavailable. Retry before using account features." });
        return null;
      }
    })();
    pending = { ticket, task };
    const cleanup = () => { if (pending?.task === task) pending = null; };
    void task.then(cleanup, cleanup);
    return task;
  }
  function refresh() {
    if (mutationTail) return mutationTail.then(() => snapshot.user, () => snapshot.user);
    return verify();
  }
  function enqueueMutation(kind, run) {
    const ticket = ++epoch;
    initialized = true;
    pending = null;
    reset();
    emit({ status: kind === "logout" ? "anonymous" : "loading", user: null,
      identityKey: null, error: null, logoutStatus: kind === "logout" ? "pending" : "idle", operationBusy: true });
    const predecessor = mutationTail;
    const task = (async () => {
      if (predecessor) {
        try { await predecessor; } catch { /* Keep the queue usable after failure. */ }
      }
      if (ticket !== epoch) return kind === "logout" ? { confirmed: false, superseded: true } : null;
      return run(ticket);
    })();
    mutationTail = task;
    const cleanup = () => {
      if (mutationTail === task) {
        mutationTail = null;
        emit({ operationBusy: false });
      }
    };
    void task.then(cleanup, cleanup);
    return task;
  }
  function authenticate(path, body) {
    return enqueueMutation("login", async (ticket) => {
      try {
        await request(path, { method: "POST", body });
        if (ticket !== epoch) return null;
        const user = await verify(ticket);
        if (ticket !== epoch) return null;
        if (!user) throw new Error("The authenticated session could not be verified.");
        return user;
      } catch (error) {
        if (ticket !== epoch) return null;
        if (snapshot.status === "loading") emit({ status: "anonymous", error: null });
        throw error;
      }
    });
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    initialize() {
      if (initialized) return mutationTail ? refresh() : pending?.task ?? Promise.resolve(snapshot.user);
      initialized = true;
      return refresh();
    },
    refresh,
    login: ({ email, password }) => authenticate("/v1/auth/login", { email: email.trim().toLowerCase(), password }),
    register: ({ name, email, password }) => authenticate("/v1/auth/register", { name: name.trim(), email: email.trim().toLowerCase(), password }),
    logout() {
      return enqueueMutation("logout", async (ticket) => {
        try {
          await request("/v1/auth/logout", { method: "POST" });
          if (ticket !== epoch) return { confirmed: true, superseded: true };
          emit({ logoutStatus: "confirmed" });
          return { confirmed: true };
        } catch (error) {
          const confirmed = error?.status === 401;
          if (ticket !== epoch) return { confirmed, superseded: true };
          emit({ logoutStatus: confirmed ? "confirmed" : "unconfirmed",
            error: confirmed ? null : "Local account data was cleared, but server logout could not be confirmed. Retry logout." });
          return { confirmed };
        }
      });
    },
  };
}
