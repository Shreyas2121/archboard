import { AiPersistenceError, type AiRunSnapshot } from './persistence.js';
import type { NormalizedUsage } from './provider.js';
import { AiProviderError } from './provider.js';
import { ERROR_CODES } from '@archboard/contracts';

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 30_000;
const MAX_BREAKERS = 16;
const ZERO = 0n;
const METRICS = [
  'cache_hits',
  'cache_misses',
  'deduplicated_starts',
  'refused_admission',
  'fresh_calls',
  'reserved_micro_usd',
  'settled_micro_usd',
  'unknown_outcomes',
  'uncached_input_tokens',
  'cache_read_tokens',
  'billable_cache_write_tokens',
  'billable_output_tokens',
  'separate_reasoning_tokens',
  'latency_ms',
  'cancellations',
  'cleanup_deleted',
  'cleanup_backlog',
  'retained_entries',
  'retained_bytes',
  'maintenance_failures',
  'worker_failures',
  'settlement_failures',
  'provider_failures',
] as const;
type Metric = (typeof METRICS)[number];
type Breaker = { failures: number; until: number; probe: boolean };

/** Operator-only controls and fixed-cardinality diagnostics. Never expose through
 * product routes. Counters are process observations, not the financial ledger. */
export class AiOperations {
  private readonly values = new Map<Metric, bigint>(METRICS.map((name) => [name, ZERO]));
  private readonly breakers = new Map<string, Breaker>();
  private paid = true;
  public constructor(
    private readonly now: () => number = Date.now,
    private readonly externalDisabled: () => boolean = () => false,
    private readonly sink: (value: string) => void = () => undefined,
  ) {}
  public setPaidEnabled(enabled: boolean): void {
    this.paid = enabled;
  }
  public get disabled(): boolean {
    try {
      return !this.paid || this.externalDisabled();
    } catch {
      return true;
    }
  }
  public assertPaid(): void {
    if (this.disabled) throw new AiPersistenceError('AI_DISABLED');
  }
  private key(snapshot: AiRunSnapshot): string {
    return JSON.stringify([snapshot.provider, snapshot.model, snapshot.configurationFingerprint]);
  }
  public assertFresh(snapshot: AiRunSnapshot): void {
    this.assertPaid();
    const state = this.breakers.get(this.key(snapshot));
    if (state && (state.probe || state.until > this.now()))
      throw new AiPersistenceError('TEMPORARILY_UNAVAILABLE');
  }
  /** A half-open lease is taken only by normally funded foreground work. */
  public acquire(snapshot: AiRunSnapshot): (outcome: 'healthy' | 'failure' | 'neutral') => void {
    this.assertFresh(snapshot);
    const key = this.key(snapshot);
    let state = this.breakers.get(key);
    if (!state) {
      if (this.breakers.size >= MAX_BREAKERS)
        throw new AiPersistenceError('TEMPORARILY_UNAVAILABLE');
      state = { failures: 0, until: 0, probe: false };
      this.breakers.set(key, state);
    }
    const probe = state.failures >= FAILURE_THRESHOLD;
    if (probe) state.probe = true;
    let finished = false;
    return (outcome) => {
      if (finished) return;
      finished = true;
      state.probe = false;
      if (outcome === 'healthy') {
        state.failures = 0;
        state.until = 0;
      } else if (outcome === 'failure') {
        state.failures++;
        if (state.failures >= FAILURE_THRESHOLD) state.until = this.now() + COOLDOWN_MS;
      } else if (probe) state.until = this.now() + COOLDOWN_MS;
    };
  }
  public add(name: Metric, amount: bigint | number = 1): void {
    // Runtime allowlist prevents accidental content/high-cardinality fields.
    if (!this.values.has(name)) return;
    try {
      const value = BigInt(amount);
      if (value >= ZERO) this.values.set(name, this.values.get(name)! + value);
    } catch {
      /* Diagnostics cannot affect execution. */
    }
  }
  public gauge(name: Metric, value: number): void {
    if (this.values.has(name) && Number.isSafeInteger(value) && value >= 0)
      this.values.set(name, BigInt(value));
  }
  public usage(usage: NormalizedUsage): void {
    if (usage.status === 'unknown') return;
    this.add('uncached_input_tokens', usage.uncachedInputTokens);
    this.add('cache_read_tokens', usage.cacheReadInputTokens);
    for (const write of usage.cacheWriteInputTokens)
      this.add('billable_cache_write_tokens', write.tokens);
    this.add('billable_output_tokens', usage.outputTokens);
    this.add('separate_reasoning_tokens', usage.separatelyBilledReasoningTokens);
  }
  public snapshot(): Readonly<Record<Metric, string>> {
    return Object.freeze(
      Object.fromEntries([...this.values].map(([k, v]) => [k, v.toString()])) as Record<
        Metric,
        string
      >,
    );
  }
  public report(): void {
    try {
      this.sink(
        JSON.stringify({
          event: 'ai.operations',
          paidDisabled: this.disabled,
          metrics: this.snapshot(),
        }),
      );
    } catch {
      /* No raw error or content reaches logging. */
    }
  }
  public diagnostic(
    stage: 'admission' | 'dispatch' | 'provider' | 'validation' | 'settlement' | 'worker',
    durationMs: number,
    error?: unknown,
  ): void {
    // Error instances/messages/causes are never serialized. Even forged adapter
    // failures must match a fixed allowlist before reaching operator diagnostics.
    const providerCodes = [
      'rate-limited',
      'invalid-request',
      'authentication',
      'overloaded',
      'transport',
      'cancelled',
      'deadline',
      'capability-unsupported',
      'output-too-large',
      'adapter-unavailable',
    ];
    const code =
      error instanceof AiPersistenceError && Object.values(ERROR_CODES).includes(error.code)
        ? error.code
        : error instanceof AiProviderError && providerCodes.includes(error.failure.code)
          ? error.failure.code
          : error === undefined
            ? null
            : 'unavailable';
    try {
      this.sink(
        JSON.stringify({
          event: 'ai.stage',
          stage,
          durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0,
          outcome: error === undefined ? 'completed' : 'failed',
          code,
        }),
      );
    } catch {
      /* Diagnostics cannot affect accounting or execution. */
    }
  }
}
