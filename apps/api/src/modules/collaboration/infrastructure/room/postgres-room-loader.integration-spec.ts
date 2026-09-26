import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import {
  COLOR_TOKENS,
  COMPONENT_CATEGORIES,
  ERROR_CODES,
  GRAPH_SCHEMA_VERSION,
  type GraphNode,
} from '@archboard/contracts';
import { createNode, projectGraphDocument } from '@archboard/document-model';
import { jest } from '@jest/globals';
import { DataSource } from 'typeorm';
import * as Y from 'yjs';

import { InitialDatabaseFoundation1789300000000 } from '../../../../migrations/1789300000000-InitialDatabaseFoundation.js';
import { loadApiConfig } from '../../../../platform/config/index.js';
import { DATABASE_ENTITIES } from '../../../../platform/database/database-entities.js';
import { BoardEntity } from '../../../boards/infrastructure/entities/board.entity.js';
import { createEmptyBoardSnapshot } from '../../../boards/infrastructure/empty-board-snapshot.js';
import { BoardSnapshotEntity } from '../entities/board-snapshot.entity.js';
import { BoardUpdateEntity } from '../entities/board-update.entity.js';
import { PostgresRoomLoader } from './postgres-room-loader.js';

const SCHEMA = `archboard_p402_${process.pid}`;
const OWNER = 'room-owner';
const TEST_TIMEOUT_MS = 30_000;
const NODE_WIDTH = 240;
const NODE_HEIGHT = 140;
const NEXT_SEQUENCE = '1';
const GAP_SEQUENCE = '2';

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
      migrations: [InitialDatabaseFoundation1789300000000],
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

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
      await admin.destroy();
    }
  });

  it('reconstructs the exact committed graph and decimal sequence across loader restart', async () => {
    const first = await new PostgresRoomLoader(dataSource).load(boardId);
    const restarted = await new PostgresRoomLoader(dataSource).load(boardId);
    expect(first.latestSeq).toBe(NEXT_SEQUENCE);
    expect(restarted.latestSeq).toBe(NEXT_SEQUENCE);
    expect(projectGraphDocument(first.document)).toEqual(projectGraphDocument(expected));
    expect(Y.encodeStateAsUpdate(restarted.document)).toEqual(
      Y.encodeStateAsUpdate(first.document),
    );
  });

  it('loads committed content for an archived board that remains readable to members', async () => {
    await dataSource.getRepository(BoardEntity).update({ id: boardId }, { archivedAt: new Date() });
    const room = await new PostgresRoomLoader(dataSource).load(boardId);
    expect(room.latestSeq).toBe(NEXT_SEQUENCE);
    expect(projectGraphDocument(room.document)).toEqual(projectGraphDocument(expected));
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
});
