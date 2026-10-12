import type { AiConnectionGate } from './connection-gate.js';
import type { AiRunCoordinator } from './run-coordinator.js';
import { AiPersistenceError } from './persistence.js';

const MAX_IDLE_MS = 30_000;
/** Pull snapshots rather than private delta replay. Zero queued content, one read
 * per subscriber; a slow consumer expires and reconnects through authorized GET.
 * HTTP heartbeats/event IDs are C09 transport concerns. */
export class AiRunSubscriptions {
  private readonly closers = new Set<() => void>();
  public constructor(
    private readonly runs: AiRunCoordinator,
    private readonly gate: AiConnectionGate,
  ) {}
  public open(namespace: string, actor: string, id: string) {
    const release = this.gate.acquire(namespace, actor);
    let closed = false;
    let reading = false;
    let timer: NodeJS.Timeout | undefined;
    const close = () => {
      closed = true;
      clearTimeout(timer);
      release();
      this.closers.delete(close);
    };
    const renew = () => {
      clearTimeout(timer);
      timer = setTimeout(close, MAX_IDLE_MS);
      timer.unref();
    };
    // The transport bounds setup/session checks as part of its total lifetime.
    // A consumer becomes idle only after the first snapshot was delivered.
    this.closers.add(close);
    return {
      close,
      next: async (beforeRead: () => Promise<void> = async () => undefined) => {
        if (closed || reading) {
          close();
          throw new AiPersistenceError('TEMPORARILY_UNAVAILABLE');
        }
        // Active server work is not an idle consumer. Idle time starts again only
        // after the authorized snapshot completes; the HTTP stream bounds lifetime.
        clearTimeout(timer);
        reading = true;
        try {
          await beforeRead();
          const snapshot = await this.runs.read(namespace, actor, id);
          if (closed) throw new AiPersistenceError('TEMPORARILY_UNAVAILABLE');
          renew();
          return snapshot;
        } catch (error) {
          close();
          throw error;
        } finally {
          reading = false;
        }
      },
    };
  }
  public onModuleDestroy(): void {
    for (const close of this.closers) close();
  }
}
