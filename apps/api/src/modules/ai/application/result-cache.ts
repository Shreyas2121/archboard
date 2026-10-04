import type { AiPolicy } from './operator-policy.js';
import type {
  AiCacheRecord,
  AiEncryptedPayload,
  AiIntent,
  AiPayloadCipher,
  AiPayloadSummary,
  AiPersistenceScope,
  AiRunRecord,
} from './persistence.js';
import { canonicalAiJson } from './private-identity.js';

const MAX_EVICTIONS = 64;
/** Authoritative only inside the namespace/fingerprint coordination transaction. */
export class AiResultCache {
  public constructor(
    private readonly cipher: AiPayloadCipher,
    private readonly limits: AiPolicy['cache'],
  ) {}
  public async lookup(
    scope: AiPersistenceScope,
    intent: AiIntent,
    now: Date,
  ): Promise<AiRunRecord | null> {
    const record = await scope.findCache(
      intent.deploymentNamespace,
      intent.actorUserId,
      intent.fingerprint,
    );
    if (!record) return null;
    if (record.expiresAt <= now) return null;
    const run = await scope.findRun(intent.deploymentNamespace, intent.actorUserId, record.runId);
    if (
      !run ||
      run.boardId !== intent.boardId ||
      run.phase !== 'completed' ||
      run.failureCode !== null ||
      run.usage.status !== 'known' ||
      run.requestHash !== intent.requestHash ||
      run.fingerprint !== intent.fingerprint ||
      run.task !== intent.task ||
      canonicalAiJson(run.snapshot) !== canonicalAiJson(intent.snapshot) ||
      run.payloadId !== record.payloadId ||
      run.payloadExpiresAt?.getTime() !== record.expiresAt.getTime()
    )
      return null;
    const payload = await scope.findPayload(
      intent.deploymentNamespace,
      intent.actorUserId,
      record.payloadId,
    );
    if (
      !payload ||
      payload.originRunId !== run.id ||
      payload.expiresAt <= now ||
      payload.expiresAt.getTime() !== record.expiresAt.getTime()
    )
      return null;
    try {
      this.cipher.open(payload);
    } catch {
      return null;
    }
    return run;
  }
  public async retain(
    scope: AiPersistenceScope,
    payload: AiEncryptedPayload,
    record: AiCacheRecord | null,
  ): Promise<boolean> {
    // All result payloads count, not just cache-index entries. Capacity reductions
    // may evict old content; immutable accounting/receipts never change.
    if (payload.byteLength > this.limits.bytes || payload.byteLength > this.limits.actorBytes)
      return false;
    const kept = await scope.tryContent(async () => {
      const ns = payload.deploymentNamespace;
      const actor = payload.actorUserId;
      const global = await scope.payloadUsage(ns);
      const personal = await scope.payloadUsage(ns, actor);
      const selected = new Map<string, AiPayloadSummary>();
      const fits = (usage: { entries: number; bytes: number }, entries: number, bytes: number) =>
        usage.entries + 1 <= entries && usage.bytes + payload.byteLength <= bytes;
      const evict = (candidate: AiPayloadSummary) => {
        if (selected.has(candidate.id)) return;
        selected.set(candidate.id, candidate);
        global.entries--;
        global.bytes -= candidate.byteLength;
        if (candidate.actorUserId === actor) {
          personal.entries--;
          personal.bytes -= candidate.byteLength;
        }
      };
      if (!fits(personal, this.limits.actorEntries, this.limits.actorBytes)) {
        for (const candidate of await scope.oldestPayloads(ns, actor)) {
          if (
            fits(personal, this.limits.actorEntries, this.limits.actorBytes) ||
            selected.size >= MAX_EVICTIONS
          )
            break;
          evict(candidate);
        }
      }
      if (!fits(global, this.limits.entries, this.limits.bytes)) {
        for (const candidate of await scope.oldestPayloads(ns)) {
          if (
            fits(global, this.limits.entries, this.limits.bytes) ||
            selected.size >= MAX_EVICTIONS
          )
            break;
          evict(candidate);
        }
      }
      if (
        !fits(personal, this.limits.actorEntries, this.limits.actorBytes) ||
        !fits(global, this.limits.entries, this.limits.bytes)
      ) {
        // A sharp operator capacity reduction may require several bounded
        // passes. Make cleanup progress without inserting above either cap.
        await scope.deletePayloads(ns, [...selected.keys()]);
        return false;
      }
      await scope.deletePayloads(ns, [...selected.keys()]);
      await scope.insertPayload(payload);
      // An optional index failure cannot roll back valid retained content or settlement.
      if (record)
        await scope.tryContent(async () => {
          await scope.putCache(record);
          return true;
        });
      return true;
    });
    return kept === true;
  }
}
