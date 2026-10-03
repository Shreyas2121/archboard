import { jest } from '@jest/globals';
import type { DataSource, QueryRunner } from 'typeorm';

import { CollaborationWriterLockService } from './collaboration-writer-lock.service.js';
import { RuntimeAdmission } from '../lifecycle/runtime-admission.js';

class TestWriterLockService extends CollaborationWriterLockService {
  public terminations = 0;

  protected override terminateProcess(): void {
    this.terminations += 1;
  }
}
describe('collaboration writer lock readiness', () => {
  it.each(['error', 'end'] as const)(
    'fences admission immediately on dedicated connection %s',
    async (event) => {
      const listeners = new Map<string, () => void>();
      const queryRunner = {
        isReleased: false,
        databaseConnection: {
          once: (kind: 'error' | 'end', listener: () => void) => {
            listeners.set(kind, listener);
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
      const admission = new RuntimeAdmission();
      const service = new TestWriterLockService(dataSource, admission);

      await service.onModuleInit();
      admission.setSchemaCompatible(true);
      expect(admission.accepting).toBe(true);
      expect(await service.isReady()).toBe(true);
      listeners.get(event)?.();
      expect(admission.accepting).toBe(false);
      expect(() => admission.assertCanCommit()).toThrow();
      expect(await service.isReady()).toBe(false);
      expect(service.terminations).toBe(1);
      await service.onApplicationShutdown();
    },
  );
});
