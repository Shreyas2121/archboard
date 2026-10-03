import type { DataSource, QueryRunner } from 'typeorm';
import type { RuntimeAdmission } from '../lifecycle/runtime-admission.js';

/** Shared infrastructure transaction lifecycle; feature adapters retain their lock ordering. */
export class PostgresTransaction {
  public constructor(
    private readonly dataSource: DataSource,
    private readonly admission?: RuntimeAdmission,
  ) {}

  public async run<T>(work: (runner: QueryRunner) => Promise<T>): Promise<T> {
    const finish = this.admission?.beginTransaction();
    let runner: QueryRunner | undefined;
    try {
      runner = this.dataSource.createQueryRunner();
      return await this.runTransaction(runner, work);
    } finally {
      finish?.();
    }
  }

  private async runTransaction<T>(
    runner: QueryRunner,
    work: (runner: QueryRunner) => Promise<T>,
  ): Promise<T> {
    try {
      await runner.connect();
      await runner.startTransaction();
      const result = await work(runner);
      this.admission?.assertCanCommit();
      await runner.commitTransaction();
      return result;
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }
}
