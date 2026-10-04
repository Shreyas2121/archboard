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
    let timer: NodeJS.Timeout;
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
    renew();
    this.closers.add(close);
    return {
      close,
      next: async () => {
        if (closed || reading) {
          close();
          throw new AiPersistenceError('TEMPORARILY_UNAVAILABLE');
        }
        reading = true;
        try {
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
