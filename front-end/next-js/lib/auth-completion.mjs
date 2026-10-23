export function createAuthCompletionGuard() {
  let active = false;
  let generation = 0;
  return {
    activate() { active = true; },
    deactivate() { active = false; generation += 1; },
    begin() { generation += 1; return generation; },
    isCurrent(ticket) { return active && ticket === generation; },
    canComplete(ticket, user, snapshot) {
      return active && ticket === generation && Boolean(user) &&
        snapshot.status === "authenticated" && snapshot.user === user &&
        snapshot.identityKey === user.user_id;
    },
  };
}
