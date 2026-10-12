import {
  AiPersistenceError,
  type AiPersistence,
  type AiPersistenceScope,
  type AiRunRecord,
  type AiReceiptRecord,
  type AiReservationRecord,
  type AiSettlement,
  type AiEncryptedPayload,
  type AiCacheRecord,
} from '../../application/persistence.js';
import type { ErrorCode } from '@archboard/contracts';
import type {
  AiLedgerRecord,
  AiAllocationRecord,
  AiAttemptRecord,
} from '../../application/persistence.js';
import { aiLedgerIdentity } from '../../application/admission-service.js';
const MAX_CONTENT_BATCH = 64;

// Preserve Date/byte prototypes in the Jest VM; structuredClone produces host-
// realm objects that strict schemas deliberately do not recognize as VM dates.
function clone<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (value instanceof Uint8Array) return Uint8Array.from(value) as T;
  if (value instanceof Map)
    return new Map([...value].map(([key, item]) => [key, clone(item)])) as T;
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  if (value !== null && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) as T;
  return value;
}

/** Transactional test adapter. Its queue/Maps are never production coordination. */
export class InMemoryAiPersistence implements AiPersistence {
  public state = {
    runs: new Map<string, AiRunRecord>(),
    receipts: new Map<string, AiReceiptRecord>(),
    reservations: new Map<string, AiReservationRecord>(),
    settlements: new Map<string, AiSettlement>(),
    payloads: new Map<string, AiEncryptedPayload>(),
    cache: new Map<string, AiCacheRecord>(),
    ledger: new Map<string, AiLedgerRecord>(),
    allocations: [] as AiAllocationRecord[],
    attempts: [] as AiAttemptRecord[],
  };
  public clock = new Date('2026-10-04T10:00:00Z');
  public denied = new Map<string, ErrorCode>();
  public locks: string[] = [];
  public failReceipt = false;
  public failPayload = false;
  public failCache = false;
  private tail: Promise<void> = Promise.resolve();
  public async run<T>(work: (scope: AiPersistenceScope) => Promise<T>): Promise<T> {
    const before = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await before;
    const state = clone(this.state);
    const key = (namespace: string, actor: string, receipt: string) =>
      JSON.stringify([namespace, actor, receipt]);
    const own = (run: AiRunRecord | undefined, namespace: string, actor: string) =>
      run?.deploymentNamespace === namespace && run.actorUserId === actor ? clone(run) : null;
    const copy = <V>(value: V | undefined): V | null => (value === undefined ? null : clone(value));
    const scope: AiPersistenceScope = {
      expiredRuns: async (ns) =>
        [...state.runs.values()]
          .filter(
            (r) =>
              r.deploymentNamespace === ns &&
              ['pending-admission', 'admitted', 'dispatching'].includes(r.phase) &&
              (r.phase === 'dispatching'
                ? r.leaseExpiresAt !== null && r.leaseExpiresAt <= this.clock
                : r.deadlineAt <= this.clock),
          )
          .sort(
            (a, b) => a.deadlineAt.getTime() - b.deadlineAt.getTime() || a.id.localeCompare(b.id),
          )
          .slice(0, MAX_CONTENT_BATCH)
          .map(({ id, actorUserId }) => ({ id, actorUserId })),
      expiredPayloadCount: async (ns) =>
        [...state.payloads.values()].filter(
          (p) => p.deploymentNamespace === ns && p.expiresAt <= this.clock,
        ).length,
      findCache: async (ns, actor, fingerprint) =>
        copy(state.cache.get(key(ns, actor, fingerprint))),
      putCache: async (record) => {
        if (this.failCache) throw new Error('private cache failure');
        state.cache.set(
          key(record.deploymentNamespace, record.actorUserId, record.fingerprint),
          clone(record),
        );
      },
      payloadUsage: async (ns, actor) => {
        const rows = [...state.payloads.values()].filter(
          (p) => p.deploymentNamespace === ns && (actor === undefined || p.actorUserId === actor),
        );
        return { entries: rows.length, bytes: rows.reduce((sum, p) => sum + p.byteLength, 0) };
      },
      oldestPayloads: async (ns, actor) =>
        clone(
          [...state.payloads.values()]
            .filter(
              (p) =>
                p.deploymentNamespace === ns && (actor === undefined || p.actorUserId === actor),
            )
            .sort(
              (a, b) => a.expiresAt.getTime() - b.expiresAt.getTime() || a.id.localeCompare(b.id),
            )
            .slice(0, MAX_CONTENT_BATCH)
            .map(({ id, actorUserId, byteLength, expiresAt }) => ({
              id,
              actorUserId,
              byteLength,
              expiresAt,
            })),
        ),
      deletePayloads: async (ns, ids) => {
        for (const id of ids) {
          if (state.payloads.get(id)?.deploymentNamespace !== ns) continue;
          state.payloads.delete(id);
          for (const [key, entry] of state.cache)
            if (entry.payloadId === id) state.cache.delete(key);
        }
      },
      tryContent: async (work) => {
        const before = { payloads: clone(state.payloads), cache: clone(state.cache) };
        try {
          return await work();
        } catch {
          state.payloads = before.payloads;
          state.cache = before.cache;
          return null;
        }
      },
      readLedgers: async (keys) =>
        keys.map((key) =>
          clone(
            state.ledger.get(aiLedgerIdentity(key)) ?? { ...key, committed: '0', reserved: '0' },
          ),
        ),
      getLedger: async (key) => {
        const id = aiLedgerIdentity(key);
        let row = state.ledger.get(id);
        if (!row) {
          row = { ...clone(key), committed: '0', reserved: '0' };
          state.ledger.set(id, row);
        }
        return clone(row);
      },
      prepareLedgers: async (keys) => {
        for (const key of keys) {
          const id = aiLedgerIdentity(key);
          if (!state.ledger.has(id))
            state.ledger.set(id, { ...clone(key), committed: '0', reserved: '0' });
        }
      },
      saveLedger: async (row) => {
        state.ledger.set(aiLedgerIdentity(row), clone(row));
      },
      findAllocations: async (id) => clone(state.allocations.filter((row) => row.runId === id)),
      insertAllocations: async (rows) => {
        state.allocations.push(...clone(rows));
      },
      findAttempts: async (id) => clone(state.attempts.filter((row) => row.runId === id)),
      insertAttempt: async (row) => {
        if (
          state.attempts.some((value) => value.runId === row.runId && value.ordinal === row.ordinal)
        )
          throw new Error('duplicate attempt');
        state.attempts.push(clone(row));
      },
      now: async () => new Date(this.clock),
      authorize: async (actor, board) => {
        this.locks.push('authority');
        const code = this.denied.get(JSON.stringify([actor, board]));
        if (code) throw new AiPersistenceError(code);
      },
      lockAdmission: async () => {
        this.locks.push('global', 'actor');
      },
      lockRequest: async () => {
        this.locks.push('request');
      },
      lockFingerprint: async () => {
        this.locks.push('fingerprint');
      },
      lockReceipt: async () => {
        this.locks.push('receipt');
      },
      lockRun: async () => {
        this.locks.push('run');
      },
      findReceipt: async (ns, actor, id) => copy(state.receipts.get(key(ns, actor, id))),
      findActive: async (ns, actor, fingerprint) =>
        copy(
          [...state.runs.values()].find(
            (run) =>
              run.deploymentNamespace === ns &&
              run.actorUserId === actor &&
              run.fingerprint === fingerprint &&
              ['pending-admission', 'admitted', 'dispatching'].includes(run.phase),
          ),
        ),
      findRun: async (ns, actor, id) => own(state.runs.get(id), ns, actor),
      insertRun: async (run) => {
        if (state.runs.has(run.id)) throw new Error('duplicate');
        state.runs.set(run.id, clone(run));
      },
      updateRun: async (run) => {
        state.runs.set(run.id, clone(run));
      },
      insertReceipt: async (receipt) => {
        if (this.failReceipt) throw new AiPersistenceError('TEMPORARILY_UNAVAILABLE');
        const id = key(receipt.deploymentNamespace, receipt.actorUserId, receipt.key);
        if (state.receipts.has(id)) throw new Error('duplicate');
        state.receipts.set(id, clone(receipt));
      },
      findReservation: async (id) => copy(state.reservations.get(id)),
      insertReservation: async (hold) => {
        state.reservations.set(hold.runId, clone(hold));
      },
      updateReservation: async (hold) => {
        state.reservations.set(hold.runId, clone(hold));
      },
      findSettlement: async (id) => copy(state.settlements.get(id)),
      insertSettlement: async (final) => {
        if (state.settlements.has(final.runId)) throw new Error('duplicate');
        state.settlements.set(final.runId, clone(final));
      },
      insertPayload: async (payload) => {
        if (this.failPayload) throw new Error('private payload failure');
        state.payloads.set(payload.id, clone(payload));
      },
      findPayload: async (ns, actor, id) => {
        const payload = state.payloads.get(id);
        return payload?.deploymentNamespace === ns && payload.actorUserId === actor
          ? clone(payload)
          : null;
      },
      deleteExpiredPayloads: async (ns, maximum) => {
        const ids = [...state.payloads.values()]
          .filter(
            (payload) => payload.deploymentNamespace === ns && payload.expiresAt <= this.clock,
          )
          .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())
          .slice(0, maximum)
          .map((payload) => payload.id);
        await scope.deletePayloads(ns, ids);
        return ids.length;
      },
    };
    try {
      const result = await work(scope);
      this.state = state;
      return result;
    } finally {
      release();
    }
  }
}
