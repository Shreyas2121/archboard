import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, jest } from '@jest/globals';
import { getMetadataArgsStorage, type DataSource } from 'typeorm';
import type { BoardPermissionService } from '../../../boards/application/index.js';
import { DATABASE_ENTITIES } from '../../../../platform/database/database-entities.js';
import { AiIntentService } from '../../application/intent-service.js';
import { AiPersistenceError } from '../../application/persistence.js';
import { PostgresAiPersistence } from './postgres-ai-persistence.js';
import { AesGcmAiPayloadCipher } from './payload-cipher.js';
import { AI_ENTITIES, AiReceiptEntity } from './entities.js';
import { fixtureAiIntent, TEST_KEY, TEST_KEY_VERSION } from '../testing/persistence-fixtures.js';
const FOUR = 4;
const THREE = 3;
function harness(failReceipt = false) {
  const query = jest.fn(async (sql: string) =>
    sql.includes('clock_timestamp')
      ? [{ now: new Date('2026-10-04T10:00:00Z') }]
      : sql.includes('FROM "user"')
        ? [{ id: 'fixture-actor' }]
        : [],
  );
  const builder = {
    select: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    setLock: jest.fn(),
    getOne: jest.fn(async () => null),
  };
  for (const name of ['select', 'where', 'andWhere', 'setLock'] as const)
    builder[name].mockReturnValue(builder);
  const manager = {
    findOneBy: jest.fn(async () => null),
    insert: jest.fn(async (entity: unknown) => {
      if (failReceipt && entity === AiReceiptEntity)
        throw new Error('private SQL/password/provider content');
    }),
    update: jest.fn(async () => undefined),
    getRepository: jest.fn(() => ({ createQueryBuilder: () => builder })),
  };
  const runner = {
    manager,
    query,
    isTransactionActive: true,
    connect: jest.fn(async () => undefined),
    startTransaction: jest.fn(async () => undefined),
    commitTransaction: jest.fn(async () => undefined),
    rollbackTransaction: jest.fn(async () => undefined),
    release: jest.fn(async () => undefined),
  };
  const source = {
    createQueryRunner: () => runner,
    getRepository: jest.fn(() => {
      throw new Error('global manager forbidden');
    }),
  };
  const authority = {
    editGraph: jest.fn<BoardPermissionService['editGraph']>(async () => ({
      allowed: false,
      code: 'FORBIDDEN',
    })),
  };
  const store = new PostgresAiPersistence(
    source as unknown as DataSource,
    authority as unknown as BoardPermissionService,
  );
  return { store, source, runner, manager, authority };
}
describe('Postgres AI adapter with database-free QueryRunner probes', () => {
  it('creates every related record through one shared transaction manager and parameterized locks', async () => {
    const { store, source, runner, manager } = harness();
    const service = new AiIntentService(
      store,
      new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION),
    );
    await service.create(fixtureAiIntent());
    expect(manager.insert).toHaveBeenCalledTimes(THREE);
    expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(1);
    expect(source.getRepository).not.toHaveBeenCalled();
    const locks = runner.query.mock.calls.filter(([sql]) => sql.includes('pg_advisory_xact_lock'));
    expect(locks).toHaveLength(FOUR + 1); // global, actor, fingerprint, receipt, run
    expect(runner.query.mock.calls.every(([sql]) => !sql.includes('fixture-actor'))).toBe(true);
  });
  it('rolls back and sanitizes driver failures before releasing the runner', async () => {
    const { store, runner } = harness(true);
    const service = new AiIntentService(
      store,
      new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION),
    );
    await expect(service.create(fixtureAiIntent())).rejects.toThrow(
      expect.objectContaining({
        code: 'TEMPORARILY_UNAVAILABLE',
        message: 'AI persistence operation failed.',
      }),
    );
    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(runner.commitTransaction).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalledTimes(1);
  });
  it('checks existing board authority with the same runner before any coordinator/receipt', async () => {
    const { store, runner, authority } = harness();
    const input = fixtureAiIntent({ boardId: '00000000-0000-4000-8000-000000000001' });
    const service = new AiIntentService(
      store,
      new AesGcmAiPayloadCipher(TEST_KEY, TEST_KEY_VERSION),
    );
    await expect(service.create(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(authority.editGraph).toHaveBeenCalledWith(runner, input.boardId!, input.actorUserId);
    expect(runner.query).not.toHaveBeenCalled();
  });
  it('retains safe domain errors and bounds payload cleanup before any query', async () => {
    const { store, runner } = harness();
    await expect(
      store.run(() => {
        throw new AiPersistenceError('AI_RESULT_EXPIRED');
      }),
    ).rejects.toMatchObject({ code: 'AI_RESULT_EXPIRED' });
    await expect(
      store.run((scope) => scope.deleteExpiredPayloads('namespace', Number.MAX_SAFE_INTEGER)),
    ).rejects.toMatchObject({ code: 'TEMPORARILY_UNAVAILABLE' });
    expect(runner.query).not.toHaveBeenCalled();
  });
  it('rolls an optional write back to its savepoint without aborting accounting', async () => {
    const { store, runner } = harness();
    await store.run(async (scope) => {
      expect(
        await scope.tryContent(async () => {
          throw new Error('private payload/provider detail');
        }),
      ).toBeNull();
      expect(await scope.tryContent(async () => true)).toBe(true);
    });
    expect(runner.query.mock.calls.map(([sql]) => sql)).toEqual([
      'SAVEPOINT ai_content_1',
      'ROLLBACK TO SAVEPOINT ai_content_1',
      'RELEASE SAVEPOINT ai_content_1',
      'SAVEPOINT ai_content_2',
      'RELEASE SAVEPOINT ai_content_2',
    ]);
    expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(runner.rollbackTransaction).not.toHaveBeenCalled();
  });
});
describe('checked-in AI entity and forward-schema source alignment (no migration execution)', () => {
  it('aligns ORM tables/column types with the checked-in forward migration sources and runtime registry', async () => {
    const source =
      (await readFile(
        new URL('../../../../migrations/1791072000000-AiPersistenceFoundation.ts', import.meta.url),
        'utf8',
      )) +
      (await readFile(
        new URL('../../../../migrations/1791072000001-AiAdmissionFoundation.ts', import.meta.url),
        'utf8',
      )) +
      (await readFile(
        new URL('../../../../migrations/1791072000002-AiResultCache.ts', import.meta.url),
        'utf8',
      ));
    const metadata = getMetadataArgsStorage();
    for (const entity of AI_ENTITIES) {
      expect(DATABASE_ENTITIES).toContain(entity);
      const table = metadata.tables.find((item) => item.target === entity)!;
      const body = new RegExp('CREATE TABLE ' + table.name + ' \\(([\\s\\S]*?)\\n\\);').exec(
        source,
      )?.[1];
      expect(body).toBeDefined();
      const sourceColumns = [
        ...body!.matchAll(/\b([a-z_]+)\s+(uuid|text|jsonb|bigint|integer|timestamptz|bytea)\b/g),
      ].map((match) => [match[1], match[2]]);
      const entityColumns = metadata.columns
        .filter((item) => item.target === entity)
        .map((item) => [item.options.name, item.options.type]);
      expect(sourceColumns.sort()).toEqual(entityColumns.sort());
    }
  });
});
