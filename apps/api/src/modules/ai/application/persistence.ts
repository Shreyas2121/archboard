import { z } from 'zod';
import {
  aiErrorCodeSchema,
  aiTaskSchema,
  aiUnsignedDecimalSchema,
  applicationIdSchema,
  type AiResult,
  type ErrorCode,
} from '@archboard/contracts';
import { AI_VERSIONS, type AiResolvedConfiguration } from './operator-policy.js';
import { normalizedUsageSchema, type NormalizedUsage } from './provider.js';

export const AI_PERSISTENCE = Symbol('AI_PERSISTENCE');
export const AI_PAYLOAD_CIPHER = Symbol('AI_PAYLOAD_CIPHER');
export const AI_INTENT_SERVICE = Symbol('AI_INTENT_SERVICE');
const MAX_IDENTIFIER = 128;
const MAX_ACTOR = 256;
const MAX_DEADLINE_MS = 120_000;
const MAX_RECEIPT_TTL_MS = 86_400_000;
const MAX_RESULT_TTL_MS = 900_000;
const MAX_ATTEMPTS = 3;
const MAX_CACHE_WRITE_CLASSES = 16;
const MAX_PG_BIGINT = 9223372036854775807n;
const ZERO_MONEY = 0n;
export const aiIdentifierSchema = z
  .string()
  .min(1)
  .max(MAX_IDENTIFIER)
  .regex(/^[A-Za-z0-9_.:-]+$/);
export const aiActorSchema = z.string().min(1).max(MAX_ACTOR);
export const aiDigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const aiMoneySchema = aiUnsignedDecimalSchema.refine(
  (value) => BigInt(value) <= MAX_PG_BIGINT,
);
const positiveCount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const positiveMoney = aiMoneySchema.refine((value) => BigInt(value) > ZERO_MONEY);
export const aiRunSnapshotSchema = z.strictObject({
  provider: z.literal('openai'),
  model: aiIdentifierSchema,
  configurationVersion: aiIdentifierSchema,
  configurationFingerprint: aiDigestSchema,
  pricingVersion: aiIdentifierSchema,
  tokenCountingVersion: aiIdentifierSchema,
  versions: z.strictObject({
    prompt: z.literal(AI_VERSIONS.prompt),
    schema: z.literal(AI_VERSIONS.schema),
    adapter: z.literal(AI_VERSIONS.adapter),
    policy: z.literal(AI_VERSIONS.policy),
  }),
  contextWindowTokens: positiveCount,
  maximumInputTokens: positiveCount,
  maximumOutputTokens: positiveCount,
  prices: z.strictObject({
    uncachedInputMicroUsdPerMillion: aiMoneySchema,
    cacheReadMicroUsdPerMillion: aiMoneySchema,
    cacheWrites: z
      .array(z.strictObject({ writeClass: aiIdentifierSchema, microUsdPerMillion: aiMoneySchema }))
      .max(MAX_CACHE_WRITE_CLASSES),
    outputMicroUsdPerMillion: aiMoneySchema,
    separateReasoningMicroUsdPerMillion: aiMoneySchema.nullable(),
  }),
  deadlineMs: positiveCount.max(MAX_DEADLINE_MS),
  receiptTtlMs: positiveCount.max(MAX_RECEIPT_TTL_MS),
  resultTtlMs: positiveCount.max(MAX_RESULT_TTL_MS),
});
export type AiRunSnapshot = z.infer<typeof aiRunSnapshotSchema>;
export function snapshotAiConfiguration(config: AiResolvedConfiguration): AiRunSnapshot {
  return aiRunSnapshotSchema.parse({
    provider: config.provider,
    model: config.profile.model,
    configurationVersion: config.policy.configurationVersion,
    configurationFingerprint: config.policy.fingerprint,
    pricingVersion: config.profile.pricingVersion,
    tokenCountingVersion: config.profile.tokenCountingVersion,
    versions: config.policy.versions,
    prices: config.profile.prices,
    contextWindowTokens: config.profile.contextWindowTokens,
    maximumInputTokens: config.profile.maximumInputTokens,
    maximumOutputTokens: config.profile.maximumOutputTokens,
    deadlineMs: config.policy.limits.deadlineMs,
    receiptTtlMs: config.policy.cache.receiptTtlMs,
    resultTtlMs: config.policy.cache.ttlMs,
  });
}
export const AI_PERSISTED_PHASES = [
  'pending-admission',
  'admitted',
  'dispatching',
  'completed',
  'refused',
  'incomplete',
  'failed',
  'cancelled',
  'outcome-unknown',
] as const;
export type AiPersistedPhase = (typeof AI_PERSISTED_PHASES)[number];
export const AI_TERMINAL_PHASES = [
  'completed',
  'refused',
  'incomplete',
  'failed',
  'cancelled',
  'outcome-unknown',
] as const;
export const aiIntentSchema = z.strictObject({
  deploymentNamespace: aiIdentifierSchema,
  actorUserId: aiActorSchema,
  boardId: applicationIdSchema.nullable(),
  key: applicationIdSchema,
  requestHash: aiDigestSchema,
  fingerprint: aiDigestSchema,
  task: aiTaskSchema,
  snapshot: aiRunSnapshotSchema,
  reservation: z.strictObject({
    maximumMicroUsd: positiveMoney,
    inputTokens: positiveMoney,
    outputTokens: positiveMoney,
    maximumAttempts: positiveCount.max(MAX_ATTEMPTS),
  }),
});
export type AiIntent = z.infer<typeof aiIntentSchema>;
export interface AiRunRecord {
  id: string;
  deploymentNamespace: string;
  actorUserId: string;
  boardId: string | null;
  requestHash: string;
  fingerprint: string;
  task: AiIntent['task'];
  snapshot: AiRunSnapshot;
  phase: AiPersistedPhase;
  createdAt: Date;
  updatedAt: Date;
  deadlineAt: Date;
  dispatchToken: string | null;
  leaseExpiresAt: Date | null;
  payloadId: string | null;
  payloadExpiresAt: Date | null;
  usage: NormalizedUsage;
  failureCode: z.infer<typeof aiErrorCodeSchema> | null;
}
export interface AiReceiptRecord {
  deploymentNamespace: string;
  actorUserId: string;
  key: string;
  requestHash: string;
  runId: string;
  createdAt: Date;
  expiresAt: Date;
}
export type AiReservationRecord = AiIntent['reservation'] & {
  runId: string;
  status: 'pending' | 'reserved' | 'settled' | 'unknown';
  fundedAt: Date | null;
};
export const aiSettlementSchema = z
  .strictObject({
    runId: applicationIdSchema,
    dispatchToken: applicationIdSchema.nullable(),
    mode: z.enum(['known', 'unknown', 'unsent']),
    phase: z.enum(AI_TERMINAL_PHASES),
    actualMicroUsd: aiMoneySchema.nullable(),
    usage: normalizedUsageSchema,
    failureCode: aiErrorCodeSchema.nullable(),
  })
  .superRefine((value, context) => {
    if (value.mode !== 'unsent' && value.dispatchToken === null)
      context.addIssue({
        code: 'custom',
        message: 'Settlement must match the durable dispatch fence.',
      });
    if (value.mode === 'unsent' && value.phase === 'completed')
      context.addIssue({
        code: 'custom',
        message: 'Unsent work cannot produce a completed result.',
      });
    if ((value.mode === 'unknown') !== (value.actualMicroUsd === null))
      context.addIssue({ code: 'custom', message: 'Unknown financial outcome retains liability.' });
    if (value.mode === 'unsent' && value.actualMicroUsd !== '0')
      context.addIssue({ code: 'custom', message: 'Unsent work has no charge.' });
    if (value.mode === 'known' && value.usage.status !== 'known')
      context.addIssue({ code: 'custom', message: 'Known settlement requires known usage.' });
    if (value.phase === 'outcome-unknown' && value.mode !== 'unknown')
      context.addIssue({ code: 'custom', message: 'Unknown execution cannot release liability.' });
  });
export type AiSettlement = z.infer<typeof aiSettlementSchema>;
export interface AiPayloadBinding {
  deploymentNamespace: string;
  actorUserId: string;
  originRunId: string;
  id: string;
  schemaVersion: 1;
  keyVersion: string;
  expiresAt: Date;
}
export interface AiEncryptedPayload extends AiPayloadBinding {
  nonce: Uint8Array;
  tag: Uint8Array;
  ciphertext: Uint8Array;
  byteLength: number;
}
export interface AiPayloadCipher {
  readonly keyVersion: string;
  seal(binding: AiPayloadBinding, result: AiResult): AiEncryptedPayload;
  open(payload: AiEncryptedPayload): AiResult;
}
export class AiPersistenceError extends Error {
  public constructor(public readonly code: ErrorCode) {
    super('AI persistence operation failed.');
    this.name = 'AiPersistenceError';
  }
}
export interface AiPersistenceScope {
  getLedger(key: AiLedgerKey): Promise<AiLedgerRecord>;
  saveLedger(record: AiLedgerRecord): Promise<void>;
  findAllocations(runId: string): Promise<AiAllocationRecord[]>;
  insertAllocations(records: AiAllocationRecord[]): Promise<void>;
  findAttempts(runId: string): Promise<AiAttemptRecord[]>;
  insertAttempt(record: AiAttemptRecord): Promise<void>;
  now(): Promise<Date>;
  authorize(actorUserId: string, boardId: string | null): Promise<void>;
  lockAdmission(namespace: string, actorUserId: string): Promise<void>;
  lockFingerprint(namespace: string, actorUserId: string, fingerprint: string): Promise<void>;
  lockReceipt(namespace: string, actorUserId: string, key: string): Promise<void>;
  lockRun(runId: string): Promise<void>;
  findReceipt(namespace: string, actorUserId: string, key: string): Promise<AiReceiptRecord | null>;
  findActive(
    namespace: string,
    actorUserId: string,
    fingerprint: string,
  ): Promise<AiRunRecord | null>;
  findRun(namespace: string, actorUserId: string, id: string): Promise<AiRunRecord | null>;
  insertRun(run: AiRunRecord): Promise<void>;
  updateRun(run: AiRunRecord): Promise<void>;
  insertReceipt(receipt: AiReceiptRecord): Promise<void>;
  findReservation(runId: string): Promise<AiReservationRecord | null>;
  insertReservation(reservation: AiReservationRecord): Promise<void>;
  updateReservation(reservation: AiReservationRecord): Promise<void>;
  findSettlement(runId: string): Promise<AiSettlement | null>;
  insertSettlement(settlement: AiSettlement): Promise<void>;
  insertPayload(payload: AiEncryptedPayload): Promise<void>;
  findPayload(
    namespace: string,
    actorUserId: string,
    id: string,
  ): Promise<AiEncryptedPayload | null>;
  deleteExpiredPayloads(namespace: string, maximum: number): Promise<number>;
}
export interface AiLedgerKey {
  kind: 'capacity' | 'budget';
  deploymentNamespace: string;
  scope: 'global' | 'actor';
  subject: string;
  metric: string;
  period: 'second' | 'minute' | 'day' | 'month' | 'lifetime' | 'active';
  periodStart: Date;
}
export interface AiLedgerRecord extends AiLedgerKey {
  committed: string;
  reserved: string;
}
export interface AiAllocationRecord extends AiLedgerKey {
  runId: string;
  amount: string;
}
export interface AiAttemptRecord {
  runId: string;
  ordinal: number;
  dispatchToken: string;
  claimedAt: Date;
  inputCapacity: string;
  outputCapacity: string;
}
export interface AiPersistence {
  run<T>(work: (scope: AiPersistenceScope) => Promise<T>): Promise<T>;
}
