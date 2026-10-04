import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AiResultCache1791072000002 implements MigrationInterface {
  public name = 'AiResultCache1791072000002';
  public async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
ALTER TABLE ai_private_payloads ADD CONSTRAINT "UQ_ai_payload_owner" UNIQUE(deployment_namespace,actor_user_id,id);
CREATE TABLE ai_result_cache (
 deployment_namespace text NOT NULL, actor_user_id text NOT NULL,
 fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
 run_id uuid NOT NULL, payload_id uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(deployment_namespace,actor_user_id,fingerprint),
 FOREIGN KEY(deployment_namespace,actor_user_id,run_id) REFERENCES ai_runs(deployment_namespace,actor_user_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(deployment_namespace,actor_user_id,payload_id) REFERENCES ai_private_payloads(deployment_namespace,actor_user_id,id) ON DELETE CASCADE,
 CHECK (expires_at > created_at AND expires_at <= created_at + interval '15 minutes')
);
CREATE INDEX "IDX_ai_result_cache_expiry" ON ai_result_cache(deployment_namespace,expires_at);
CREATE INDEX "IDX_ai_private_payloads_actor_expiry" ON ai_private_payloads(deployment_namespace,actor_user_id,expires_at,id);
CREATE FUNCTION ai_check_cache() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r ai_runs%ROWTYPE; p ai_private_payloads%ROWTYPE;
BEGIN
 SELECT * INTO r FROM ai_runs WHERE id = NEW.run_id;
 SELECT * INTO p FROM ai_private_payloads WHERE id = NEW.payload_id;
 IF r.id IS NULL OR p.id IS NULL OR r.phase <> 'completed' OR r.usage->>'status' IS DISTINCT FROM 'known' OR r.failure_code IS NOT NULL
 OR r.deployment_namespace <> NEW.deployment_namespace OR r.actor_user_id <> NEW.actor_user_id
 OR r.fingerprint <> NEW.fingerprint OR r.payload_id IS DISTINCT FROM NEW.payload_id
 OR r.payload_expires_at IS DISTINCT FROM NEW.expires_at OR p.expires_at <> NEW.expires_at
 OR p.origin_run_id <> r.id
 THEN RAISE EXCEPTION 'invalid AI result cache binding' USING ERRCODE = '23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ai_cache_binding AFTER INSERT OR UPDATE ON ai_result_cache DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ai_check_cache();
`);
  }
  public async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
DROP TABLE ai_result_cache;
DROP FUNCTION ai_check_cache();
DROP INDEX "IDX_ai_private_payloads_actor_expiry";
ALTER TABLE ai_private_payloads DROP CONSTRAINT "UQ_ai_payload_owner";
`);
  }
}
