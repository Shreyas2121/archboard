import {
  AiPersistenceError,
  snapshotAiConfiguration,
  type AiPersistence,
  type AiPersistenceScope,
  type AiLedgerKey,
  type AiLedgerRecord,
  type AiAllocationRecord,
  type AiRunRecord,
  type AiReservationRecord,
  type AiSettlement,
  type AiAttemptRecord,
} from './persistence.js';
import type { AiPolicy } from './operator-policy.js';
import type { AiAvailability } from '@archboard/contracts';
import { estimateAiReservation, priceAiUsage, checkedMoney } from './pricing.js';
export const AI_ADMISSION_SERVICE = Symbol('AI_ADMISSION_SERVICE');
const SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const HOURS_PER_DAY = 24;
const MINUTE = SECONDS_PER_MINUTE * SECOND;
const DAY = HOURS_PER_DAY * SECONDS_PER_MINUTE * MINUTE;
const ZERO = 0n;
const ONE = 1n;
const MAX_ATTEMPTS = 3;
export function aiPeriodStart(now: Date, period: AiLedgerKey['period']): Date {
  if (period === 'active' || period === 'lifetime') return new Date(0);
  if (period === 'month') return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const size = period === 'day' ? DAY : period === 'minute' ? MINUTE : SECOND;
  return new Date(Math.floor(now.getTime() / size) * size);
}
export class AiAdmissionError extends AiPersistenceError {
  public constructor(
    code: 'RATE_LIMITED' | 'AI_ALLOWANCE_REACHED' | 'AI_DISABLED' | 'TEMPORARILY_UNAVAILABLE',
    public readonly retryAfterSeconds?: number,
  ) {
    super(code);
  }
}
const key = (
  namespace: string,
  scope: 'global' | 'actor',
  actor: string,
  kind: AiLedgerKey['kind'],
  metric: string,
  period: AiLedgerKey['period'],
  now: Date,
): AiLedgerKey => ({
  kind,
  deploymentNamespace: namespace,
  scope,
  subject: scope === 'global' ? '' : actor,
  metric,
  period,
  periodStart: aiPeriodStart(now, period),
});
export const aiLedgerIdentity = (value: AiLedgerKey) =>
  JSON.stringify([
    value.kind,
    value.deploymentNamespace,
    value.scope,
    value.subject,
    value.metric,
    value.period,
    value.periodStart.toISOString(),
  ]);
const add = (record: AiLedgerRecord, field: 'committed' | 'reserved', amount: bigint) => {
  record[field] = checkedMoney(BigInt(record[field]) + amount);
};
const periodRetry = (now: Date, period: 'second' | 'minute' | 'day') =>
  Math.max(
    1,
    Math.ceil(
      (aiPeriodStart(now, period).getTime() +
        (period === 'day' ? DAY : period === 'minute' ? MINUTE : SECOND) -
        now.getTime()) /
        SECOND,
    ),
  );
/** Only short durable operations. Provider execution is absent from this port. */
export class AiAdmissionService {
  public constructor(private readonly policy: AiPolicy | null) {}
  private enabled(namespace: string): AiPolicy {
    if (!this.policy) throw new AiAdmissionError('AI_DISABLED');
    if (namespace !== this.policy.deploymentNamespace)
      throw new AiAdmissionError('TEMPORARILY_UNAVAILABLE');
    const policy = this.policy;
    const values = [
      policy.budgets.dailyMicroUsd,
      policy.budgets.monthlyMicroUsd,
      policy.budgets.globalMicroUsd,
      ...(policy.budgets.actorDailyMicroUsd === null ? [] : [policy.budgets.actorDailyMicroUsd]),
    ];
    if (
      values.some((value) => !/^([1-9][0-9]*)$/.test(value)) ||
      Object.values(policy.limits).some((value) => !Number.isSafeInteger(value) || value < 0) ||
      [
        policy.limits.createPerMinute,
        policy.limits.createBurst,
        policy.limits.freshPerMinute,
        policy.limits.freshPerDay,
        policy.limits.globalConcurrency,
        policy.limits.actorConcurrency,
        policy.limits.providerRequestsPerMinute,
        policy.limits.providerInputTokensPerMinute,
        policy.limits.providerOutputTokensPerMinute,
        policy.limits.pollsPerMinute,
        policy.limits.sseConnectionsPerActor,
      ].some((value) => value <= 0)
    )
      throw new AiAdmissionError('TEMPORARILY_UNAVAILABLE');
    for (const value of values) checkedMoney(BigInt(value));
    return policy;
  }
  private async rows(
    scope: AiPersistenceScope,
    keys: AiLedgerKey[],
  ): Promise<Map<string, AiLedgerRecord>> {
    const unique = new Map(keys.map((value) => [aiLedgerIdentity(value), value]));
    await scope.prepareLedgers([...unique.values()]);
    const rows = new Map<string, AiLedgerRecord>();
    for (const [id, value] of [...unique].sort(([a, ka], [b, kb]) =>
      ka.scope !== kb.scope ? (ka.scope === 'global' ? -1 : 1) : a < b ? -1 : a > b ? 1 : 0,
    ))
      rows.set(id, await scope.getLedger(value));
    return rows;
  }
  /** Called after global/actor coordinators, before fingerprint/receipt/run locks. */
  public async prepare(
    scope: AiPersistenceScope,
    namespace: string,
    actor: string,
    now: Date,
    runId?: string,
  ): Promise<void> {
    const keys: AiLedgerKey[] = [];
    for (const metric of ['provider-request', 'provider-input', 'provider-output'])
      for (const period of ['minute', 'active'] as const)
        keys.push(key(namespace, 'global', actor, 'capacity', metric, period, now));
    for (const locality of ['global', 'actor'] as const) {
      keys.push(key(namespace, locality, actor, 'capacity', 'concurrency', 'active', now));
      for (const period of ['day', 'month', 'lifetime'] as const)
        keys.push(key(namespace, locality, actor, 'budget', 'micro-usd', period, now));
    }
    for (const period of ['minute', 'day'] as const)
      keys.push(key(namespace, 'actor', actor, 'capacity', 'fresh', period, now));
    if (runId) for (const allocation of await scope.findAllocations(runId)) keys.push(allocation);
    await this.rows(scope, keys);
  }
  /** Separately committed cheap frequency limits count replay and failed admission. */
  public async request(
    persistence: AiPersistence,
    namespace: string,
    actor: string,
    board: string | null,
    metric: 'create' | 'poll',
  ): Promise<void> {
    const policy = this.enabled(namespace);
    await persistence.run(async (scope) => {
      await scope.authorize(actor, board);
      if (policy.localUnlimited) return;
      await scope.lockRequest(namespace, actor);
      const now = await scope.now();
      const specs =
        metric === 'create'
          ? [
              { period: 'second' as const, limit: policy.limits.createBurst },
              { period: 'minute' as const, limit: policy.limits.createPerMinute },
            ]
          : [{ period: 'minute' as const, limit: policy.limits.pollsPerMinute }];
      const records = await this.rows(
        scope,
        specs.map((spec) => key(namespace, 'actor', actor, 'capacity', metric, spec.period, now)),
      );
      for (const spec of specs) {
        const record = records.get(
          aiLedgerIdentity(key(namespace, 'actor', actor, 'capacity', metric, spec.period, now)),
        )!;
        if (BigInt(record.committed) >= BigInt(spec.limit))
          throw new AiAdmissionError('RATE_LIMITED', periodRetry(now, spec.period));
      }
      for (const record of records.values()) {
        add(record, 'committed', ONE);
        await scope.saveLedger(record);
      }
    });
  }
  /** Advisory durable allowance only; creation still atomically reserves capacity. */
  public async availability(
    persistence: AiPersistence,
    namespace: string,
    actor: string,
    board: string | null,
  ): Promise<AiAvailability> {
    const policy = this.enabled(namespace);
    await this.request(persistence, namespace, actor, board, 'poll');
    if (policy.localUnlimited)
      return {
        schemaVersion: 1,
        available: true,
        allowance: { remainingFreshRuns: null, remainingMicroUsd: null, resetsAt: null },
      };
    return persistence.run(async (scope) => {
      await scope.authorize(actor, board);
      await scope.lockAdmission(namespace, actor);
      const now = await scope.now();
      // Availability only needs fresh counters and budgets. Preparing every provider
      // ledger creates rows and adds sequential round trips to this advisory read.
      const keys: AiLedgerKey[] = (['day', 'minute'] as const).map((period) =>
        key(namespace, 'actor', actor, 'capacity', 'fresh', period, now),
      );
      for (const locality of ['global', 'actor'] as const)
        for (const period of ['day', 'month', 'lifetime'] as const)
          keys.push(key(namespace, locality, actor, 'budget', 'micro-usd', period, now));
      const rows = new Map(
        (await scope.readLedgers(keys)).map((row) => [aiLedgerIdentity(row), row]),
      );
      const ledger = (value: AiLedgerKey) => rows.get(aiLedgerIdentity(value))!;
      let fresh = policy.limits.freshPerDay;
      for (const [period, limit] of [
        ['day', policy.limits.freshPerDay],
        ['minute', policy.limits.freshPerMinute],
      ] as const) {
        const row = ledger(key(namespace, 'actor', actor, 'capacity', 'fresh', period, now));
        fresh = Math.min(fresh, Math.max(0, limit - Number(row.committed)));
      }
      let money = BigInt(policy.budgets.globalMicroUsd);
      for (const locality of ['global', 'actor'] as const) {
        const lifetime = ledger(
          key(namespace, locality, actor, 'budget', 'micro-usd', 'lifetime', now),
        );
        for (const [period, limit] of [
          [
            'day',
            locality === 'actor'
              ? (policy.budgets.actorDailyMicroUsd ?? policy.budgets.dailyMicroUsd)
              : policy.budgets.dailyMicroUsd,
          ],
          ['month', policy.budgets.monthlyMicroUsd],
          ['lifetime', policy.budgets.globalMicroUsd],
        ] as const) {
          const row = ledger(key(namespace, locality, actor, 'budget', 'micro-usd', period, now));
          const remaining = BigInt(limit) - BigInt(row.committed) - BigInt(lifetime.reserved);
          if (remaining < money) money = remaining;
        }
      }
      if (money < ZERO) money = ZERO;
      const allowance = {
        remainingFreshRuns: fresh,
        remainingMicroUsd: String(money),
        resetsAt: null,
      };
      const profile = policy.profiles.find((profile) => profile.model === policy.defaultModel);
      if (!profile) throw new AiAdmissionError('TEMPORARILY_UNAVAILABLE');
      const reserve = estimateAiReservation(
        snapshotAiConfiguration({ provider: policy.provider, profile, policy }),
        policy.limits,
      );
      return fresh === 0 || money < BigInt(reserve.maximumMicroUsd)
        ? { schemaVersion: 1, available: false, reason: 'allowance-reached', allowance }
        : { schemaVersion: 1, available: true, allowance };
    });
  }
  public async fund(
    scope: AiPersistenceScope,
    run: AiRunRecord,
    hold: AiReservationRecord,
    now: Date,
  ): Promise<void> {
    const policy = this.enabled(run.deploymentNamespace);
    const profile = policy.profiles.find((value) => value.model === run.snapshot.model);
    if (
      !profile ||
      JSON.stringify(snapshotAiConfiguration({ provider: policy.provider, profile, policy })) !==
        JSON.stringify(run.snapshot)
    )
      throw new AiPersistenceError('AI_CAPABILITY_UNSUPPORTED');
    if (
      run.snapshot.configurationFingerprint !== policy.fingerprint ||
      !policy.profiles.some(
        (profile) =>
          profile.model === run.snapshot.model &&
          profile.pricingVersion === run.snapshot.pricingVersion,
      )
    )
      throw new AiPersistenceError('AI_CAPABILITY_UNSUPPORTED');
    const expected = estimateAiReservation(run.snapshot, policy.limits);
    if (
      JSON.stringify(expected) !==
      JSON.stringify({
        maximumMicroUsd: hold.maximumMicroUsd,
        inputTokens: hold.inputTokens,
        outputTokens: hold.outputTokens,
        maximumAttempts: hold.maximumAttempts,
      })
    )
      throw new AiPersistenceError('AI_CAPABILITY_UNSUPPORTED');
    if (run.phase !== 'pending-admission' || hold.status !== 'pending' || run.deadlineAt <= now)
      throw new AiAdmissionError('TEMPORARILY_UNAVAILABLE');
    const ns = run.deploymentNamespace;
    const actor = run.actorUserId;
    const allocations: AiAllocationRecord[] = [];
    const allocate = async (k: AiLedgerKey, amount: bigint) => {
      const row = await scope.getLedger(k);
      add(row, 'reserved', amount);
      await scope.saveLedger(row);
      allocations.push({ ...k, runId: run.id, amount: amount.toString() });
    };
    for (const [period, limit] of [
      ['minute', policy.limits.freshPerMinute],
      ['day', policy.limits.freshPerDay],
    ] as const) {
      const row = await scope.getLedger(key(ns, 'actor', actor, 'capacity', 'fresh', period, now));
      if (!policy.localUnlimited && BigInt(row.committed) >= BigInt(limit))
        throw new AiAdmissionError('RATE_LIMITED', periodRetry(now, period));
      add(row, 'committed', ONE);
      await scope.saveLedger(row);
    }
    for (const [locality, limit] of [
      ['global', policy.limits.globalConcurrency],
      ['actor', policy.limits.actorConcurrency],
    ] as const) {
      const k = key(ns, locality, actor, 'capacity', 'concurrency', 'active', now);
      const row = await scope.getLedger(k);
      if (!policy.localUnlimited && BigInt(row.reserved) >= BigInt(limit))
        throw new AiAdmissionError('RATE_LIMITED');
      await allocate(k, ONE);
    }
    const money = BigInt(hold.maximumMicroUsd);
    for (const locality of ['global', 'actor'] as const) {
      const lifetime = await scope.getLedger(
        key(ns, locality, actor, 'budget', 'micro-usd', 'lifetime', now),
      );
      const specs =
        locality === 'global'
          ? ([
              ['day', policy.budgets.dailyMicroUsd],
              ['month', policy.budgets.monthlyMicroUsd],
              ['lifetime', policy.budgets.globalMicroUsd],
            ] as const)
          : ([
              ['day', policy.budgets.actorDailyMicroUsd ?? policy.budgets.dailyMicroUsd],
              ['month', policy.budgets.monthlyMicroUsd],
              ['lifetime', policy.budgets.globalMicroUsd],
            ] as const);
      for (const [period, limit] of specs) {
        const k = key(ns, locality, actor, 'budget', 'micro-usd', period, now);
        const row = await scope.getLedger(k);
        // Lifetime reserved includes ALL outstanding periods, including unknown work.
        if (
          !policy.localUnlimited &&
          BigInt(row.committed) + BigInt(lifetime.reserved) + money > BigInt(limit)
        )
          throw new AiAdmissionError('AI_ALLOWANCE_REACHED');
      }
      for (const [period] of specs)
        await allocate(key(ns, locality, actor, 'budget', 'micro-usd', period, now), money);
    }
    for (const [metric, total, limit] of [
      ['provider-request', BigInt(hold.maximumAttempts), policy.limits.providerRequestsPerMinute],
      ['provider-input', BigInt(hold.inputTokens), policy.limits.providerInputTokensPerMinute],
      ['provider-output', BigInt(hold.outputTokens), policy.limits.providerOutputTokensPerMinute],
    ] as const) {
      const minute = await scope.getLedger(
        key(ns, 'global', actor, 'capacity', metric, 'minute', now),
      );
      const active = await scope.getLedger(
        key(ns, 'global', actor, 'capacity', metric, 'active', now),
      );
      if (
        !policy.localUnlimited &&
        BigInt(minute.committed) + BigInt(active.reserved) + total > BigInt(limit)
      )
        throw new AiAdmissionError('RATE_LIMITED', periodRetry(now, 'minute'));
      await allocate(key(ns, 'global', actor, 'capacity', metric, 'minute', now), total);
      await allocate(key(ns, 'global', actor, 'capacity', metric, 'active', now), total);
    }
    await scope.insertAllocations(allocations);
    hold.status = 'reserved';
    hold.fundedAt = now;
    run.phase = 'admitted';
    run.updatedAt = now;
    await scope.updateReservation(hold);
    await scope.updateRun(run);
  }
  public async admit(
    persistence: AiPersistence,
    namespace: string,
    actor: string,
    id: string,
  ): Promise<AiRunRecord> {
    this.enabled(namespace);
    return persistence.run(async (scope) => {
      const prior = await scope.findRun(namespace, actor, id);
      if (!prior) throw new AiPersistenceError('NOT_FOUND');
      await scope.authorize(actor, prior.boardId);
      await scope.lockAdmission(namespace, actor);
      const now = await scope.now();
      await this.prepare(scope, namespace, actor, now, id);
      await scope.lockFingerprint(namespace, actor, prior.fingerprint);
      await scope.lockRun(id);
      const run = (await scope.findRun(namespace, actor, id))!;
      const hold = await scope.findReservation(id);
      if (!hold) throw new AiAdmissionError('TEMPORARILY_UNAVAILABLE');
      if (run.phase === 'admitted' && hold.status === 'reserved') return run;
      await this.fund(scope, run, hold, now);
      return run;
    });
  }
  public async claim(
    scope: AiPersistenceScope,
    run: AiRunRecord,
    now: Date,
  ): Promise<AiAttemptRecord> {
    const policy = this.enabled(run.deploymentNamespace);
    const hold = await scope.findReservation(run.id);
    const attempts = await scope.findAttempts(run.id);
    if (
      !hold ||
      hold.status !== 'reserved' ||
      !hold.fundedAt ||
      run.phase !== 'dispatching' ||
      !run.dispatchToken ||
      !run.leaseExpiresAt ||
      run.leaseExpiresAt <= now ||
      run.deadlineAt <= now ||
      attempts.length >= hold.maximumAttempts ||
      hold.maximumAttempts > MAX_ATTEMPTS
    )
      throw new AiAdmissionError('TEMPORARILY_UNAVAILABLE');
    const allocations = await scope.findAllocations(run.id);
    if (
      !allocations.some(
        (value) =>
          value.kind === 'budget' && value.scope === 'global' && value.period === 'lifetime',
      )
    )
      throw new AiAdmissionError('TEMPORARILY_UNAVAILABLE');
    const ns = run.deploymentNamespace;
    const actor = run.actorUserId;
    const input = BigInt(hold.inputTokens) / BigInt(hold.maximumAttempts);
    const output = BigInt(hold.outputTokens) / BigInt(hold.maximumAttempts);
    for (const [metric, amount, limit] of [
      ['provider-request', ONE, policy.limits.providerRequestsPerMinute],
      ['provider-input', input, policy.limits.providerInputTokensPerMinute],
      ['provider-output', output, policy.limits.providerOutputTokensPerMinute],
    ] as const) {
      const origin = allocations.find(
        (value) =>
          value.kind === 'capacity' && value.metric === metric && value.period === 'minute',
      );
      if (!origin) throw new AiAdmissionError('TEMPORARILY_UNAVAILABLE');
      const active = await scope.getLedger(
        key(ns, 'global', actor, 'capacity', metric, 'active', now),
      );
      const current = await scope.getLedger(
        key(ns, 'global', actor, 'capacity', metric, 'minute', now),
      );
      if (
        !policy.localUnlimited &&
        BigInt(current.committed) + BigInt(active.reserved) > BigInt(limit)
      )
        throw new AiAdmissionError('RATE_LIMITED', periodRetry(now, 'minute'));
      const original =
        aiLedgerIdentity(origin) === aiLedgerIdentity(current)
          ? current
          : await scope.getLedger(origin);
      add(original, 'reserved', -amount);
      add(active, 'reserved', -amount);
      add(current, 'committed', amount);
      await scope.saveLedger(original);
      await scope.saveLedger(active);
      if (original !== current) await scope.saveLedger(current);
    }
    const attempt = {
      runId: run.id,
      ordinal: attempts.length + 1,
      dispatchToken: run.dispatchToken,
      claimedAt: now,
      inputCapacity: input.toString(),
      outputCapacity: output.toString(),
    };
    await scope.insertAttempt(attempt);
    return attempt;
  }
  public async settle(
    scope: AiPersistenceScope,
    run: AiRunRecord,
    hold: AiReservationRecord,
    final: AiSettlement,
    now: Date,
  ): Promise<void> {
    const policy = this.enabled(run.deploymentNamespace);
    if (hold.status === 'pending') {
      if (final.mode !== 'unsent') throw new AiAdmissionError('TEMPORARILY_UNAVAILABLE');
      return;
    }
    const allocations = await scope.findAllocations(run.id);
    const attempts = await scope.findAttempts(run.id);
    if (!allocations.length) throw new AiAdmissionError('TEMPORARILY_UNAVAILABLE');
    if (
      final.mode === 'unsent' &&
      final.usage.status === 'known' &&
      (final.usage.uncachedInputTokens !== 0 ||
        final.usage.cacheReadInputTokens !== 0 ||
        final.usage.cacheWriteInputTokens.some((entry) => entry.tokens !== 0) ||
        final.usage.outputTokens !== 0 ||
        final.usage.separatelyBilledReasoningTokens !== 0)
    )
      throw new AiPersistenceError('AI_CAPABILITY_UNSUPPORTED');
    if (final.mode === 'known') {
      if (final.usage.status !== 'known') throw new AiPersistenceError('AI_OUTCOME_UNKNOWN');
      const inputUsed =
        BigInt(final.usage.uncachedInputTokens) +
        BigInt(final.usage.cacheReadInputTokens) +
        final.usage.cacheWriteInputTokens.reduce((sum, entry) => sum + BigInt(entry.tokens), ZERO);
      const outputUsed =
        BigInt(final.usage.outputTokens) + BigInt(final.usage.separatelyBilledReasoningTokens);
      if (
        !policy.localUnlimited &&
        (inputUsed > attempts.reduce((sum, attempt) => sum + BigInt(attempt.inputCapacity), ZERO) ||
          outputUsed >
            attempts.reduce((sum, attempt) => sum + BigInt(attempt.outputCapacity), ZERO))
      )
        throw new AiPersistenceError('AI_CAPABILITY_UNSUPPORTED');
      if (
        final.actualMicroUsd !== priceAiUsage(run.snapshot, final.usage) ||
        (!policy.localUnlimited && BigInt(final.actualMicroUsd!) > BigInt(hold.maximumMicroUsd))
      )
        throw new AiPersistenceError('AI_CAPABILITY_UNSUPPORTED');
    }
    for (const allocation of allocations) {
      const row = await scope.getLedger(allocation);
      let release = BigInt(allocation.amount);
      if (allocation.kind === 'budget') {
        if (final.mode === 'unknown') continue;
        add(row, 'reserved', -release);
        add(row, 'committed', BigInt(final.actualMicroUsd!));
        await scope.saveLedger(row);
        if (allocation.period === 'day' || allocation.period === 'month') {
          const currentKey = key(
            run.deploymentNamespace,
            allocation.scope,
            run.actorUserId,
            'budget',
            'micro-usd',
            allocation.period,
            now,
          );
          if (aiLedgerIdentity(currentKey) !== aiLedgerIdentity(allocation)) {
            const current = await scope.getLedger(currentKey);
            add(current, 'committed', BigInt(final.actualMicroUsd!));
            await scope.saveLedger(current);
          }
        }
        continue;
      }
      if (allocation.metric.startsWith('provider-')) {
        const spent = attempts.reduce(
          (sum, attempt) =>
            sum +
            (allocation.metric === 'provider-request'
              ? ONE
              : BigInt(
                  allocation.metric === 'provider-input'
                    ? attempt.inputCapacity
                    : attempt.outputCapacity,
                )),
          ZERO,
        );
        release -= spent;
      }
      add(row, 'reserved', -release);
      await scope.saveLedger(row);
    }
  }
}
