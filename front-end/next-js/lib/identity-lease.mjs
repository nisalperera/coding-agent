export class StaleIdentityError extends Error {
  constructor() { super("This operation belongs to a superseded account or page."); this.name = "StaleIdentityError"; this.stale = true; }
}
const matches = (a, b) => a.status === b.status && a.identityKey === b.identityKey && a.user === b.user;
export function createIdentityLease(getSnapshot, expected) {
  let active = false, epoch = 0;
  const pending = new Set();
  function deactivate() {
    active = false; epoch += 1;
    for (const controller of pending) controller.abort();
    pending.clear();
  }
  const isCurrent = (ticket = epoch) => active && ticket === epoch && matches(expected, getSnapshot());
  return {
    identityKey: expected.identityKey,
    activate() { if (matches(expected, getSnapshot())) active = true; },
    deactivate,
    observe() { if (active && !matches(expected, getSnapshot())) deactivate(); },
    isCurrent,
    begin() {
      if (!isCurrent()) throw new StaleIdentityError();
      const controller = new AbortController(), ticket = epoch;
      pending.add(controller);
      let closed = false;
      return {
        epoch: ticket, signal: controller.signal,
        isCurrent: () => !closed && !controller.signal.aborted && isCurrent(ticket),
        cancel() { closed = true; controller.abort(); pending.delete(controller); },
        close() { closed = true; pending.delete(controller); },
      };
    },
  };
}
export function preferenceStorageKey(identityKey) {
  return typeof identityKey === "string" && identityKey.trim()
    ? `coding-agent-settings:account:${encodeURIComponent(identityKey)}` : null;
}
export function readPreferences(storage, key, defaults) {
  if (!key) return { ...defaults };
  try {
    const value = JSON.parse(storage.getItem(key) ?? "null");
    return Object.fromEntries(Object.entries(defaults).map(([name, fallback]) =>
      [name, typeof value?.[name] === "boolean" ? value[name] : fallback]));
  } catch { return { ...defaults }; }
}
