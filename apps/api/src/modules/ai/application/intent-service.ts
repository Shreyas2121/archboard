import { randomUUID } from 'node:crypto';
import { aiResultSchema, type AiResult } from '@archboard/contracts';
import type { AiAdmissionService } from './admission-service.js';
import {
  AiPersistenceError,
  aiIntentSchema,
  aiSettlementSchema,
  type AiIntent,
  type AiPersistence,
  type AiPersistenceScope,
  type AiPayloadCipher,
  type AiRunRecord,
  type AiSettlement,
} from './persistence.js';

const ACTIVE_PHASES = new Set(['pending-admission', 'admitted', 'dispatching']);
const ZERO_MONEY = 0n;

/** Persistence primitives only. No provider calls, quota calculation or background
 * queue. C06 funds admission; C07 orchestrates execution outside these transactions. */
export class AiIntentService {
  public constructor(
    private readonly persistence: AiPersistence,
    private readonly cipher: AiPayloadCipher,
    private readonly admission?: AiAdmissionService,
  ) {}

  public async create(
    input: AiIntent,
  ): Promise<{ run: AiRunRecord; source: 'created' | 'replayed' | 'deduplicated' }> {
    const parsed = aiIntentSchema.safeParse(input);
    if (!parsed.success) throw new AiPersistenceError('TEMPORARILY_UNAVAILABLE');
    const intent = parsed.data;
    await this.admission?.request(
      this.persistence,
      intent.deploymentNamespace,
      intent.actorUserId,
      intent.boardId,
      'create',
    );
    return this.persistence.run(async (scope) => {
      // Existing board lock order is preserved before any AI coordinator/receipt.
      await scope.authorize(intent.actorUserId, intent.boardId);
      await scope.lockAdmission(intent.deploymentNamespace, intent.actorUserId);
      const now = await scope.now();
      await this.admission?.prepare(scope, intent.deploymentNamespace, intent.actorUserId, now);
      await scope.lockFingerprint(
        intent.deploymentNamespace,
        intent.actorUserId,
        intent.fingerprint,
      );
      await scope.lockReceipt(intent.deploymentNamespace, intent.actorUserId, intent.key);
      const receipt = await scope.findReceipt(
        intent.deploymentNamespace,
        intent.actorUserId,
        intent.key,
      );
      if (receipt) {
        if (receipt.requestHash !== intent.requestHash)
          throw new AiPersistenceError('IDEMPOTENCY_CONFLICT');
        // Expired keys remain tombstones, never permission to recreate paid work.
        if (receipt.expiresAt <= now) throw new AiPersistenceError('AI_RESULT_EXPIRED');
        const run = await scope.findRun(
          intent.deploymentNamespace,
          intent.actorUserId,
          receipt.runId,
        );
        if (!run || run.boardId !== intent.boardId) throw new AiPersistenceError('NOT_FOUND');
        return { run, source: 'replayed' };
      }
      const active = await scope.findActive(
        intent.deploymentNamespace,
        intent.actorUserId,
        intent.fingerprint,
      );
      if (
        active &&
        (active.boardId !== intent.boardId ||
          active.requestHash !== intent.requestHash ||
          active.task !== intent.task ||
          JSON.stringify(active.snapshot) !== JSON.stringify(intent.snapshot))
      )
        throw new AiPersistenceError('IDEMPOTENCY_CONFLICT');
      const run: AiRunRecord = active ?? {
        id: randomUUID(),
        deploymentNamespace: intent.deploymentNamespace,
        actorUserId: intent.actorUserId,
        boardId: intent.boardId,
        requestHash: intent.requestHash,
        fingerprint: intent.fingerprint,
        task: intent.task,
        snapshot: intent.snapshot,
        phase: 'pending-admission',
        createdAt: now,
        updatedAt: now,
        deadlineAt: new Date(now.getTime() + intent.snapshot.deadlineMs),
        dispatchToken: null,
        leaseExpiresAt: null,
        payloadId: null,
        payloadExpiresAt: null,
        usage: { status: 'unknown' },
        failureCode: null,
      };
      await scope.lockRun(run.id);
      if (!active) {
        await scope.insertRun(run);
        const reservation = {
          ...intent.reservation,
          runId: run.id,
          status: 'pending' as const,
          fundedAt: null,
        };
        await scope.insertReservation(reservation);
        await this.admission?.fund(scope, run, reservation, now);
      }
      await scope.insertReceipt({
        deploymentNamespace: intent.deploymentNamespace,
        actorUserId: intent.actorUserId,
        key: intent.key,
        requestHash: intent.requestHash,
        runId: run.id,
        createdAt: now,
        expiresAt: new Date(now.getTime() + intent.snapshot.receiptTtlMs),
      });
      return { run, source: active ? 'deduplicated' : 'created' };
    });
  }

  private async owned(
    scope: AiPersistenceScope,
    namespace: string,
    actor: string,
    id: string,
    disclose = true,
  ): Promise<AiRunRecord> {
    // This actor-scoped metadata read does not lock or disclose anything. Authority
    // is acquired before coordinator locks, then metadata is re-read under lock.
    const prior = await scope.findRun(namespace, actor, id);
    if (!prior) throw new AiPersistenceError('NOT_FOUND');
    if (disclose) await scope.authorize(actor, prior.boardId);
    await scope.lockAdmission(namespace, actor);
    await this.admission?.prepare(scope, namespace, actor, await scope.now(), id);
    await scope.lockFingerprint(namespace, actor, prior.fingerprint);
    await scope.lockRun(id);
    const run = await scope.findRun(namespace, actor, id);
    if (!run || run.boardId !== prior.boardId) throw new AiPersistenceError('NOT_FOUND');
    return run;
  }

  public markDispatch(namespace: string, actor: string, id: string): Promise<AiRunRecord> {
    return this.persistence.run(async (scope) => {
      const run = await this.owned(scope, namespace, actor, id);
      const reservation = await scope.findReservation(id);
      const now = await scope.now();
      // Pending C05 intent is not funded. This cannot dispatch until C06 writes
      // reserved capacity and changes the phase in the same admission transaction.
      if (!this.admission) throw new AiPersistenceError('TEMPORARILY_UNAVAILABLE');
      if (
        run.phase !== 'admitted' ||
        reservation?.status !== 'reserved' ||
        !reservation.fundedAt ||
        BigInt(reservation.maximumMicroUsd) <= ZERO_MONEY
      )
        throw new AiPersistenceError('TEMPORARILY_UNAVAILABLE');
      if (run.deadlineAt <= now) throw new AiPersistenceError('AI_GENERATION_FAILED');
      run.phase = 'dispatching';
      run.dispatchToken = randomUUID();
      run.leaseExpiresAt = run.deadlineAt;
      run.updatedAt = now;
      await scope.updateRun(run);
      await this.admission.claim(scope, run, now);
      return run;
    });
  }

  /** Trusted worker operation only: records liability even after access revocation.
   * Returns no receipt, result or run metadata. User reads always reauthorize. */
  public settle(
    namespace: string,
    actor: string,
    input: AiSettlement,
    result?: AiResult,
  ): Promise<void> {
    const parsed = aiSettlementSchema.safeParse(input);
    const validated = result === undefined ? null : aiResultSchema.safeParse(result);
    if (
      !parsed.success ||
      (validated && !validated.success) ||
      (result !== undefined && input.phase !== 'completed')
    )
      throw new AiPersistenceError('TEMPORARILY_UNAVAILABLE');
    const settlement = parsed.data;
    return this.persistence.run(async (scope) => {
      const run = await this.owned(scope, namespace, actor, settlement.runId, false);
      const existing = await scope.findSettlement(run.id);
      if (existing) {
        // First terminal effect is authoritative; a retry never overwrites payloads.
        if (JSON.stringify(aiSettlementSchema.parse(existing)) !== JSON.stringify(settlement))
          throw new AiPersistenceError('IDEMPOTENCY_CONFLICT');
        return;
      }
      if (
        !ACTIVE_PHASES.has(run.phase) ||
        run.dispatchToken !== settlement.dispatchToken ||
        (settlement.mode !== 'unsent' && run.phase !== 'dispatching') ||
        (settlement.phase === 'completed' && run.phase !== 'dispatching')
      )
        throw new AiPersistenceError('AI_OUTCOME_UNKNOWN');
      const reservation = await scope.findReservation(run.id);
      if (!reservation) throw new AiPersistenceError('TEMPORARILY_UNAVAILABLE');
      const now = await scope.now();
      if (settlement.mode === 'known' && (!run.leaseExpiresAt || run.leaseExpiresAt <= now))
        throw new AiPersistenceError('AI_OUTCOME_UNKNOWN');
      if (reservation.status !== 'pending' && !this.admission)
        throw new AiPersistenceError('TEMPORARILY_UNAVAILABLE');
      await this.admission?.settle(scope, run, reservation, settlement, now);
      run.phase = settlement.phase;
      run.usage = settlement.usage;
      run.failureCode = settlement.failureCode;
      run.updatedAt = now;
      if (validated?.success) {
        const expiresAt = new Date(now.getTime() + run.snapshot.resultTtlMs);
        const payload = this.cipher.seal(
          {
            deploymentNamespace: namespace,
            actorUserId: actor,
            originRunId: run.id,
            id: randomUUID(),
            schemaVersion: 1,
            keyVersion: this.cipher.keyVersion,
            expiresAt,
          },
          validated.data,
        );
        await scope.insertPayload(payload);
        run.payloadId = payload.id;
        run.payloadExpiresAt = expiresAt;
      }
      reservation.status = settlement.mode === 'unknown' ? 'unknown' : 'settled';
      await scope.insertSettlement(settlement);
      await scope.updateReservation(reservation);
      await scope.updateRun(run);
    });
  }

  /** C07 must claim every retry/repair before making its additional network call. */
  public claimAttempt(namespace: string, actor: string, id: string, dispatchToken: string) {
    return this.persistence.run(async (scope) => {
      const run = await this.owned(scope, namespace, actor, id);
      if (!this.admission || run.dispatchToken !== dispatchToken)
        throw new AiPersistenceError('AI_OUTCOME_UNKNOWN');
      return this.admission.claim(scope, run, await scope.now());
    });
  }

  public read(
    namespace: string,
    actor: string,
    id: string,
  ): Promise<{
    run: AiRunRecord;
    result: AiResult | null;
    content: 'pending' | 'available' | 'expired' | 'unavailable';
  }> {
    return this.persistence.run(async (scope) => {
      const run = await this.owned(scope, namespace, actor, id);
      if (ACTIVE_PHASES.has(run.phase)) return { run, result: null, content: 'pending' };
      if (run.phase !== 'completed') return { run, result: null, content: 'unavailable' };
      const now = await scope.now();
      if (!run.payloadId || !run.payloadExpiresAt || run.payloadExpiresAt <= now)
        return { run, result: null, content: 'expired' };
      const payload = await scope.findPayload(namespace, actor, run.payloadId);
      if (
        !payload ||
        payload.expiresAt <= now ||
        payload.originRunId !== run.id ||
        payload.expiresAt.getTime() !== run.payloadExpiresAt.getTime()
      )
        return { run, result: null, content: 'expired' };
      return { run, result: this.cipher.open(payload), content: 'available' };
    });
  }
}
