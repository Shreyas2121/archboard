import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Source-only until the user resumes final database verification. */
export class AiPersistenceFoundation1791072000000 implements MigrationInterface {
  public readonly name = 'AiPersistenceFoundation1791072000000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
CREATE TABLE ai_runs (
 id uuid PRIMARY KEY, deployment_namespace text NOT NULL, actor_user_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
 board_id uuid REFERENCES boards(id) ON DELETE RESTRICT,
 request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'), fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
 task text NOT NULL CHECK (task IN ('diagram-described','propose-design','explain-selection','trace-flow','scoped-edit','presentation')),
 snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object')
 CHECK (snapshot ?& ARRAY['provider','model','configurationVersion','configurationFingerprint','pricingVersion','tokenCountingVersion','versions','contextWindowTokens','maximumInputTokens','maximumOutputTokens','prices','deadlineMs','receiptTtlMs','resultTtlMs'])
 CHECK ((snapshot - ARRAY['provider','model','configurationVersion','configurationFingerprint','pricingVersion','tokenCountingVersion','versions','contextWindowTokens','maximumInputTokens','maximumOutputTokens','prices','deadlineMs','receiptTtlMs','resultTtlMs']) = '{}'::jsonb)
 CHECK (snapshot->>'provider' = 'openai' AND jsonb_typeof(snapshot->'prices') = 'object' AND jsonb_typeof(snapshot->'versions') = 'object'),
 phase text NOT NULL CHECK (phase IN ('pending-admission','admitted','dispatching','completed','refused','incomplete','failed','cancelled','outcome-unknown')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), deadline_at timestamptz NOT NULL,
 dispatch_token uuid, lease_expires_at timestamptz, payload_id uuid, payload_expires_at timestamptz,
 usage jsonb NOT NULL DEFAULT '{"status":"unknown"}', failure_code text,
 CONSTRAINT "UQ_ai_runs_owner" UNIQUE(deployment_namespace,actor_user_id,id),
 CHECK (deadline_at > created_at AND deadline_at <= created_at + interval '120 seconds'),
 CHECK (updated_at >= created_at), CHECK ((dispatch_token IS NULL) = (lease_expires_at IS NULL)),
 CHECK (lease_expires_at IS NULL OR lease_expires_at <= deadline_at),
 CHECK (phase <> 'dispatching' OR dispatch_token IS NOT NULL),
 CHECK ((payload_id IS NULL) = (payload_expires_at IS NULL)),
 CHECK (payload_id IS NULL OR phase = 'completed')
);
CREATE UNIQUE INDEX "UQ_ai_runs_active" ON ai_runs(deployment_namespace,actor_user_id,fingerprint)
 WHERE phase IN ('pending-admission','admitted','dispatching');
CREATE INDEX "IDX_ai_runs_recovery" ON ai_runs(deployment_namespace,lease_expires_at) WHERE phase = 'dispatching';
CREATE TABLE ai_creation_receipts (
 deployment_namespace text NOT NULL, actor_user_id text NOT NULL, key uuid NOT NULL, request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
 run_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 PRIMARY KEY(deployment_namespace,actor_user_id,key),
 FOREIGN KEY(deployment_namespace,actor_user_id,run_id) REFERENCES ai_runs(deployment_namespace,actor_user_id,id) ON DELETE RESTRICT,
 CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours')
);
CREATE TABLE ai_reservations (
 run_id uuid PRIMARY KEY REFERENCES ai_runs(id) ON DELETE RESTRICT,
 maximum_micro_usd bigint NOT NULL CHECK (maximum_micro_usd > 0),
 input_capacity bigint NOT NULL CHECK (input_capacity > 0), output_capacity bigint NOT NULL CHECK (output_capacity > 0),
 maximum_attempts integer NOT NULL CHECK (maximum_attempts BETWEEN 1 AND 3),
 status text NOT NULL CHECK (status IN ('pending','reserved','settled','unknown')), funded_at timestamptz,
 CHECK (status <> 'pending' OR funded_at IS NULL),
 CHECK (status NOT IN ('reserved','unknown') OR funded_at IS NOT NULL)
);
CREATE TABLE ai_settlements (
 run_id uuid PRIMARY KEY REFERENCES ai_reservations(run_id) ON DELETE RESTRICT, dispatch_token uuid,
 mode text NOT NULL CHECK (mode IN ('known','unknown','unsent')),
 phase text NOT NULL CHECK (phase IN ('completed','refused','incomplete','failed','cancelled','outcome-unknown')),
 actual_micro_usd bigint CHECK (actual_micro_usd >= 0), usage jsonb NOT NULL, failure_code text,
 CHECK ((mode = 'unknown') = (actual_micro_usd IS NULL)), CHECK (mode <> 'unsent' OR actual_micro_usd = 0),
 CHECK (mode <> 'known' OR usage->>'status' = 'known'),
 CHECK (mode = 'unsent' OR dispatch_token IS NOT NULL), CHECK (mode <> 'unsent' OR phase <> 'completed'),
 CHECK (phase <> 'outcome-unknown' OR mode = 'unknown')
);
CREATE TABLE ai_private_payloads (
 id uuid PRIMARY KEY, deployment_namespace text NOT NULL, actor_user_id text NOT NULL, origin_run_id uuid NOT NULL,
 schema_version integer NOT NULL CHECK (schema_version = 1), key_version text NOT NULL, expires_at timestamptz NOT NULL,
 nonce bytea NOT NULL CHECK (octet_length(nonce) = 12), tag bytea NOT NULL CHECK (octet_length(tag) = 16),
 ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 1 AND 524288),
 byte_length integer NOT NULL CHECK (byte_length = octet_length(ciphertext) + 28),
 FOREIGN KEY(deployment_namespace,actor_user_id,origin_run_id) REFERENCES ai_runs(deployment_namespace,actor_user_id,id) ON DELETE RESTRICT
);
CREATE INDEX "IDX_ai_private_payloads_expiry" ON ai_private_payloads(deployment_namespace,expires_at,id);
CREATE TABLE ai_capacity_scopes (
 deployment_namespace text NOT NULL, scope text NOT NULL CHECK (scope IN ('global','actor')), subject text NOT NULL,
 metric text NOT NULL CHECK (metric IN ('create','fresh','provider-request','provider-input','provider-output','concurrency','poll','sse')),
 period text NOT NULL CHECK (period IN ('minute','day','active')), period_start timestamptz NOT NULL,
 committed bigint NOT NULL DEFAULT 0 CHECK (committed >= 0), reserved bigint NOT NULL DEFAULT 0 CHECK (reserved >= 0),
 PRIMARY KEY(deployment_namespace,scope,subject,metric,period,period_start),
 CHECK ((scope = 'global' AND subject = '') OR (scope = 'actor' AND length(subject) BETWEEN 1 AND 256)),
 CHECK ((period = 'minute' AND period_start = date_trunc('minute',period_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
 OR (period = 'day' AND period_start = date_trunc('day',period_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
 OR (period = 'active' AND period_start = '1970-01-01T00:00:00Z'::timestamptz))
);
CREATE TABLE ai_budget_periods (
 deployment_namespace text NOT NULL, scope text NOT NULL CHECK (scope IN ('global','actor')), subject text NOT NULL,
 period text NOT NULL CHECK (period IN ('day','month','lifetime')), period_start timestamptz NOT NULL,
 committed_micro_usd bigint NOT NULL DEFAULT 0 CHECK (committed_micro_usd >= 0), reserved_micro_usd bigint NOT NULL DEFAULT 0 CHECK (reserved_micro_usd >= 0),
 PRIMARY KEY(deployment_namespace,scope,subject,period,period_start),
 CHECK ((scope = 'global' AND subject = '') OR (scope = 'actor' AND length(subject) BETWEEN 1 AND 256)),
 CHECK ((period = 'day' AND period_start = date_trunc('day',period_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
 OR (period = 'month' AND period_start = date_trunc('month',period_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
 OR (period = 'lifetime' AND period_start = '1970-01-01T00:00:00Z'::timestamptz))
);
CREATE TABLE ai_reservation_allocations (
 run_id uuid NOT NULL REFERENCES ai_reservations(run_id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK (kind IN ('capacity','budget')), scope text NOT NULL CHECK (scope IN ('global','actor')),
 subject text NOT NULL, metric text NOT NULL, period text NOT NULL, period_start timestamptz NOT NULL,
 deployment_namespace text NOT NULL, amount bigint NOT NULL CHECK (amount > 0),
 PRIMARY KEY(run_id,kind,scope,subject,metric,period,period_start),
 CHECK ((scope = 'global' AND subject = '') OR (scope = 'actor' AND length(subject) BETWEEN 1 AND 256)),
 CHECK ((kind = 'budget' AND metric = 'micro-usd' AND period IN ('day','month','lifetime')) OR
 (kind = 'capacity' AND metric IN ('create','fresh','provider-request','provider-input','provider-output','concurrency','poll','sse') AND period IN ('minute','day','active')))
);
-- Prevent immutable receipt/settlement updates and deletion of paid-work tombstones.
CREATE FUNCTION ai_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable AI accounting record' USING ERRCODE = '23514'; END $$;
CREATE TRIGGER ai_receipt_immutable BEFORE UPDATE OR DELETE ON ai_creation_receipts FOR EACH ROW EXECUTE FUNCTION ai_reject_mutation();
CREATE TRIGGER ai_settlement_immutable BEFORE UPDATE OR DELETE ON ai_settlements FOR EACH ROW EXECUTE FUNCTION ai_reject_mutation();
CREATE TRIGGER ai_payload_immutable BEFORE UPDATE ON ai_private_payloads FOR EACH ROW EXECUTE FUNCTION ai_reject_mutation();
CREATE TRIGGER ai_run_retention BEFORE DELETE ON ai_runs FOR EACH ROW EXECUTE FUNCTION ai_reject_mutation();
CREATE TRIGGER ai_reservation_retention BEFORE DELETE ON ai_reservations FOR EACH ROW EXECUTE FUNCTION ai_reject_mutation();
CREATE TRIGGER ai_allocation_immutable BEFORE UPDATE OR DELETE ON ai_reservation_allocations FOR EACH ROW EXECUTE FUNCTION ai_reject_mutation();
CREATE FUNCTION ai_guard_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD.phase = 'pending-admission' AND NEW.phase = 'dispatching') OR
 (OLD.phase = 'admitted' AND NEW.phase = 'pending-admission') OR
 (OLD.phase = 'dispatching' AND NEW.phase IN ('pending-admission','admitted'))
 THEN RAISE EXCEPTION 'invalid AI phase transition' USING ERRCODE = '23514'; END IF;
 IF ROW(NEW.id,NEW.deployment_namespace,NEW.actor_user_id,NEW.board_id,NEW.request_hash,NEW.fingerprint,NEW.task,NEW.snapshot,NEW.created_at,NEW.deadline_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.deployment_namespace,OLD.actor_user_id,OLD.board_id,OLD.request_hash,OLD.fingerprint,OLD.task,OLD.snapshot,OLD.created_at,OLD.deadline_at)
 THEN RAISE EXCEPTION 'immutable AI run identity' USING ERRCODE = '23514'; END IF;
 IF OLD.phase NOT IN ('pending-admission','admitted','dispatching') AND NEW IS DISTINCT FROM OLD
 THEN RAISE EXCEPTION 'terminal AI run' USING ERRCODE = '23514'; END IF;
 IF OLD.dispatch_token IS NOT NULL AND NEW.dispatch_token IS DISTINCT FROM OLD.dispatch_token
 THEN RAISE EXCEPTION 'immutable AI dispatch fence' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_run_identity BEFORE UPDATE ON ai_runs FOR EACH ROW EXECUTE FUNCTION ai_guard_run();
CREATE FUNCTION ai_guard_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD.status = 'reserved' AND NEW.status = 'pending') OR
 (OLD.status = 'pending' AND NEW.status = 'unknown')
 THEN RAISE EXCEPTION 'invalid AI reservation transition' USING ERRCODE = '23514'; END IF;
 IF ROW(NEW.run_id,NEW.maximum_micro_usd,NEW.input_capacity,NEW.output_capacity,NEW.maximum_attempts)
 IS DISTINCT FROM ROW(OLD.run_id,OLD.maximum_micro_usd,OLD.input_capacity,OLD.output_capacity,OLD.maximum_attempts)
 OR (OLD.funded_at IS NOT NULL AND NEW.funded_at IS DISTINCT FROM OLD.funded_at)
 OR (OLD.status IN ('settled','unknown') AND NEW IS DISTINCT FROM OLD)
 THEN RAISE EXCEPTION 'immutable AI reservation liability' USING ERRCODE = '23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_reservation_identity BEFORE UPDATE ON ai_reservations FOR EACH ROW EXECUTE FUNCTION ai_guard_reservation();
-- Deferred so a transaction can atomically create/fund/settle the related records.
CREATE FUNCTION ai_check_accounting() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run_key uuid; r ai_runs%ROWTYPE; hold ai_reservations%ROWTYPE; final ai_settlements%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME = 'ai_runs' THEN run_key := NEW.id; ELSE run_key := NEW.run_id; END IF;
 SELECT * INTO r FROM ai_runs WHERE id = run_key;
 SELECT * INTO hold FROM ai_reservations WHERE run_id = run_key;
 SELECT * INTO final FROM ai_settlements WHERE run_id = run_key;
 IF hold.run_id IS NULL OR
 (r.phase IN ('pending-admission','admitted','dispatching') AND final.run_id IS NOT NULL) OR
 (r.phase = 'pending-admission' AND hold.status <> 'pending') OR
 (r.phase IN ('admitted','dispatching') AND (hold.status <> 'reserved' OR hold.funded_at IS NULL)) OR
 (r.phase NOT IN ('pending-admission','admitted','dispatching') AND
   (final.run_id IS NULL OR final.phase <> r.phase OR final.dispatch_token IS DISTINCT FROM r.dispatch_token OR
    final.usage IS DISTINCT FROM r.usage OR final.failure_code IS DISTINCT FROM r.failure_code OR
    hold.status <> CASE WHEN final.mode = 'unknown' THEN 'unknown' ELSE 'settled' END))
 THEN RAISE EXCEPTION 'incoherent AI accounting intent' USING ERRCODE = '23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ai_run_accounting AFTER INSERT OR UPDATE ON ai_runs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_check_accounting();
CREATE CONSTRAINT TRIGGER ai_reservation_accounting AFTER INSERT OR UPDATE ON ai_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_check_accounting();
CREATE CONSTRAINT TRIGGER ai_settlement_accounting AFTER INSERT ON ai_settlements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_check_accounting();
`);
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
 DROP TABLE ai_reservation_allocations, ai_budget_periods, ai_capacity_scopes, ai_private_payloads, ai_settlements, ai_creation_receipts, ai_reservations, ai_runs;
 DROP FUNCTION ai_check_accounting(), ai_guard_reservation(), ai_guard_run(), ai_reject_mutation();
 `);
  }
}
