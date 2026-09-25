import { jest } from '@jest/globals';
import type { DataSource, QueryRunner } from 'typeorm';

import { CollaborationWriterLockService } from './collaboration-writer-lock.service.js';

class TestWriterLockService extends CollaborationWriterLockService {
  public terminations = 0;

  protected override terminateProcess(): void {
    this.terminations += 1;
  }
}
describe('collaboration writer lock readiness', () => {
  it('fails readiness immediately when the dedicated session reports connection loss', async () => {
    let connectionError: (() => void) | undefined;
    const queryRunner = {
      isReleased: false,
      databaseConnection: {
        once: (_event: 'error', listener: () => void) => {
          connectionError = listener;
        },
      },
      connect: jest.fn(async () => undefined),
      query: jest.fn(async (sql: string) =>
        sql.includes('pg_try_advisory_lock') ? [{ acquired: true }] : [{ value: 1 }],
      ),
      release: jest.fn(async () => undefined),
    } as unknown as QueryRunner;
    const dataSource = {
      isInitialized: false,
      initialize: jest.fn(async function (this: { isInitialized: boolean }) {
        this.isInitialized = true;
        return this;
      }),
      createQueryRunner: () => queryRunner,
      destroy: jest.fn(async function (this: { isInitialized: boolean }) {
        this.isInitialized = false;
      }),
    } as unknown as DataSource;
    const service = new TestWriterLockService(dataSource);

    await service.onModuleInit();
    expect(await service.isReady()).toBe(true);
    connectionError?.();
    expect(await service.isReady()).toBe(false);
    expect(service.terminations).toBe(1);
    await service.onApplicationShutdown();
  });
});
