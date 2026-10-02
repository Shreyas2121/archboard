import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import {
  COLOR_TOKENS,
  COMPONENT_CATEGORIES,
  ERROR_CODES,
  GRAPH_SCHEMA_VERSION,
  MAX_CLIENT_UPDATE_BYTES,
  type GraphNode,
} from '@archboard/contracts';
import { createNode, projectGraphDocument } from '@archboard/document-model';
import { jest } from '@jest/globals';
import { DataSource } from 'typeorm';
import * as Y from 'yjs';

import { InitialDatabaseFoundation1789300000000 } from '../../../../migrations/1789300000000-InitialDatabaseFoundation.js';
import { RetainCompactedUpdateReceipts1790426800000 } from '../../../../migrations/1790426800000-RetainCompactedUpdateReceipts.js';
import { loadApiConfig } from '../../../../platform/config/index.js';
import { DATABASE_ENTITIES } from '../../../../platform/database/database-entities.js';
import { BoardEntity } from '../../../boards/infrastructure/entities/board.entity.js';
import { CheckpointEntity } from '../../../boards/infrastructure/entities/checkpoint.entity.js';
import { createEmptyBoardSnapshot } from '../../../boards/infrastructure/empty-board-snapshot.js';
import { BoardSnapshotEntity } from '../entities/board-snapshot.entity.js';
import { BoardUpdateEntity } from '../entities/board-update.entity.js';
import { UpdateReceiptEntity } from '../entities/update-receipt.entity.js';
import {
  COMPACTION_FAILPOINTS,
  CompactionFailpointController,
  PostgresRoomCompactor,
} from './postgres-room-compactor.js';
import { PostgresRoomLoader } from './postgres-room-loader.js';
import { PostgresBoardSequenceAccess } from '../../../boards/infrastructure/postgres-board-sequence-access.js';
import { PostgresCommittedGraphReader } from './postgres-committed-graph-reader.js';
import { ValidationWorkerPool } from '../validation-worker/index.js';
import { PostgresBoardPersistence } from '../../../boards/infrastructure/postgres-board-persistence.js';
import { createCausalGapFixtures } from '../yjs-compatibility/causal-gap.fixtures.js';

const SCHEMA = `archboard_p402_${process.pid}`;
const OWNER = 'room-owner';
const TEST_TIMEOUT_MS = 30_000;
const NODE_WIDTH = 240;
const NODE_HEIGHT = 140;
const NEXT_SEQUENCE = '1';
const GAP_SEQUENCE = '2';
const SHA256_BYTES = 32;
const RETAINED_RECEIPT_COUNT = 1_000;

jest.setTimeout(TEST_TIMEOUT_MS);

function config() {
  return loadApiConfig({
    NODE_ENV: 'test',
    PUBLIC_API_ORIGIN: 'http://localhost:3000',
    ALLOWED_WEB_ORIGINS: 'http://localhost:5173',
    PORT: '3000',
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_DIRECT_URL: process.env.DATABASE_DIRECT_URL,
    BETTER_AUTH_SECRET: 'room-loader-integration-secret-32chars',
  });
}

function testNode(): GraphNode {
  return {
    id: randomUUID(),
    kind: 'component',
    title: 'Committed room node',
    color: COLOR_TOKENS.BLUE,
    position: { x: 10, y: 20 },
    size: { width: NODE_WIDTH, height: NODE_HEIGHT },
    content: {
      category: COMPONENT_CATEGORIES.SERVICE,
      description: '',
      technology: '',
      externalUrl: null,
    },
  };
}

describe('real PostgreSQL collaboration room reconstruction', () => {
  let admin: DataSource;
  let dataSource: DataSource;
  let boardId: string;
  let expected: Y.Doc;
  const workers = new ValidationWorkerPool();

  beforeAll(async () => {
    const settings = config();
    admin = new DataSource({
      type: 'postgres',
      url: settings.databaseDirectUrl,
      entities: [],
      synchronize: false,
    });
    await admin.initialize();
    await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
    dataSource = new DataSource({
      type: 'postgres',
      url: settings.databaseDirectUrl,
      schema: SCHEMA,
      entities: [...DATABASE_ENTITIES],
      migrations: [
        InitialDatabaseFoundation1789300000000,
        RetainCompactedUpdateReceipts1790426800000,
      ],
      synchronize: false,
      migrationsRun: false,
      extra: { options: `-c search_path=${SCHEMA}` },
    });
    await dataSource.initialize();
    await dataSource.runMigrations({ transaction: 'all' });
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE "board_updates", "boards", "user" CASCADE');
    await dataSource.query(
      'INSERT INTO "user" ("id", "name", "email", "emailVerified", "updatedAt") VALUES ($1, $2, $3, false, CURRENT_TIMESTAMP)',
      [OWNER, 'Room Owner', 'room-owner@example.com'],
    );
    boardId = randomUUID();
    const now = new Date();
    await dataSource.getRepository(BoardEntity).save({
      id: boardId,
      ownerUserId: OWNER,
      title: 'Room',
      description: '',
      archivedAt: null,
      metadataVersion: 1,
      latestSeq: NEXT_SEQUENCE,
      contentUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const snapshot = createEmptyBoardSnapshot();
    await dataSource.getRepository(BoardSnapshotEntity).save({
      boardId,
      ...snapshot,
      updatedAt: now,
    });
    expected = new Y.Doc();
    Y.applyUpdate(expected, snapshot.updateBytes);
    const before = Y.encodeStateVector(expected);
    createNode(expected, testNode());
    const updateBytes = Buffer.from(Y.encodeStateAsUpdate(expected, before));
    await dataSource.getRepository(BoardUpdateEntity).save({
      boardId,
      sequence: NEXT_SEQUENCE,
      updateId: randomUUID(),
      actorUserId: OWNER,
      updateBytes,
      createdAt: now,
    });
  });

  it('destroys the reconstructed live document if the read transaction cannot commit', async () => {
    const original = dataSource.driver.createQueryRunner.bind(dataSource.driver);
    const runners = jest.spyOn(dataSource.driver, 'createQueryRunner');
    const destroy = jest.spyOn(Y.Doc.prototype, 'destroy');
    runners.mockImplementation((mode) => {
      const runner = original(mode);
      jest
        .spyOn(runner, 'commitTransaction')
        .mockRejectedValue(new Error('Injected read commit failure'));
      return runner;
    });
    try {
      await expect(new PostgresRoomLoader(dataSource).load(boardId)).rejects.toMatchObject({
        code: ERROR_CODES.SERVER_BUSY,
      });
      // Worker documents live in a separate isolate; only the untransferred live document is observed here.
      expect(destroy).toHaveBeenCalledTimes(1);
      expect(await dataSource.getRepository(BoardUpdateEntity).countBy({ boardId })).toBe(1);
    } finally {
      runners.mockRestore();
      destroy.mockRestore();
    }
  });

  afterAll(async () => {
    await workers.close();
    if (dataSource?.isInitialized) await dataSource.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.destroy();
    }
  });

  afterEach(() => {
    expected?.destroy();
  });

  it.each(['sequence gap', 'malformed bytes', 'causal gap', 'oversized update'] as const)(
    'both reconstruction paths reject %s',
    async (failure) => {
      const repository = dataSource.getRepository(BoardUpdateEntity);
      if (failure === 'sequence gap') await repository.delete({ boardId });
      else
        await repository.update(
          { boardId },
          {
            updateBytes:
              failure === 'malformed bytes'
                ? Buffer.from([0])
                : failure === 'causal gap'
                  ? Buffer.from(createCausalGapFixtures()[0]!.dependentUpdate)
                  : Buffer.alloc(MAX_CLIENT_UPDATE_BYTES + 1),
          },
        );
      await expect(new PostgresRoomLoader(dataSource).load(boardId)).rejects.toMatchObject({
        code: ERROR_CODES.DOCUMENT_INVALID,
      });
      await expect(
        new PostgresBoardPersistence(dataSource, new PostgresCommittedGraphReader(workers)).run(
          (scope) => scope.loadCommittedGraph(boardId, NEXT_SEQUENCE),
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.DOCUMENT_INVALID });
    },
  );

  it('reconstructs the exact committed graph and decimal sequence across loader restart', async () => {
    const first = await new PostgresRoomLoader(dataSource).load(boardId);
    const restarted = await new PostgresRoomLoader(dataSource).load(boardId);
    expect(first.latestSeq).toBe(NEXT_SEQUENCE);
    expect(restarted.latestSeq).toBe(NEXT_SEQUENCE);
    expect(projectGraphDocument(first.document)).toEqual(projectGraphDocument(expected));
    expect(Y.encodeStateAsUpdate(restarted.document)).toEqual(
      Y.encodeStateAsUpdate(first.document),
    );
    first.document.destroy();
    restarted.document.destroy();
  });

  it('loads committed content for an archived board that remains readable to members', async () => {
    await dataSource.getRepository(BoardEntity).update({ id: boardId }, { archivedAt: new Date() });
    const room = await new PostgresRoomLoader(dataSource).load(boardId);
    expect(room.latestSeq).toBe(NEXT_SEQUENCE);
    expect(projectGraphDocument(room.document)).toEqual(projectGraphDocument(expected));
    room.document.destroy();
  });

  it('blocks a missing update or malformed snapshot without serving partial state', async () => {
    await dataSource.getRepository(BoardUpdateEntity).delete({ boardId, sequence: NEXT_SEQUENCE });
    await expect(new PostgresRoomLoader(dataSource).load(boardId)).rejects.toMatchObject({
      code: ERROR_CODES.DOCUMENT_INVALID,
    });

    await dataSource
      .getRepository(BoardSnapshotEntity)
      .update({ boardId }, { schemaVersion: GRAPH_SCHEMA_VERSION + 1 });
    await expect(new PostgresRoomLoader(dataSource).load(boardId)).rejects.toMatchObject({
      code: ERROR_CODES.DOCUMENT_INVALID,
    });
  });

  it('rejects an internal sequence gap and a structurally invalid graph', async () => {
    await dataSource
      .getRepository(BoardUpdateEntity)
      .update({ boardId, sequence: NEXT_SEQUENCE }, { sequence: GAP_SEQUENCE });
    await dataSource
      .getRepository(BoardEntity)
      .update({ id: boardId }, { latestSeq: GAP_SEQUENCE });
    await expect(new PostgresRoomLoader(dataSource).load(boardId)).rejects.toMatchObject({
      code: ERROR_CODES.DOCUMENT_INVALID,
    });

    await dataSource.getRepository(BoardUpdateEntity).delete({ boardId, sequence: GAP_SEQUENCE });
    await dataSource.getRepository(BoardEntity).update({ id: boardId }, { latestSeq: '0' });
    const invalid = new Y.Doc();
    const initial = createEmptyBoardSnapshot();
    Y.applyUpdate(invalid, initial.updateBytes);
    invalid.getMap('meta').set('schemaVersion', GRAPH_SCHEMA_VERSION + 1);
    const updateBytes = Buffer.from(Y.encodeStateAsUpdate(invalid));
    await dataSource.getRepository(BoardSnapshotEntity).update(
      { boardId },
      {
        updateBytes,
        byteLength: updateBytes.byteLength,
      },
    );
    await expect(new PostgresRoomLoader(dataSource).load(boardId)).rejects.toMatchObject({
      code: ERROR_CODES.DOCUMENT_INVALID,
    });
  });

  it('rejects invalid snapshot bytes and an update beyond latest sequence', async () => {
    await dataSource.getRepository(BoardSnapshotEntity).update(
      { boardId },
      {
        updateBytes: Buffer.from('00', 'hex'),
        byteLength: 1,
      },
    );
    await expect(new PostgresRoomLoader(dataSource).load(boardId)).rejects.toMatchObject({
      code: ERROR_CODES.DOCUMENT_INVALID,
    });
    const snapshot = createEmptyBoardSnapshot();
    await dataSource.getRepository(BoardSnapshotEntity).update(
      { boardId },
      {
        updateBytes: snapshot.updateBytes,
        byteLength: snapshot.byteLength,
      },
    );
    await dataSource.getRepository(BoardEntity).update({ id: boardId }, { latestSeq: '0' });
    await expect(new PostgresRoomLoader(dataSource).load(boardId)).rejects.toMatchObject({
      code: ERROR_CODES.DOCUMENT_INVALID,
    });
  });

  it('atomically advances the snapshot and deletes covered updates while retaining receipts and checkpoints', async () => {
    const update = await dataSource.getRepository(BoardUpdateEntity).findOneByOrFail({ boardId });
    await dataSource.getRepository(UpdateReceiptEntity).insert({
      boardId,
      updateId: update.updateId,
      actorUserId: OWNER,
      payloadHash: Buffer.alloc(SHA256_BYTES),
      sequence: NEXT_SEQUENCE,
    });
    await dataSource.getRepository(CheckpointEntity).insert({
      boardId,
      name: 'Before compaction',
      createdBy: OWNER,
      throughSeq: NEXT_SEQUENCE,
      schemaVersion: GRAPH_SCHEMA_VERSION,
      updateBytes: Buffer.from(Y.encodeStateAsUpdate(expected)),
    });
    const receiptsBefore = await dataSource
      .getRepository(UpdateReceiptEntity)
      .find({ where: { boardId }, order: { updateId: 'ASC' } });
    const before = await new PostgresRoomLoader(dataSource).load(boardId);
    const compactor = new PostgresRoomCompactor(
      dataSource,
      new CompactionFailpointController(),
      new PostgresBoardSequenceAccess(),
    );
    await compactor.compact(boardId, NEXT_SEQUENCE, Y.encodeStateAsUpdate(before.document));
    const snapshot = await dataSource
      .getRepository(BoardSnapshotEntity)
      .findOneByOrFail({ boardId });
    expect(snapshot.throughSeq).toBe(NEXT_SEQUENCE);
    expect(snapshot.byteLength).toBe(snapshot.updateBytes.byteLength);
    expect(await dataSource.getRepository(BoardUpdateEntity).countBy({ boardId })).toBe(0);
    expect(await dataSource.getRepository(UpdateReceiptEntity).countBy({ boardId })).toBe(1);
    expect(
      await dataSource
        .getRepository(UpdateReceiptEntity)
        .find({ where: { boardId }, order: { updateId: 'ASC' } }),
    ).toEqual(receiptsBefore);
    expect(await dataSource.getRepository(CheckpointEntity).countBy({ boardId })).toBe(1);
    const restarted = await new PostgresRoomLoader(dataSource).load(boardId);
    expect(restarted.compactedSeq).toBe(NEXT_SEQUENCE);
    expect(Y.encodeStateAsUpdate(restarted.document)).toEqual(
      Y.encodeStateAsUpdate(before.document),
    );
    before.document.destroy();
    restarted.document.destroy();
  });

  it.each([COMPACTION_FAILPOINTS.AFTER_SNAPSHOT_WRITE, COMPACTION_FAILPOINTS.AFTER_UPDATE_DELETE])(
    'reconstructs the old snapshot/log pair after rollback at %s',
    async (stage) => {
      const update = await dataSource.getRepository(BoardUpdateEntity).findOneByOrFail({ boardId });
      await dataSource.getRepository(UpdateReceiptEntity).insert({
        boardId,
        updateId: update.updateId,
        actorUserId: OWNER,
        payloadHash: Buffer.alloc(SHA256_BYTES),
        sequence: NEXT_SEQUENCE,
      });
      const receiptsBefore = await dataSource
        .getRepository(UpdateReceiptEntity)
        .findBy({ boardId });
      const failpoints = new CompactionFailpointController();
      failpoints.arm(stage, async () => {
        throw new Error('Injected compaction stop.');
      });
      const compactor = new PostgresRoomCompactor(
        dataSource,
        failpoints,
        new PostgresBoardSequenceAccess(),
      );
      await expect(
        compactor.compact(boardId, NEXT_SEQUENCE, Y.encodeStateAsUpdate(expected)),
      ).rejects.toThrow('Injected compaction stop.');
      const snapshot = await dataSource
        .getRepository(BoardSnapshotEntity)
        .findOneByOrFail({ boardId });
      expect(snapshot.throughSeq).toBe('0');
      expect(await dataSource.getRepository(BoardUpdateEntity).countBy({ boardId })).toBe(1);
      expect(await dataSource.getRepository(UpdateReceiptEntity).findBy({ boardId })).toEqual(
        receiptsBefore,
      );
      const restarted = await new PostgresRoomLoader(dataSource).load(boardId);
      expect(restarted.compactedSeq).toBe('0');
      expect(Y.encodeStateAsUpdate(restarted.document)).toEqual(Y.encodeStateAsUpdate(expected));
      restarted.document.destroy();
    },
  );

  it('reconstructs the new pair after a stop immediately after compaction commit', async () => {
    const failpoints = new CompactionFailpointController();
    failpoints.arm(COMPACTION_FAILPOINTS.AFTER_COMMIT, async () => {
      throw new Error('Injected post-commit stop.');
    });
    const compactor = new PostgresRoomCompactor(
      dataSource,
      failpoints,
      new PostgresBoardSequenceAccess(),
    );
    await expect(
      compactor.compact(boardId, NEXT_SEQUENCE, Y.encodeStateAsUpdate(expected)),
    ).rejects.toThrow('Injected post-commit stop.');
    const snapshot = await dataSource
      .getRepository(BoardSnapshotEntity)
      .findOneByOrFail({ boardId });
    expect(snapshot.throughSeq).toBe(NEXT_SEQUENCE);
    expect(await dataSource.getRepository(BoardUpdateEntity).countBy({ boardId })).toBe(0);
    const restarted = await new PostgresRoomLoader(dataSource).load(boardId);
    expect(Y.encodeStateAsUpdate(restarted.document)).toEqual(Y.encodeStateAsUpdate(expected));
    restarted.document.destroy();
  });

  it('preserves exact receipt fields across compaction with a large retained history and no receipt queries', async () => {
    const repository = dataSource.getRepository(UpdateReceiptEntity);
    await repository.insert(
      Array.from({ length: RETAINED_RECEIPT_COUNT }, () => ({
        boardId,
        updateId: randomUUID(),
        actorUserId: OWNER,
        payloadHash: Buffer.alloc(SHA256_BYTES),
        sequence: NEXT_SEQUENCE,
      })),
    );
    const before = await repository.find({ where: { boardId }, order: { updateId: 'ASC' } });
    const observed: string[] = [];
    const original = dataSource.driver.createQueryRunner.bind(dataSource.driver);
    const query = jest.spyOn(dataSource.driver, 'createQueryRunner');
    query.mockImplementation((mode) => {
      const runner = original(mode);
      const execute = runner.query.bind(runner);
      jest
        .spyOn(runner, 'query')
        .mockImplementation(
          (sql: string, parameters?: Parameters<typeof runner.query>[1], structured?: boolean) => {
            observed.push(sql);
            return structured ? execute(sql, parameters, true) : execute(sql, parameters);
          },
        );
      return runner;
    });
    try {
      await new PostgresRoomCompactor(
        dataSource,
        new CompactionFailpointController(),
        new PostgresBoardSequenceAccess(),
      ).compact(boardId, NEXT_SEQUENCE, Y.encodeStateAsUpdate(expected));
    } finally {
      query.mockRestore();
    }
    expect(observed.some((sql) => sql.includes('update_receipts'))).toBe(false);
    expect(await repository.find({ where: { boardId }, order: { updateId: 'ASC' } })).toEqual(
      before,
    );
  });
});
