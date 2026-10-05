import { aiResultSchema, MAX_AI_RESULT_BYTES, type AiResult } from '@archboard/contracts';
import type { RuntimeAdmission } from '../../../platform/lifecycle/runtime-admission.js';
import type { AiPolicy } from './operator-policy.js';
import type { AiIntentService } from './intent-service.js';
import {
  AiPersistenceError,
  type AiIntent,
  type AiRunRecord,
  type AiSettlement,
} from './persistence.js';
import {
  AiProviderError,
  normalizedProviderRequestSchema,
  normalizedUsageSchema,
  providerEventSchema,
  type AiProvider,
  type NormalizedProviderRequest,
  type NormalizedUsage,
  type ProviderEvent,
} from './provider.js';
import { aiModelOutputSchema } from './prompt-renderer.js';
import { priceAiUsage } from './pricing.js';
import type { AiOperations } from './operations.js';

export const AI_RUN_COORDINATOR = Symbol('AI_RUN_COORDINATOR');
const SHUTDOWN_MS = 5000;
const REJECTION_BACKOFF_MS = 250;
const MAX_PROVIDER_EVENTS = 8192;
// Conservatively account for the adapter's developer-block/cache-marker framing.
// This is admission headroom, never prompt padding or a provider-native option.
const CACHE_PREFIX_FRAMING_BYTES = 256;
function inputBytes(request: NormalizedProviderRequest): number {
  return (
    Buffer.byteLength(
      JSON.stringify({
        instructions: request.instructions,
        messages: request.messages,
        structuredOutput: request.structuredOutput ?? null,
      }),
    ) + (request.promptCache === 'stable-prefix' ? CACHE_PREFIX_FRAMING_BYTES : 0)
  );
}
const ZERO_USAGE: NormalizedUsage = {
  status: 'known',
  uncachedInputTokens: 0,
  cacheReadInputTokens: 0,
  cacheWriteInputTokens: [],
  outputTokens: 0,
  separatelyBilledReasoningTokens: 0,
  reasoningTokens: null,
};
const RESULT_KINDS = {
  'diagram-described': 'diagram',
  'propose-design': 'diagram',
  'explain-selection': 'guidance',
  'trace-flow': 'guidance',
  'scoped-edit': 'edits',
  presentation: 'presentation',
} as const;
function sumUsage(a: NormalizedUsage, b: NormalizedUsage): NormalizedUsage {
  if (a.status === 'unknown' || b.status === 'unknown') return { status: 'unknown' };
  const writes = new Map<string, number>();
  for (const entry of [...a.cacheWriteInputTokens, ...b.cacheWriteInputTokens])
    writes.set(entry.writeClass, (writes.get(entry.writeClass) ?? 0) + entry.tokens);
  return normalizedUsageSchema.parse({
    status: 'known',
    uncachedInputTokens: a.uncachedInputTokens + b.uncachedInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
    cacheWriteInputTokens: [...writes].map(([writeClass, tokens]) => ({ writeClass, tokens })),
    outputTokens: a.outputTokens + b.outputTokens,
    separatelyBilledReasoningTokens:
      a.separatelyBilledReasoningTokens + b.separatelyBilledReasoningTokens,
    reasoningTokens:
      a.reasoningTokens === null || b.reasoningTokens === null
        ? null
        : a.reasoningTokens + b.reasoningTokens,
  });
}

/** A bounded worker, never a durable queue. Only newly committed intent is executed.
 * Replays, subscriptions and recovery cannot initiate provider I/O. */
export class AiRunCoordinator {
  private stopping = false;
  private readonly workers = new Map<string, { abort: AbortController; done: Promise<void> }>();
  public constructor(
    private readonly intents: AiIntentService,
    private readonly runtime: RuntimeAdmission,
    private readonly policy: AiPolicy,
    private readonly now: () => number = Date.now,
    private readonly operations?: AiOperations,
  ) {}

  public async start(
    intent: AiIntent,
    adapter: AiProvider,
    input: NormalizedProviderRequest,
    validateResult: (result: AiResult) => AiResult = (result) => result,
  ) {
    this.runtime.assertAccepting();
    this.operations?.assertPaid();
    if (this.stopping) throw new AiPersistenceError('TEMPORARILY_UNAVAILABLE');
    const request = normalizedProviderRequestSchema.parse(structuredClone(input));
    if (
      adapter.id !== intent.snapshot.provider ||
      request.model !== intent.snapshot.model ||
      request.task !== intent.task ||
      request.maximumOutputTokens > intent.snapshot.maximumOutputTokens ||
      // UTF-8 bytes are a conservative upper bound for the supported tokenizer.
      inputBytes(request) > intent.snapshot.maximumInputTokens
    )
      throw new AiPersistenceError('AI_INPUT_TOO_LARGE');
    const created = await this.intents.create(intent);
    if (created.source !== 'created') return created;
    if (
      this.stopping ||
      !this.runtime.accepting ||
      this.workers.size >= this.policy.limits.globalConcurrency
    ) {
      await this.intents.settle(intent.deploymentNamespace, intent.actorUserId, {
        runId: created.run.id,
        dispatchToken: null,
        mode: 'unsent',
        phase: 'cancelled',
        actualMicroUsd: '0',
        usage: ZERO_USAGE,
        failureCode: null,
      });
      return created;
    }
    const abort = new AbortController();
    // Schedule only after the intent transaction has committed.
    const done = Promise.resolve()
      .then(() => this.execute(created.run, adapter, request, abort, validateResult))
      .catch(() => {
        /* Durable intent remains recoverable; never regenerate after persistence failure. */
      })
      .finally(() => this.workers.delete(created.run.id));
    this.workers.set(created.run.id, { abort, done });
    return created;
  }

  public async read(namespace: string, actor: string, id: string) {
    const snapshot = await this.intents.read(namespace, actor, id);
    if (snapshot.content === 'pending' && snapshot.run.deadlineAt.getTime() <= this.now()) {
      await this.intents.recover(namespace, actor, id);
      return this.intents.read(namespace, actor, id);
    }
    return snapshot;
  }
  public recover(namespace: string, actor: string, id: string) {
    return this.intents.recover(namespace, actor, id);
  }
  public async cancel(namespace: string, actor: string, id: string): Promise<void> {
    const { run } = await this.intents.read(namespace, actor, id);
    const worker = this.workers.get(id);
    if (worker) {
      worker.abort.abort();
      await this.boundedWait(worker.done, SHUTDOWN_MS);
      return;
    }
    if (
      run.phase !== 'admitted' &&
      run.phase !== 'dispatching' &&
      run.phase !== 'pending-admission'
    )
      return;
    await this.intents.settle(namespace, actor, {
      runId: id,
      dispatchToken: run.dispatchToken,
      mode: run.dispatchToken ? 'unknown' : 'unsent',
      phase: run.dispatchToken ? 'outcome-unknown' : 'cancelled',
      actualMicroUsd: run.dispatchToken ? null : '0',
      usage: { status: 'unknown' },
      failureCode: run.dispatchToken ? 'AI_OUTCOME_UNKNOWN' : null,
    });
  }
  public async drain(maximumMs = SHUTDOWN_MS): Promise<void> {
    this.stopping = true;
    for (const worker of this.workers.values()) worker.abort.abort();
    await this.boundedWait(
      Promise.all([...this.workers.values()].map((worker) => worker.done)),
      Math.min(SHUTDOWN_MS, Math.max(0, maximumMs)),
    );
  }
  private async boundedWait(work: Promise<unknown>, maximumMs: number): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        work,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, maximumMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  public onModuleDestroy() {
    return this.drain();
  }

  private async execute(
    prior: AiRunRecord,
    adapter: AiProvider,
    input: NormalizedProviderRequest,
    abort: AbortController,
    validateResult: (result: AiResult) => AiResult,
  ) {
    const ns = prior.deploymentNamespace;
    const actor = prior.actorUserId;
    let release: ReturnType<AiOperations['acquire']> | undefined;
    try {
      release = this.operations?.acquire(prior.snapshot);
    } catch {
      await this.intents.settle(ns, actor, {
        runId: prior.id,
        dispatchToken: null,
        mode: 'unsent',
        phase: 'cancelled',
        actualMicroUsd: '0',
        usage: ZERO_USAGE,
        failureCode: null,
      });
      return;
    }
    let health: 'healthy' | 'failure' | 'neutral' = 'neutral';
    const started = this.now();
    try {
      let run: AiRunRecord;
      try {
        run = await this.intents.markDispatch(ns, actor, prior.id);
      } catch {
        // A failed claim is never permission to call. If commit was ambiguous the
        // null fence rejects this unsent settlement, preserving recovery liability.
        await this.intents.settle(ns, actor, {
          runId: prior.id,
          dispatchToken: null,
          mode: 'unsent',
          phase: 'cancelled',
          actualMicroUsd: '0',
          usage: ZERO_USAGE,
          failureCode: null,
        });
        return;
      }
      const request = {
        ...input,
        deadlineAtUnixMs: run.deadlineAt.getTime(),
        maximumResponseBytes: Math.min(input.maximumResponseBytes, MAX_AI_RESULT_BYTES),
      };
      let usage: NormalizedUsage = ZERO_USAGE;
      let repair = false;
      let retry = false;
      let result: AiResult | undefined;
      let phase: AiSettlement['phase'] = 'failed';
      let failure: AiSettlement['failureCode'] = 'AI_GENERATION_FAILED';
      const deadline = setTimeout(
        () => abort.abort(),
        Math.max(0, run.deadlineAt.getTime() - this.now()),
      );
      try {
        while (true) {
          if (abort.signal.aborted) {
            usage = { status: 'unknown' };
            break;
          }
          let terminal: Exclude<ProviderEvent, { type: 'text-delta' }>;
          try {
            this.operations?.assertPaid();
            this.operations?.add('fresh_calls');
            terminal = await this.consume(adapter, request, abort.signal);
            health = 'healthy';
          } catch (error) {
            if (error instanceof AiPersistenceError) {
              phase = 'cancelled';
              failure = null;
              break;
            }
            if (!(error instanceof AiPersistenceError) && !abort.signal.aborted) health = 'failure';
            const rejection =
              error instanceof AiProviderError && error.failure.execution !== 'may-have-started';
            if (error instanceof AiProviderError && error.failure.usage.status === 'known')
              usage = sumUsage(usage, error.failure.usage);
            if (
              rejection &&
              !retry &&
              this.policy.limits.rejectionRetries === 1 &&
              ['rate-limited', 'overloaded'].includes(error.failure.code)
            ) {
              retry = true;
              await this.pause(
                Math.max(REJECTION_BACKOFF_MS, error.failure.retryAfterMs ?? REJECTION_BACKOFF_MS),
                abort.signal,
              );
              await this.intents.claimAttempt(ns, actor, run.id, run.dispatchToken!);
              continue;
            }
            if (!rejection) usage = { status: 'unknown' };
            break;
          }
          usage = sumUsage(usage, terminal.usage);
          if (terminal.type === 'refused') {
            phase = 'refused';
            failure = 'AI_REFUSED';
            break;
          }
          if (terminal.type === 'incomplete') {
            phase = 'incomplete';
            break;
          }
          try {
            result = validateResult(
              aiResultSchema.parse(aiModelOutputSchema.parse(JSON.parse(terminal.text)).result),
            );
            if (result.kind !== 'clarification' && result.kind !== RESULT_KINDS[run.task])
              throw new Error('Wrong task');
            phase = 'completed';
            failure = null;
            break;
          } catch {
            result = undefined;
            failure = 'AI_OUTPUT_INVALID';
            if (repair || this.policy.limits.repairs !== 1 || usage.status === 'unknown') break;
            repair = true;
            // Never retain or resend malformed model text; the original reviewed context stays bounded.
            request.instructions +=
              ' The previous output was invalid. Return only the required JSON result matching the schema.';
            normalizedProviderRequestSchema.parse(request);
            if (inputBytes(request) > run.snapshot.maximumInputTokens) break;
            await this.intents.claimAttempt(ns, actor, run.id, run.dispatchToken!);
          }
        }
      } catch {
        /* Claim/admission failures stop further network calls. */
      } finally {
        clearTimeout(deadline);
      }
      if (abort.signal.aborted) {
        result = undefined;
        phase = 'cancelled';
        failure = null;
      }
      if (usage.status === 'unknown' || this.now() >= run.deadlineAt.getTime()) {
        usage = { status: 'unknown' };
        phase = 'outcome-unknown';
        failure = 'AI_OUTCOME_UNKNOWN';
        result = undefined;
      }
      await this.intents.settle(
        ns,
        actor,
        {
          runId: run.id,
          dispatchToken: run.dispatchToken,
          mode: usage.status === 'known' ? 'known' : 'unknown',
          phase,
          actualMicroUsd: usage.status === 'known' ? priceAiUsage(run.snapshot, usage) : null,
          usage,
          failureCode: failure,
        },
        result,
      );
      if (abort.signal.aborted && phase === 'outcome-unknown')
        this.operations?.add('cancellations');
    } finally {
      release?.(health);
      this.operations?.add('latency_ms', Math.max(0, this.now() - started));
    }
  }

  private async consume(
    adapter: AiProvider,
    request: NormalizedProviderRequest,
    signal: AbortSignal,
  ): Promise<Exclude<ProviderEvent, { type: 'text-delta' }>> {
    const iterator = adapter.stream(request, signal)[Symbol.asyncIterator]();
    let bytes = 0;
    let events = 0;
    try {
      while (true) {
        const item = await this.abortable(iterator.next(), signal);
        if (item.done) throw new Error('Missing terminal');
        events++;
        if (events > MAX_PROVIDER_EVENTS || this.now() >= request.deadlineAtUnixMs)
          throw new Error('Stream limit');
        const event = providerEventSchema.parse(item.value);
        if (event.type !== 'text-delta') {
          if (
            event.type === 'completed' &&
            Buffer.byteLength(event.text) > request.maximumResponseBytes
          )
            throw new Error('Output limit');
          return event;
        }
        bytes += Buffer.byteLength(event.text);
        if (bytes > request.maximumResponseBytes) throw new Error('Output limit');
      }
    } finally {
      void iterator.return?.().catch(() => undefined);
    }
  }
  private abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const stop = () => reject(new Error('Aborted'));
      if (signal.aborted) {
        stop();
        return;
      }
      signal.addEventListener('abort', stop, { once: true });
      work.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
    });
  }
  private async pause(ms: number, signal: AbortSignal): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await this.abortable(
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, ms);
        }),
        signal,
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
