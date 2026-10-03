import { jest } from '@jest/globals';
import type { DataSource } from 'typeorm';
import { PostgresTransaction } from './postgres-transaction.js';
import { RuntimeAdmission } from '../lifecycle/runtime-admission.js';

describe('shared infrastructure transaction lifecycle (database-free)', () => {
  function harness(admission?: RuntimeAdmission) {
    const events: string[] = [];
    const runner = {
      isTransactionActive: false,
      connect: async () => {
        events.push('connect');
      },
      startTransaction: async () => {
        events.push('start');
        runner.isTransactionActive = true;
      },
      commitTransaction: jest.fn(async () => {
        events.push('commit');
        runner.isTransactionActive = false;
      }),
      rollbackTransaction: async () => {
        events.push('rollback');
        runner.isTransactionActive = false;
      },
      release: async () => {
        events.push('release');
      },
    };
    const transactions = new PostgresTransaction(
      {
        createQueryRunner: () => runner,
      } as unknown as DataSource,
      admission,
    );
    return { transactions, runner, events };
  }
  it('hands the same runner to feature work and returns only after commit and release', async () => {
    const { transactions, runner, events } = harness();
    expect(
      await transactions.run(async (scope) => {
        expect(scope).toBe(runner);
        expect(scope.isTransactionActive).toBe(true);
        events.push('work');
        return 'result';
      }),
    ).toBe('result');
    expect(events).toEqual(['connect', 'start', 'work', 'commit', 'release']);
  });
  it.each(['work', 'commit'])('rolls back and releases after %s failure', async (stage) => {
    const { transactions, runner, events } = harness();
    const failure = new Error('transaction failed');
    if (stage === 'commit')
      runner.commitTransaction.mockImplementation(async () => {
        events.push('commit');
        throw failure;
      });
    await expect(
      transactions.run(async () => {
        if (stage === 'work') throw failure;
      }),
    ).rejects.toBe(failure);
    expect(events).toEqual(
      stage === 'work'
        ? ['connect', 'start', 'rollback', 'release']
        : ['connect', 'start', 'commit', 'rollback', 'release'],
    );
  });

  it('rolls back an admitted write when ownership is lost before commit', async () => {
    const admission = new RuntimeAdmission();
    admission.setOwnership(true);
    admission.setSchemaCompatible(true);
    const { transactions, runner, events } = harness(admission);
    await expect(transactions.run(async () => admission.setOwnership(false))).rejects.toThrow();
    expect(runner.commitTransaction).not.toHaveBeenCalled();
    expect(events).toEqual(['connect', 'start', 'rollback', 'release']);
    expect(admission.activeTransactions).toBe(0);
  });
  it('refuses new transactions before connecting after shutdown begins', async () => {
    const admission = new RuntimeAdmission();
    admission.setOwnership(true);
    admission.setSchemaCompatible(true);
    admission.stop();
    const { transactions, events } = harness(admission);
    await expect(transactions.run(async () => undefined)).rejects.toThrow();
    expect(events).toEqual([]);
  });
});
