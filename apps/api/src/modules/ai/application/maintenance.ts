import type { RuntimeAdmission } from '../../../platform/lifecycle/runtime-admission.js';
import type { AiPersistence } from './persistence.js';
import type { AiIntentService } from './intent-service.js';
import type { AiOperations } from './operations.js';

const INTERVAL_MS = 30_000;
const BATCH = 64;
const SHUTDOWN_MS = 1000;

/** One bounded pass at a time. No model I/O, redispatch, receipt deletion or
 * financial release on content expiry. Discovery and recovery are separate
 * transactions so cleanup never acquires board locks under its namespace lock. */
export class AiMaintenance {
  private timer?: NodeJS.Timeout;
  private work: Promise<void> | undefined;
  private stopped = false;
  public constructor(
    private readonly persistence: AiPersistence,
    private readonly intents: AiIntentService,
    private readonly runtime: RuntimeAdmission,
    private readonly namespace: string,
    private readonly operations: AiOperations,
  ) {}
  public onModuleInit(): void {
    this.schedule(0);
  }
  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedule(INTERVAL_MS));
    }, delay);
    this.timer.unref();
  }
  public tick(): Promise<void> {
    if (this.stopped || !this.runtime.accepting) return Promise.resolve();
    if (this.work) return this.work;
    this.work = this.pass()
      .catch(() => {
        this.operations.add('maintenance_failures');
        this.operations.report();
      })
      .finally(() => {
        this.work = undefined;
      });
    return this.work;
  }
  private async pass(): Promise<void> {
    const summary = await this.persistence.run(async (scope) => {
      const deleted = await scope.deleteExpiredPayloads(this.namespace, BATCH);
      const retained = await scope.payloadUsage(this.namespace);
      const backlog = await scope.expiredPayloadCount(this.namespace);
      const runs = await scope.expiredRuns(this.namespace);
      return { deleted, retained, backlog, runs };
    });
    this.operations.add('cleanup_deleted', summary.deleted);
    this.operations.gauge('cleanup_backlog', summary.backlog);
    this.operations.gauge('retained_entries', summary.retained.entries);
    this.operations.gauge('retained_bytes', summary.retained.bytes);
    for (const run of summary.runs) {
      if (this.stopped || !this.runtime.accepting) break;
      try {
        await this.intents.recover(this.namespace, run.actorUserId, run.id);
      } catch {
        this.operations.add('maintenance_failures');
      }
    }
    this.operations.report();
  }
  public async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    let deadline: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.work,
        new Promise<void>((resolve) => {
          deadline = setTimeout(resolve, SHUTDOWN_MS);
        }),
      ]);
    } finally {
      if (deadline) clearTimeout(deadline);
    }
  }
}
