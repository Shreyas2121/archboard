import type { DataSource, QueryRunner } from 'typeorm';

/** Shared infrastructure transaction lifecycle; feature adapters retain their lock ordering. */
export class PostgresTransaction {
  public constructor(private readonly dataSource: DataSource) {}

  public async run<T>(work: (runner: QueryRunner) => Promise<T>): Promise<T> {
    const runner = this.dataSource.createQueryRunner();
    try {
      await runner.connect();
      await runner.startTransaction();
      const result = await work(runner);
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
