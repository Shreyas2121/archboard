import {
  AiPersistenceError,
  type AiPersistence,
  type AiPersistenceScope,
  type AiRunRecord,
  type AiReceiptRecord,
  type AiReservationRecord,
  type AiSettlement,
  type AiEncryptedPayload,
} from '../../application/persistence.js';
import type { ErrorCode } from '@archboard/contracts';

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
  };
  public clock = new Date('2026-10-04T10:00:00Z');
  public denied = new Map<string, ErrorCode>();
  public locks: string[] = [];
  public failReceipt = false;
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
      now: async () => new Date(this.clock),
      authorize: async (actor, board) => {
        this.locks.push('authority');
        const code = this.denied.get(JSON.stringify([actor, board]));
        if (code) throw new AiPersistenceError(code);
      },
      lockAdmission: async () => {
        this.locks.push('global', 'actor');
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
        ids.forEach((id) => state.payloads.delete(id));
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
