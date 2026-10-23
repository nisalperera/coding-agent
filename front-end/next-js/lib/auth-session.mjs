export const INITIAL_AUTH = Object.freeze({
    status: "loading", user: null, identityKey: null,
    error: null, logoutStatus: "idle",
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

export function createAuthSession({ request, clearSettings = () => { }, hydrateSettings = () => { }, writeUser = () => { } }) {
    let snapshot = INITIAL_AUTH;
    let epoch = 0;
    let pending = null;
    let initialized = false;
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
        // Missing settings must not preserve another account's provider flags.
        hydrateSettings(data?.settings ?? {});
        writeUser(user);
        emit({ status: "authenticated", user, identityKey: user.user_id, error: null, logoutStatus: "idle" });
        return user;
    };
    function verify() {
        if (pending) return pending;
        const ticket = epoch;
        const task = (async () => {
            try {
                const data = await request("/v1/auth/me", { method: "GET" });
                if (ticket !== epoch) return null;
                return accept(data);
            } catch (error) {
                if (ticket !== epoch) return null;
                reset();
                emit({
                    status: error?.status === 401 ? "anonymous" : "error", user: null, identityKey: null,
                    error: error?.status === 401 ? null : "Session verification is unavailable. Retry before using account features."
                });
                return null;
            }
        })();
        pending = task;
        void task.finally(() => { if (pending === task) pending = null; });
        return task;
    }
    const beginChange = () => {
        epoch += 1; pending = null; initialized = true; reset();
        emit({ status: "loading", user: null, identityKey: null, error: null, logoutStatus: "idle" });
        return epoch;
    };
    async function authenticate(path, body) {
        const ticket = beginChange();
        try {
            await request(path, { method: "POST", body });
            if (ticket !== epoch) return null;
            // Always validate the browser cookie, not merely the login response.
            const user = await verify();
            if (ticket !== epoch) return null;
            if (!user) throw new Error("The authenticated session could not be verified.");
            return user;
        } catch (error) {
            if (ticket !== epoch) return null;
            if (snapshot.status === "loading") emit({ status: "anonymous", error: null });
            throw error;
        }
    }
    return {
        getSnapshot: () => snapshot,
        subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
        initialize() { if (initialized) return pending ?? Promise.resolve(snapshot.user); initialized = true; return verify(); },
        refresh: verify,
        login: ({ email, password }) => authenticate("/v1/auth/login", { email: email.trim().toLowerCase(), password }),
        register: ({ name, email, password }) => authenticate("/v1/auth/register", { name: name.trim(), email: email.trim().toLowerCase(), password }),
        async logout() {
            const ticket = beginChange();
            emit({ status: "anonymous", logoutStatus: "pending" });
            try {
                await request("/v1/auth/logout", { method: "POST" });
                if (ticket === epoch) emit({ logoutStatus: "confirmed" });
                return { confirmed: true };
            } catch (error) {
                const confirmed = error?.status === 401;
                if (ticket === epoch) emit({
                    logoutStatus: confirmed ? "confirmed" : "unconfirmed",
                    error: confirmed ? null : "Local account data was cleared, but server logout could not be confirmed. Retry logout."
                });
                return { confirmed };
            }
        },
    };
}
