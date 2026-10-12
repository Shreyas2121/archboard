import {
  aiRunSchema,
  type AiCreateRun,
  type AiRun,
  type AiAvailability,
} from '@archboard/contracts';
import type { AiRunApplication } from './run-application.js';
import type { AiRunCoordinator } from './run-coordinator.js';
import type { AiRunSubscriptions } from './run-subscriptions.js';
import type { AiAdmissionService } from './admission-service.js';
import { AiPersistenceError, type AiPersistence } from './persistence.js';
import type { AiPolicy } from './operator-policy.js';
import type { AiOperations } from './operations.js';

type Snapshot = Awaited<ReturnType<AiRunCoordinator['read']>>;
export function publicAiRun(snapshot: Snapshot, source: AiRun['source'] = 'generation'): AiRun {
  const { run, result, content } = snapshot;
  const state =
    run.phase === 'completed'
      ? result?.kind === 'clarification'
        ? 'needs-input'
        : 'ready-for-review'
      : run.phase === 'cancelled'
        ? 'cancelled'
        : run.phase === 'outcome-unknown'
          ? 'outcome-unknown'
          : content === 'pending'
            ? run.phase === 'dispatching'
              ? 'generating'
              : 'queued'
            : 'failed';
  return aiRunSchema.parse({
    schemaVersion: 1,
    id: run.id,
    task: run.task,
    state,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    content:
      content === 'available' && result && run.payloadExpiresAt
        ? { status: 'available', result, expiresAt: run.payloadExpiresAt.toISOString() }
        : content === 'expired'
          ? { status: 'expired', expiredAt: (run.payloadExpiresAt ?? run.updatedAt).toISOString() }
          : { status: content },
    failure:
      state === 'outcome-unknown'
        ? { code: 'AI_OUTCOME_UNKNOWN' }
        : state === 'failed'
          ? { code: run.failureCode ?? 'AI_GENERATION_FAILED' }
          : null,
    source,
  });
}
export interface AiHttpRuntime {
  application: AiRunApplication;
  runs: AiRunCoordinator;
  subscriptions: AiRunSubscriptions;
  admission: AiAdmissionService;
  persistence: AiPersistence;
}
/** Always registered: disabled mode needs neither credentials nor database providers. */
export class AiHttpService {
  public constructor(
    private readonly policy: AiPolicy | null,
    private readonly runtime?: AiHttpRuntime,
    private readonly operations?: AiOperations,
  ) {}
  private enabled(allowCancellation = false) {
    if (!this.policy) throw new AiPersistenceError('AI_DISABLED');
    if (!allowCancellation) this.operations?.assertPaid();
    if (!this.runtime) throw new AiPersistenceError('TEMPORARILY_UNAVAILABLE');
    return { ...this.runtime, namespace: this.policy.deploymentNamespace };
  }
  public async create(actor: string, key: string, body: AiCreateRun) {
    const { application } = this.enabled();
    const snapshot = await application.create(actor, key, body);
    this.operations?.assertPaid();
    return publicAiRun(
      snapshot,
      snapshot.source === 'cache'
        ? 'cache'
        : snapshot.source === 'deduplicated'
          ? 'deduplicated'
          : 'generation',
    );
  }
  public async read(actor: string, id: string) {
    const { admission, persistence, runs, namespace } = this.enabled();
    await admission.request(persistence, namespace, actor, null, 'poll');
    const snapshot = await runs.read(namespace, actor, id);
    this.operations?.assertPaid();
    return publicAiRun(snapshot);
  }
  public async cancel(actor: string, id: string) {
    const { admission, persistence, runs, namespace } = this.enabled(true);
    await admission.request(persistence, namespace, actor, null, 'poll');
    await runs.cancel(namespace, actor, id);
    const snapshot = await runs.read(namespace, actor, id);
    // Cancellation remains authorized while disabled, but a completed result
    // must not be disclosed through this endpoint as a substitute for GET.
    if (this.operations?.disabled && snapshot.content === 'available')
      throw new AiPersistenceError('AI_DISABLED');
    return publicAiRun(snapshot);
  }
  public async availability(actor: string, board: string | null): Promise<AiAvailability> {
    if (!this.policy || this.operations?.disabled)
      return { schemaVersion: 1, available: false, reason: 'disabled', allowance: null };
    if (!this.runtime)
      return { schemaVersion: 1, available: false, reason: 'unavailable', allowance: null };
    return this.runtime.admission.availability(
      this.runtime.persistence,
      this.policy.deploymentNamespace,
      actor,
      board,
    );
  }
  public open(actor: string, id: string) {
    const { subscriptions, namespace, admission, persistence } = this.enabled();
    const subscription = subscriptions.open(namespace, actor, id);
    return {
      close: subscription.close,
      next: async (requireSession: () => Promise<void> = async () => undefined) => {
        this.operations?.assertPaid();
        const snapshot = await subscription.next(async () => {
          await requireSession();
          await admission.request(persistence, namespace, actor, null, 'poll');
        });
        this.operations?.assertPaid();
        return publicAiRun(snapshot);
      },
    };
  }
}
