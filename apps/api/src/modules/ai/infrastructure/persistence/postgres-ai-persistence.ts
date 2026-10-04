import type { DataSource, QueryRunner } from 'typeorm';
import type { BoardPermissionService } from '../../../boards/application/index.js';
import { PostgresTransaction } from '../../../../platform/database/postgres-transaction.js';
import type { RuntimeAdmission } from '../../../../platform/lifecycle/runtime-admission.js';
import {
  AiPersistenceError,
  aiRunSnapshotSchema,
  aiSettlementSchema,
  type AiPersistence,
  type AiPersistenceScope,
  type AiRunRecord,
  type AiReceiptRecord,
  type AiReservationRecord,
  type AiSettlement,
  type AiEncryptedPayload,
  type AiLedgerKey,
  type AiLedgerRecord,
  type AiAllocationRecord,
  type AiAttemptRecord,
  type AiCacheRecord,
  type AiPayloadSummary,
} from '../../application/persistence.js';
import { normalizedUsageSchema } from '../../application/provider.js';
import {
  AiRunEntity,
  AiReceiptEntity,
  AiReservationEntity,
  AiSettlementEntity,
  AiPayloadEntity,
  AiCounterEntity,
  AiBudgetPeriodEntity,
  AiAllocationEntity,
  AiAttemptEntity,
  AiCacheEntity,
} from './entities.js';

const MAX_CLEANUP_BATCH = 64;
/** Uses the platform lifecycle, never the boards idempotency effect or a provider. */
export class PostgresAiPersistence implements AiPersistence {
  private readonly transactions: PostgresTransaction;
  public constructor(
    source: DataSource,
    private readonly authority: BoardPermissionService,
    admission?: RuntimeAdmission,
  ) {
    this.transactions = new PostgresTransaction(source, admission);
  }
  public runAdmitted<T>(work: (scope: AiPersistenceScope) => Promise<T>): Promise<T> {
    return this.run(work, true);
  }
  public async run<T>(
    work: (scope: AiPersistenceScope) => Promise<T>,
    alreadyAdmitted = false,
  ): Promise<T> {
    try {
      return await this.transactions.run(
        (runner) => work(new PostgresAiScope(runner, this.authority)),
        alreadyAdmitted,
      );
    } catch (error) {
      if (error instanceof AiPersistenceError) throw error;
      // No SQL detail, native cause, content or encrypted bytes cross this boundary.
      throw new AiPersistenceError('TEMPORARILY_UNAVAILABLE');
    }
  }
}
class PostgresAiScope implements AiPersistenceScope {
  private contentSavepoint = 0;
  public constructor(
    private readonly runner: QueryRunner,
    private readonly authority: BoardPermissionService,
  ) {}
  private get manager() {
    return this.runner.manager;
  }
  public findCache(
    namespace: string,
    actor: string,
    fingerprint: string,
  ): Promise<AiCacheRecord | null> {
    return this.manager.findOneBy(AiCacheEntity, {
      deploymentNamespace: namespace,
      actorUserId: actor,
      fingerprint,
    });
  }
  public async putCache(record: AiCacheRecord): Promise<void> {
    await this.manager.upsert(AiCacheEntity, record, [
      'deploymentNamespace',
      'actorUserId',
      'fingerprint',
    ]);
  }
  public async payloadUsage(
    namespace: string,
    actor?: string,
  ): Promise<{ entries: number; bytes: number }> {
    const query = this.manager
      .getRepository(AiPayloadEntity)
      .createQueryBuilder('payload')
      .select('COUNT(payload.id)', 'entries')
      .addSelect('COALESCE(SUM(payload.byteLength), 0)', 'bytes')
      .where('payload.deploymentNamespace = :namespace', { namespace });
    if (actor !== undefined) query.andWhere('payload.actorUserId = :actor', { actor });
    const totals = await query.getRawOne<{ entries: string; bytes: string }>();
    const entries = Number(totals?.entries ?? 0);
    const bytes = Number(totals?.bytes ?? 0);
    if (![entries, bytes].every((value) => Number.isSafeInteger(value) && value >= 0))
      throw new AiPersistenceError('TEMPORARILY_UNAVAILABLE');
    return { entries, bytes };
  }
  public oldestPayloads(namespace: string, actor?: string): Promise<AiPayloadSummary[]> {
    const query = this.manager
      .getRepository(AiPayloadEntity)
      .createQueryBuilder('payload')
      .select(['payload.id', 'payload.actorUserId', 'payload.byteLength', 'payload.expiresAt'])
      .where('payload.deploymentNamespace = :namespace', { namespace });
    if (actor !== undefined) query.andWhere('payload.actorUserId = :actor', { actor });
    return query
      .orderBy('payload.expiresAt', 'ASC')
      .addOrderBy('payload.id', 'ASC')
      .take(MAX_CLEANUP_BATCH)
      .getMany();
  }
  public async deletePayloads(namespace: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    if (ids.length > MAX_CLEANUP_BATCH) throw new AiPersistenceError('TEMPORARILY_UNAVAILABLE');
    // All content writers/cleanup hold the namespace coordinator before this delete.
    // The cache's FK cascades; run locators/accounting intentionally survive eviction.
    await this.manager
      .getRepository(AiPayloadEntity)
      .createQueryBuilder()
      .delete()
      .where('deployment_namespace = :namespace', { namespace })
      .andWhere('id IN (:...ids)', { ids })
      .execute();
  }
  public async tryContent<T>(work: () => Promise<T>): Promise<T | null> {
    this.contentSavepoint++;
    // Internal integer-only name, never input. Savepoints are transaction control
    // unavailable through Repository APIs and isolate optional content writes.
    const name = 'ai_content_' + this.contentSavepoint;
    await this.runner.query('SAVEPOINT ' + name);
    try {
      const value = await work();
      await this.runner.query('RELEASE SAVEPOINT ' + name);
      return value;
    } catch {
      await this.runner.query('ROLLBACK TO SAVEPOINT ' + name);
      await this.runner.query('RELEASE SAVEPOINT ' + name);
      return null;
    }
  }
  public async getLedger(key: AiLedgerKey): Promise<AiLedgerRecord> {
    const { deploymentNamespace, scope, subject, periodStart } = key;
    if (key.kind === 'capacity') {
      const identity = {
        deploymentNamespace,
        scope,
        subject,
        periodStart,
        metric: key.metric as AiCounterEntity['metric'],
        period: key.period as AiCounterEntity['period'],
      };
      await this.manager
        .getRepository(AiCounterEntity)
        .createQueryBuilder()
        .insert()
        .values({ ...identity, committed: '0', reserved: '0' })
        .orIgnore()
        .execute();
      const row = await this.manager
        .getRepository(AiCounterEntity)
        .createQueryBuilder('capacity')
        .where(identity)
        .setLock('pessimistic_write')
        .getOneOrFail();
      return { ...key, committed: row.committed, reserved: row.reserved };
    }
    const identity = {
      deploymentNamespace,
      scope,
      subject,
      periodStart,
      period: key.period as AiBudgetPeriodEntity['period'],
    };
    await this.manager
      .getRepository(AiBudgetPeriodEntity)
      .createQueryBuilder()
      .insert()
      .values({ ...identity, committedMicroUsd: '0', reservedMicroUsd: '0' })
      .orIgnore()
      .execute();
    const row = await this.manager
      .getRepository(AiBudgetPeriodEntity)
      .createQueryBuilder('budget')
      .where(identity)
      .setLock('pessimistic_write')
      .getOneOrFail();
    return { ...key, committed: row.committedMicroUsd, reserved: row.reservedMicroUsd };
  }
  public async saveLedger(record: AiLedgerRecord): Promise<void> {
    const { deploymentNamespace, scope, subject, periodStart } = record;
    if (record.kind === 'capacity') {
      await this.manager.update(
        AiCounterEntity,
        {
          deploymentNamespace,
          scope,
          subject,
          periodStart,
          metric: record.metric as AiCounterEntity['metric'],
          period: record.period as AiCounterEntity['period'],
        },
        { committed: record.committed, reserved: record.reserved },
      );
    } else
      await this.manager.update(
        AiBudgetPeriodEntity,
        {
          deploymentNamespace,
          scope,
          subject,
          periodStart,
          period: record.period as AiBudgetPeriodEntity['period'],
        },
        { committedMicroUsd: record.committed, reservedMicroUsd: record.reserved },
      );
  }
  public async findAllocations(runId: string): Promise<AiAllocationRecord[]> {
    const rows = await this.manager.findBy(AiAllocationEntity, { runId });
    return rows.map((row) => ({ ...row, period: row.period as AiLedgerKey['period'] }));
  }
  public async insertAllocations(records: AiAllocationRecord[]): Promise<void> {
    await this.manager.insert(AiAllocationEntity, records);
  }
  public findAttempts(runId: string): Promise<AiAttemptRecord[]> {
    return this.manager.find(AiAttemptEntity, { where: { runId }, order: { ordinal: 'ASC' } });
  }
  public async insertAttempt(record: AiAttemptRecord): Promise<void> {
    await this.manager.insert(AiAttemptEntity, record);
  }

  public async now(): Promise<Date> {
    // PostgreSQL owns lifecycle time; transaction_timestamp would hide lock waits.
    const rows: { now: Date }[] = await this.runner.query('SELECT clock_timestamp() AS now');
    return new Date(rows[0]!.now);
  }
  public async authorize(actor: string, board: string | null): Promise<void> {
    if (board !== null) {
      const decision = await this.authority.editGraph(this.runner, board, actor);
      if (!decision.allowed) throw new AiPersistenceError(decision.code);
    }
    // Better Auth owns this table and deliberately has no TypeORM user entity.
    const rows: { id: string }[] = await this.runner.query('SELECT id FROM "user" WHERE id = $1', [
      actor,
    ]);
    if (!rows.length) throw new AiPersistenceError('NOT_FOUND');
  }
  private async lock(parts: readonly string[]): Promise<void> {
    // Transaction-scoped PostgreSQL advisory locks cover keys before a row exists.
    // JSON framing avoids separator collisions; hash collisions only serialize work.
    await this.runner.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      JSON.stringify(['archboard-ai-v1', ...parts]),
    ]);
  }
  public async lockAdmission(namespace: string, actor: string): Promise<void> {
    await this.lock(['global', namespace]);
    await this.lock(['actor', namespace, actor]);
  }
  public lockFingerprint(namespace: string, actor: string, digest: string): Promise<void> {
    return this.lock(['fingerprint', namespace, actor, digest]);
  }
  public lockReceipt(namespace: string, actor: string, key: string): Promise<void> {
    return this.lock(['receipt', namespace, actor, key]);
  }
  public async lockRun(id: string): Promise<void> {
    await this.lock(['run', id]);
    await this.manager
      .getRepository(AiRunEntity)
      .createQueryBuilder('run')
      .select('run.id')
      .where('run.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();
  }
  public findReceipt(
    namespace: string,
    actor: string,
    key: string,
  ): Promise<AiReceiptRecord | null> {
    return this.manager.findOneBy(AiReceiptEntity, {
      deploymentNamespace: namespace,
      actorUserId: actor,
      key,
    });
  }
  private runRecord(run: AiRunEntity | null): AiRunRecord | null {
    return run
      ? {
          ...run,
          snapshot: aiRunSnapshotSchema.parse(run.snapshot),
          usage: normalizedUsageSchema.parse(run.usage),
        }
      : null;
  }
  public async findActive(
    namespace: string,
    actor: string,
    fingerprint: string,
  ): Promise<AiRunRecord | null> {
    const run = await this.manager
      .getRepository(AiRunEntity)
      .createQueryBuilder('run')
      .where(
        'run.deploymentNamespace = :namespace AND run.actorUserId = :actor AND run.fingerprint = :fingerprint',
        { namespace, actor, fingerprint },
      )
      .andWhere('run.phase IN (:...phases)', {
        phases: ['pending-admission', 'admitted', 'dispatching'],
      })
      .getOne();
    return this.runRecord(run);
  }
  public async findRun(namespace: string, actor: string, id: string): Promise<AiRunRecord | null> {
    return this.runRecord(
      await this.manager.findOneBy(AiRunEntity, {
        deploymentNamespace: namespace,
        actorUserId: actor,
        id,
      }),
    );
  }
  public async insertRun(run: AiRunRecord): Promise<void> {
    await this.manager.insert(AiRunEntity, run);
  }
  public async updateRun(run: AiRunRecord): Promise<void> {
    await this.manager.update(
      AiRunEntity,
      { id: run.id, deploymentNamespace: run.deploymentNamespace, actorUserId: run.actorUserId },
      {
        phase: run.phase,
        updatedAt: run.updatedAt,
        dispatchToken: run.dispatchToken,
        leaseExpiresAt: run.leaseExpiresAt,
        payloadId: run.payloadId,
        payloadExpiresAt: run.payloadExpiresAt,
        usage: run.usage,
        failureCode: run.failureCode,
      },
    );
  }
  public async insertReceipt(receipt: AiReceiptRecord): Promise<void> {
    await this.manager.insert(AiReceiptEntity, receipt);
  }
  public findReservation(runId: string): Promise<AiReservationRecord | null> {
    return this.manager
      .getRepository(AiReservationEntity)
      .createQueryBuilder('hold')
      .where('hold.runId = :runId', { runId })
      .setLock('pessimistic_write')
      .getOne();
  }
  public async insertReservation(reservation: AiReservationRecord): Promise<void> {
    await this.manager.insert(AiReservationEntity, reservation);
  }
  public async updateReservation(reservation: AiReservationRecord): Promise<void> {
    await this.manager.update(
      AiReservationEntity,
      { runId: reservation.runId },
      { status: reservation.status, fundedAt: reservation.fundedAt },
    );
  }
  public async findSettlement(runId: string): Promise<AiSettlement | null> {
    const record = await this.manager.findOneBy(AiSettlementEntity, { runId });
    return record ? aiSettlementSchema.parse(record) : null;
  }
  public async insertSettlement(settlement: AiSettlement): Promise<void> {
    await this.manager.insert(AiSettlementEntity, settlement);
  }
  public async insertPayload(payload: AiEncryptedPayload): Promise<void> {
    await this.manager.insert(AiPayloadEntity, {
      ...payload,
      nonce: Buffer.from(payload.nonce),
      tag: Buffer.from(payload.tag),
      ciphertext: Buffer.from(payload.ciphertext),
    });
  }
  public findPayload(
    namespace: string,
    actor: string,
    id: string,
  ): Promise<AiEncryptedPayload | null> {
    return this.manager.findOneBy(AiPayloadEntity, {
      deploymentNamespace: namespace,
      actorUserId: actor,
      id,
    });
  }
  public async deleteExpiredPayloads(namespace: string, maximum: number): Promise<number> {
    if (!Number.isSafeInteger(maximum) || maximum <= 0 || maximum > MAX_CLEANUP_BATCH)
      throw new AiPersistenceError('TEMPORARILY_UNAVAILABLE');
    await this.lock(['global', namespace]);
    const rows = await this.manager
      .getRepository(AiPayloadEntity)
      .createQueryBuilder('payload')
      .select('payload.id')
      .where(
        'payload.deploymentNamespace = :namespace AND payload.expiresAt <= clock_timestamp()',
        { namespace },
      )
      .orderBy('payload.expiresAt', 'ASC')
      .addOrderBy('payload.id', 'ASC')
      .take(maximum)
      .setLock('pessimistic_write')
      .getMany();
    if (!rows.length) return 0;
    const deleted = await this.manager
      .getRepository(AiPayloadEntity)
      .createQueryBuilder()
      .delete()
      .whereInIds(rows.map((row) => row.id))
      .execute();
    return deleted.affected ?? 0;
  }
}
