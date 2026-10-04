import type { MigrationInterface, QueryRunner } from 'typeorm';
export class AiAdmissionFoundation1791072000001 implements MigrationInterface {
  public readonly name = 'AiAdmissionFoundation1791072000001';
  public async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
 -- C05's auto-named period constraints are replaced by forward constraints.
 DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT conname FROM pg_constraint WHERE conrelid='ai_capacity_scopes'::regclass AND contype='c'
 AND (conname='ai_capacity_scopes_period_check' OR pg_get_constraintdef(oid) LIKE '%period_start%')
 LOOP EXECUTE format('ALTER TABLE ai_capacity_scopes DROP CONSTRAINT %I',item.conname); END LOOP;
 END $$;
 ALTER TABLE ai_capacity_scopes ADD CONSTRAINT ai_capacity_period CHECK (period IN ('second','minute','day','active'));
 ALTER TABLE ai_capacity_scopes ADD CONSTRAINT ai_capacity_utc CHECK (
 (period='second' AND period_start=date_trunc('second',period_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') OR
 (period='minute' AND period_start=date_trunc('minute',period_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') OR
 (period='day' AND period_start=date_trunc('day',period_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') OR
 (period='active' AND period_start='1970-01-01T00:00:00Z'::timestamptz));
 CREATE TABLE ai_provider_attempts (
 run_id uuid NOT NULL REFERENCES ai_reservations(run_id) ON DELETE RESTRICT,
 ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 3), dispatch_token uuid NOT NULL,
 claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 input_capacity bigint NOT NULL CHECK (input_capacity>0), output_capacity bigint NOT NULL CHECK (output_capacity>0),
 PRIMARY KEY(run_id,ordinal)
);
 CREATE TRIGGER ai_attempt_immutable BEFORE UPDATE OR DELETE ON ai_provider_attempts FOR EACH ROW EXECUTE FUNCTION ai_reject_mutation();
 CREATE FUNCTION ai_guard_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE r ai_runs%ROWTYPE; h ai_reservations%ROWTYPE; claims integer;
 BEGIN
 SELECT * INTO r FROM ai_runs WHERE id=NEW.run_id FOR UPDATE;
 SELECT * INTO h FROM ai_reservations WHERE run_id=NEW.run_id FOR UPDATE;
 SELECT count(*) INTO claims FROM ai_provider_attempts WHERE run_id=NEW.run_id;
 IF r.phase<>'dispatching' OR r.dispatch_token IS DISTINCT FROM NEW.dispatch_token OR h.status<>'reserved' OR h.funded_at IS NULL
 OR NEW.ordinal<>claims+1 OR NEW.ordinal>h.maximum_attempts OR NEW.claimed_at>=r.deadline_at OR clock_timestamp()>=r.deadline_at
 OR NEW.input_capacity*h.maximum_attempts<>h.input_capacity OR NEW.output_capacity*h.maximum_attempts<>h.output_capacity
 THEN RAISE EXCEPTION 'invalid AI provider attempt claim' USING ERRCODE='23514'; END IF;
 RETURN NEW;
 END $$;
 CREATE TRIGGER ai_attempt_fence BEFORE INSERT ON ai_provider_attempts FOR EACH ROW EXECUTE FUNCTION ai_guard_attempt();
 CREATE FUNCTION ai_require_funding() RETURNS trigger LANGUAGE plpgsql AS $$
 DECLARE run_key uuid; r ai_runs%ROWTYPE; h ai_reservations%ROWTYPE; allocation_count integer; expected_liability numeric; actual_liability bigint;
 BEGIN
 IF TG_TABLE_NAME='ai_runs' THEN run_key:=NEW.id; ELSE run_key:=NEW.run_id; END IF;
 SELECT * INTO r FROM ai_runs WHERE id=run_key;
 SELECT * INTO h FROM ai_reservations WHERE run_id=run_key;
 IF h.funded_at IS NOT NULL THEN
 SELECT count(DISTINCT ROW(a.kind,a.scope,a.subject,a.metric,a.period)) INTO allocation_count FROM ai_reservation_allocations a WHERE a.run_id=run_key AND
 a.deployment_namespace=r.deployment_namespace AND
 ((a.kind='budget' AND a.metric='micro-usd' AND a.amount=h.maximum_micro_usd AND
 ((a.scope='global' AND a.subject='' AND a.period IN ('day','month','lifetime')) OR (a.scope='actor' AND a.subject=r.actor_user_id AND a.period='lifetime')))
 OR (a.kind='capacity' AND a.scope='global' AND a.subject='' AND a.period IN ('minute','active') AND
 ((a.metric='provider-request' AND a.amount=h.maximum_attempts) OR (a.metric='provider-input' AND a.amount=h.input_capacity) OR (a.metric='provider-output' AND a.amount=h.output_capacity)))
 OR (a.kind='capacity' AND a.metric='concurrency' AND a.period='active' AND a.amount=1 AND
 ((a.scope='global' AND a.subject='') OR (a.scope='actor' AND a.subject=r.actor_user_id))));
 IF allocation_count<>12 THEN RAISE EXCEPTION 'unfunded AI admission' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(res.maximum_micro_usd),0) INTO expected_liability FROM ai_reservations res JOIN ai_runs owner ON owner.id=res.run_id
 WHERE owner.deployment_namespace=r.deployment_namespace AND res.status IN ('reserved','unknown');
 SELECT reserved_micro_usd INTO actual_liability FROM ai_budget_periods WHERE deployment_namespace=r.deployment_namespace AND scope='global' AND subject='' AND period='lifetime';
 IF actual_liability IS DISTINCT FROM expected_liability THEN RAISE EXCEPTION 'unbalanced AI deployment liability' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(res.maximum_micro_usd),0) INTO expected_liability FROM ai_reservations res JOIN ai_runs owner ON owner.id=res.run_id
 WHERE owner.deployment_namespace=r.deployment_namespace AND owner.actor_user_id=r.actor_user_id AND res.status IN ('reserved','unknown');
 SELECT reserved_micro_usd INTO actual_liability FROM ai_budget_periods WHERE deployment_namespace=r.deployment_namespace AND scope='actor' AND subject=r.actor_user_id AND period='lifetime';
 IF actual_liability IS DISTINCT FROM expected_liability THEN RAISE EXCEPTION 'unbalanced AI actor liability' USING ERRCODE='23514'; END IF;
 END IF;
 IF r.phase='dispatching' AND NOT EXISTS(SELECT 1 FROM ai_provider_attempts a WHERE a.run_id=run_key AND a.dispatch_token=r.dispatch_token)
 THEN RAISE EXCEPTION 'unclaimed AI dispatch intent' USING ERRCODE='23514'; END IF;
 RETURN NULL;
 END $$;
 CREATE CONSTRAINT TRIGGER ai_funding_run AFTER INSERT OR UPDATE ON ai_runs DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_require_funding();
 CREATE CONSTRAINT TRIGGER ai_funding_hold AFTER INSERT OR UPDATE ON ai_reservations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_require_funding();
 CREATE CONSTRAINT TRIGGER ai_funding_attempt AFTER INSERT ON ai_provider_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_require_funding();
 `);
  }
  public async down(): Promise<void> {
    // Financial/attempt history cannot safely be discarded by a down migration.
    throw new Error('AI admission accounting requires a reviewed forward migration.');
  }
}
