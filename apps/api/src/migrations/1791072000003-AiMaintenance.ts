import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Supports bounded active-deadline discovery without scanning terminal history. */
export class AiMaintenance1791072000003 implements MigrationInterface {
  public name = 'AiMaintenance1791072000003';
  public async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE INDEX "IDX_ai_runs_active_deadline"
      ON ai_runs(deployment_namespace,deadline_at,id)
      WHERE phase IN ('pending-admission', 'admitted', 'dispatching')`);
  }
  public async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX "IDX_ai_runs_active_deadline"');
  }
}
