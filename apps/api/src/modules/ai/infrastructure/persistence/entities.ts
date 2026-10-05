import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type {
  AiRunRecord,
  AiReceiptRecord,
  AiReservationRecord,
  AiSettlement,
  AiCacheRecord,
} from '../../application/persistence.js';

@Entity({ name: 'ai_runs' })
@Index('UQ_ai_runs_owner', ['deploymentNamespace', 'actorUserId', 'id'], { unique: true })
@Index('IDX_ai_runs_active_deadline', ['deploymentNamespace', 'deadlineAt', 'id'], {
  where: "\"phase\" IN ('pending-admission', 'admitted', 'dispatching')",
})
@Index('UQ_ai_runs_active', ['deploymentNamespace', 'actorUserId', 'fingerprint'], {
  unique: true,
  where: "\"phase\" IN ('pending-admission', 'admitted', 'dispatching')",
})
export class AiRunEntity implements AiRunRecord {
  @PrimaryColumn({ name: 'id', type: 'uuid' })
  id!: string;
  @Column({ name: 'deployment_namespace', type: 'text' })
  deploymentNamespace!: string;
  @Column({ name: 'actor_user_id', type: 'text' })
  actorUserId!: string;
  @Column({ name: 'board_id', type: 'uuid', nullable: true })
  boardId!: string | null;
  @Column({ name: 'request_hash', type: 'text' })
  requestHash!: string;
  @Column({ name: 'fingerprint', type: 'text' })
  fingerprint!: string;
  @Column({ name: 'task', type: 'text' })
  task!: AiRunRecord['task'];
  @Column({ name: 'snapshot', type: 'jsonb' })
  snapshot!: AiRunRecord['snapshot'];
  @Column({ name: 'phase', type: 'text' })
  phase!: AiRunRecord['phase'];
  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
  @Column({ name: 'deadline_at', type: 'timestamptz' })
  deadlineAt!: Date;
  @Column({ name: 'dispatch_token', type: 'uuid', nullable: true })
  dispatchToken!: string | null;
  @Column({ name: 'lease_expires_at', type: 'timestamptz', nullable: true })
  leaseExpiresAt!: Date | null;
  @Column({ name: 'payload_id', type: 'uuid', nullable: true })
  payloadId!: string | null;
  @Column({ name: 'payload_expires_at', type: 'timestamptz', nullable: true })
  payloadExpiresAt!: Date | null;
  @Column({ name: 'usage', type: 'jsonb' })
  usage!: AiRunRecord['usage'];
  @Column({ name: 'failure_code', type: 'text', nullable: true })
  failureCode!: AiRunRecord['failureCode'];
}

@Entity({ name: 'ai_result_cache' })
export class AiCacheEntity implements AiCacheRecord {
  @PrimaryColumn({ name: 'deployment_namespace', type: 'text' }) deploymentNamespace!: string;
  @PrimaryColumn({ name: 'actor_user_id', type: 'text' }) actorUserId!: string;
  @PrimaryColumn({ name: 'fingerprint', type: 'text' }) fingerprint!: string;
  @Column({ name: 'run_id', type: 'uuid' }) runId!: string;
  @Column({ name: 'payload_id', type: 'uuid' }) payloadId!: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'expires_at', type: 'timestamptz' }) expiresAt!: Date;
}

@Entity({ name: 'ai_creation_receipts' })
export class AiReceiptEntity implements AiReceiptRecord {
  @PrimaryColumn({ name: 'deployment_namespace', type: 'text' })
  deploymentNamespace!: string;
  @PrimaryColumn({ name: 'actor_user_id', type: 'text' })
  actorUserId!: string;
  @PrimaryColumn({ name: 'key', type: 'uuid' })
  key!: string;
  @Column({ name: 'request_hash', type: 'text' })
  requestHash!: string;
  @Column({ name: 'run_id', type: 'uuid' })
  runId!: string;
  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
}

@Entity({ name: 'ai_reservations' })
export class AiReservationEntity implements AiReservationRecord {
  @PrimaryColumn({ name: 'run_id', type: 'uuid' })
  runId!: string;
  @Column({ name: 'maximum_micro_usd', type: 'bigint' })
  maximumMicroUsd!: string;
  @Column({ name: 'input_capacity', type: 'bigint' })
  inputTokens!: string;
  @Column({ name: 'output_capacity', type: 'bigint' })
  outputTokens!: string;
  @Column({ name: 'maximum_attempts', type: 'integer' })
  maximumAttempts!: number;
  @Column({ name: 'status', type: 'text' })
  status!: AiReservationRecord['status'];
  @Column({ name: 'funded_at', type: 'timestamptz', nullable: true })
  fundedAt!: Date | null;
}

@Entity({ name: 'ai_settlements' })
export class AiSettlementEntity implements AiSettlement {
  @PrimaryColumn({ name: 'run_id', type: 'uuid' })
  runId!: string;
  @Column({ name: 'dispatch_token', type: 'uuid', nullable: true })
  dispatchToken!: string | null;
  @Column({ name: 'mode', type: 'text' })
  mode!: AiSettlement['mode'];
  @Column({ name: 'phase', type: 'text' })
  phase!: AiSettlement['phase'];
  @Column({ name: 'actual_micro_usd', type: 'bigint', nullable: true })
  actualMicroUsd!: string | null;
  @Column({ name: 'usage', type: 'jsonb' })
  usage!: AiSettlement['usage'];
  @Column({ name: 'failure_code', type: 'text', nullable: true })
  failureCode!: AiSettlement['failureCode'];
}

@Entity({ name: 'ai_private_payloads' })
export class AiPayloadEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid' })
  id!: string;
  @Column({ name: 'deployment_namespace', type: 'text' })
  deploymentNamespace!: string;
  @Column({ name: 'actor_user_id', type: 'text' })
  actorUserId!: string;
  @Column({ name: 'origin_run_id', type: 'uuid' })
  originRunId!: string;
  @Column({ name: 'schema_version', type: 'integer' })
  schemaVersion!: 1;
  @Column({ name: 'key_version', type: 'text' })
  keyVersion!: string;
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;
  @Column({ name: 'nonce', type: 'bytea' })
  nonce!: Buffer;
  @Column({ name: 'tag', type: 'bytea' })
  tag!: Buffer;
  @Column({ name: 'ciphertext', type: 'bytea' })
  ciphertext!: Buffer;
  @Column({ name: 'byte_length', type: 'integer' })
  byteLength!: number;
}

@Entity({ name: 'ai_capacity_scopes' })
export class AiCounterEntity {
  @PrimaryColumn({ name: 'deployment_namespace', type: 'text' })
  deploymentNamespace!: string;
  @PrimaryColumn({ name: 'scope', type: 'text' })
  scope!: 'global' | 'actor';
  @PrimaryColumn({ name: 'subject', type: 'text' })
  subject!: string;
  @PrimaryColumn({ name: 'metric', type: 'text' })
  metric!:
    | 'create'
    | 'fresh'
    | 'provider-request'
    | 'provider-input'
    | 'provider-output'
    | 'concurrency'
    | 'poll'
    | 'sse';
  @PrimaryColumn({ name: 'period', type: 'text' })
  period!: 'second' | 'minute' | 'day' | 'active';
  @PrimaryColumn({ name: 'period_start', type: 'timestamptz' })
  periodStart!: Date;
  @Column({ name: 'committed', type: 'bigint' })
  committed!: string;
  @Column({ name: 'reserved', type: 'bigint' })
  reserved!: string;
}

@Entity({ name: 'ai_budget_periods' })
export class AiBudgetPeriodEntity {
  @PrimaryColumn({ name: 'deployment_namespace', type: 'text' })
  deploymentNamespace!: string;
  @PrimaryColumn({ name: 'scope', type: 'text' })
  scope!: 'global' | 'actor';
  @PrimaryColumn({ name: 'subject', type: 'text' })
  subject!: string;
  @PrimaryColumn({ name: 'period', type: 'text' })
  period!: 'day' | 'month' | 'lifetime';
  @PrimaryColumn({ name: 'period_start', type: 'timestamptz' })
  periodStart!: Date;
  @Column({ name: 'committed_micro_usd', type: 'bigint' })
  committedMicroUsd!: string;
  @Column({ name: 'reserved_micro_usd', type: 'bigint' })
  reservedMicroUsd!: string;
}

@Entity({ name: 'ai_reservation_allocations' })
export class AiAllocationEntity {
  @PrimaryColumn({ name: 'run_id', type: 'uuid' })
  runId!: string;
  @PrimaryColumn({ name: 'kind', type: 'text' })
  kind!: 'capacity' | 'budget';
  @PrimaryColumn({ name: 'scope', type: 'text' })
  scope!: 'global' | 'actor';
  @PrimaryColumn({ name: 'subject', type: 'text' })
  subject!: string;
  @PrimaryColumn({ name: 'metric', type: 'text' })
  metric!: string;
  @PrimaryColumn({ name: 'period', type: 'text' })
  period!: string;
  @PrimaryColumn({ name: 'period_start', type: 'timestamptz' })
  periodStart!: Date;
  @Column({ name: 'deployment_namespace', type: 'text' })
  deploymentNamespace!: string;
  @Column({ name: 'amount', type: 'bigint' })
  amount!: string;
}

@Entity({ name: 'ai_provider_attempts' })
export class AiAttemptEntity {
  @PrimaryColumn({ name: 'run_id', type: 'uuid' }) runId!: string;
  @PrimaryColumn({ name: 'ordinal', type: 'integer' }) ordinal!: number;
  @Column({ name: 'dispatch_token', type: 'uuid' }) dispatchToken!: string;
  @Column({ name: 'claimed_at', type: 'timestamptz' }) claimedAt!: Date;
  @Column({ name: 'input_capacity', type: 'bigint' }) inputCapacity!: string;
  @Column({ name: 'output_capacity', type: 'bigint' }) outputCapacity!: string;
}

export const AI_ENTITIES = [
  AiCacheEntity,
  AiAttemptEntity,
  AiRunEntity,
  AiReceiptEntity,
  AiReservationEntity,
  AiSettlementEntity,
  AiPayloadEntity,
  AiCounterEntity,
  AiBudgetPeriodEntity,
  AiAllocationEntity,
] as const;
