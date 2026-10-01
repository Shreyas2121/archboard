import type { BoardResourceRefresh } from './board-resource-refresh';

/** Recovery reads authenticate first; reconnect never submits a draft or other mutation. */
export function installBoardResourceRecovery(
  refresh: BoardResourceRefresh,
  ports: {
    readonly target: EventTarget;
    readonly online: () => boolean;
    readonly current: () => boolean;
    readonly authenticate: () => Promise<boolean>;
    readonly subscribeReady?: (recover: () => void) => () => void;
  },
): () => void {
  let active = true;
  let generation = 0;
  const recover = () => {
    const started = ++generation;
    // Mark downloaded views stale while the session is checked, without fetching them.
    refresh.setOnline(false);
    refresh.mutationCommitted(['metadata', 'members', 'comments', 'invites', 'checkpoints']);
    if (!ports.online() || !ports.current()) return;
    void ports.authenticate().then(
      (authenticated) => {
        if (active && started === generation && ports.online() && ports.current() && authenticated)
          refresh.setOnline(true);
      },
      () => undefined,
    );
  };
  const offline = () => {
    generation += 1;
    refresh.setOnline(false);
  };
  ports.target.addEventListener('online', recover);
  ports.target.addEventListener('focus', recover);
  ports.target.addEventListener('offline', offline);
  const unsubscribe = ports.subscribeReady?.(recover);
  recover();
  return () => {
    active = false;
    generation += 1;
    unsubscribe?.();
    ports.target.removeEventListener('online', recover);
    ports.target.removeEventListener('focus', recover);
    ports.target.removeEventListener('offline', offline);
  };
}
