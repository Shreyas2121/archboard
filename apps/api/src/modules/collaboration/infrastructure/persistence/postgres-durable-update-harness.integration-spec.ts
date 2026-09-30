import 'reflect-metadata';

import { createHash, randomUUID } from 'node:crypto';

import {
  BOARD_ROLES,
  COLOR_TOKENS,
  COMPONENT_CATEGORIES,
  ERROR_CODES,
  GRAPH_SCHEMA_VERSION,
  type GraphNode,
} from '@archboard/contracts';
import { createGraphDocument, createNode, projectGraphDocument } from '@archboard/document-model';
import { jest } from '@jest/globals';
import { DataSource } from 'typeorm';
import * as Y from 'yjs';

import { InitialDatabaseFoundation1789300000000 } from '../../../../migrations/1789300000000-InitialDatabaseFoundation.js';
import { BoardPermissionService } from '../../../boards/application/index.js';
import { PostgresBoardAuthorityReader } from '../../../boards/infrastructure/postgres-board-authority-reader.js';
import { loadApiConfig } from '../../../../platform/config/index.js';
import { DATABASE_ENTITIES } from '../../../../platform/database/database-entities.js';
import {
  DURABLE_UPDATE_FAILPOINTS,
  DurableUpdateFailpointController,
  InjectedPostCommitCrashError,
  type UpdateSessionAuthenticator,
} from '../../application/index.js';
import { createCausalGapFixtures } from '../yjs-compatibility/causal-gap.fixtures.js';
import { PostgresDurableUpdateHarness } from './postgres-durable-update-harness.js';

const OWNER_USER_ID = 'durable-owner';
const EDITOR_USER_ID = 'durable-editor';
const VIEWER_USER_ID = 'durable-viewer';
const NONMEMBER_USER_ID = 'durable-nonmember';
const OWNER_SESSION = 'owner-session';
const EDITOR_SESSION = 'editor-session';
const VIEWER_SESSION = 'viewer-session';
const NONMEMBER_SESSION = 'nonmember-session';
const INVALID_SESSION = 'invalid-session';
const INITIAL_CONTENT_TIME = new Date('2000-01-01T00:00:00.000Z');
const DATABASE_INTEGRATION_TIMEOUT_MS = 30_000;
const DEFAULT_NODE_WIDTH = 240;
const DEFAULT_NODE_HEIGHT = 140;
const UNSUPPORTED_GRAPH_SCHEMA_VERSION = GRAPH_SCHEMA_VERSION + 1;
const TWO_ACCEPTED_UPDATES = 2;
const TEST_SCHEMA_PREFIX = 'archboard_c11_';
const TEST_BETTER_AUTH_SECRET = 'durable-update-integration-secret-32chars';
const UPDATE_HASH_ALGORITHM = 'sha256';

jest.setTimeout(DATABASE_INTEGRATION_TIMEOUT_MS);

class TestSessionAuthenticator implements UpdateSessionAuthenticator {
  public async authenticate(sessionToken: string) {
    const userId = new Map([
      [OWNER_SESSION, OWNER_USER_ID],
      [EDITOR_SESSION, EDITOR_USER_ID],
      [VIEWER_SESSION, VIEWER_USER_ID],
      [NONMEMBER_SESSION, NONMEMBER_USER_ID],
    ]).get(sessionToken);
    return Promise.resolve(userId === undefined ? null : { userId });
  }
}

function databaseConfig() {
  return loadApiConfig({
    NODE_ENV: 'test',
    PUBLIC_API_ORIGIN: 'http://localhost:3000',
    ALLOWED_WEB_ORIGINS: 'http://localhost:5173',
    PORT: '3000',
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_DIRECT_URL: process.env.DATABASE_DIRECT_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? TEST_BETTER_AUTH_SECRET,
  });
}

function integrationDataSource(schemaName: string): DataSource {
  const config = databaseConfig();
  return new DataSource({
    type: 'postgres',
    url: config.databaseDirectUrl,
    schema: schemaName,
    entities: [...DATABASE_ENTITIES],
    migrations: [InitialDatabaseFoundation1789300000000],
    synchronize: false,
    migrationsRun: false,
    extra: { options: `-c search_path=${schemaName}` },
  });
}

function administrativeDataSource(): DataSource {
  const config = databaseConfig();
  return new DataSource({
    type: 'postgres',
    url: config.databaseDirectUrl,
    entities: [],
    synchronize: false,
    migrationsRun: false,
  });
}

function node(title: string): GraphNode {
  return {
    id: randomUUID(),
    kind: 'component',
    position: { x: 0, y: 0 },
    size: { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT },
    title,
    color: COLOR_TOKENS.BLUE,
    content: {
      category: COMPONENT_CATEGORIES.SERVICE,
      description: '',
      technology: 'TypeScript',
      externalUrl: null,
    },
  };
}

function createUpdate(accepted: Y.Doc, graphNode: GraphNode): Uint8Array {
  const replica = new Y.Doc();
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(accepted));
  const acceptedState = Y.encodeStateVector(replica);
  createNode(replica, graphNode);
  return Y.encodeStateAsUpdate(replica, acceptedState);
}

function createInvalidSchemaUpdate(accepted: Y.Doc): Uint8Array {
  const replica = new Y.Doc();
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(accepted));
  const acceptedState = Y.encodeStateVector(replica);
  replica.getMap('meta').set('schemaVersion', UNSUPPORTED_GRAPH_SCHEMA_VERSION);
  return Y.encodeStateAsUpdate(replica, acceptedState);
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe('durable PostgreSQL update acceptance', () => {
  const schemaName = `${TEST_SCHEMA_PREFIX}${process.pid}`;
  let adminDataSource: DataSource;
  let dataSource: DataSource;
  let boardId: string;
  let accepted: Y.Doc;
  let failpoints: DurableUpdateFailpointController;
  let harness: PostgresDurableUpdateHarness;

  beforeAll(async () => {
    adminDataSource = administrativeDataSource();
    await adminDataSource.initialize();
    await adminDataSource.query(`CREATE SCHEMA "${schemaName}"`);
    dataSource = integrationDataSource(schemaName);
    await dataSource.initialize();
    await dataSource.runMigrations({ transaction: 'all' });
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE "update_receipts", "board_updates", "board_members", "boards", "user" CASCADE',
    );
    for (const [id, email] of [
      [OWNER_USER_ID, 'durable-owner@example.com'],
      [EDITOR_USER_ID, 'durable-editor@example.com'],
      [VIEWER_USER_ID, 'durable-viewer@example.com'],
      [NONMEMBER_USER_ID, 'durable-nonmember@example.com'],
    ]) {
      await dataSource.query(
        `INSERT INTO "user" ("id", "name", "email", "emailVerified", "updatedAt")
         VALUES ($1, $1, $2, false, CURRENT_TIMESTAMP)`,
        [id, email],
      );
    }
    boardId = randomUUID();
    await dataSource.query(
      `INSERT INTO "boards"
        ("id", "owner_user_id", "title", "content_updated_at", "created_at", "updated_at")
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [boardId, OWNER_USER_ID, 'Durable update test', INITIAL_CONTENT_TIME],
    );
    await dataSource.query(
      `INSERT INTO "board_members" ("board_id", "user_id", "role")
       VALUES ($1, $2, $3), ($1, $4, $5)`,
      [boardId, EDITOR_USER_ID, BOARD_ROLES.EDITOR, VIEWER_USER_ID, BOARD_ROLES.VIEWER],
    );
    accepted = createGraphDocument();
    failpoints = new DurableUpdateFailpointController();
    harness = new PostgresDurableUpdateHarness(
      boardId,
      accepted,
      dataSource,
      new TestSessionAuthenticator(),
      new BoardPermissionService(new PostgresBoardAuthorityReader(dataSource)),
      failpoints,
    );
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    if (adminDataSource?.isInitialized) {
      await adminDataSource.query(`DROP SCHEMA "${schemaName}" CASCADE`);
      await adminDataSource.destroy();
    }
  });

  afterEach(async () => {
    await harness?.close();
    accepted?.destroy();
  });

  it('serializes accepted updates and exposes ACK and broadcast eligibility after commit', async () => {
    const firstNode = node('First durable node');
    const secondNode = node('Second durable node');
    const firstBytes = createUpdate(accepted, firstNode);
    const secondBytes = createUpdate(accepted, secondNode);

    const results = await Promise.all([
      harness.accept({
        boardId,
        updateId: randomUUID(),
        sessionToken: OWNER_SESSION,
        updateBytes: firstBytes,
      }),
      harness.accept({
        boardId,
        updateId: randomUUID(),
        sessionToken: EDITOR_SESSION,
        updateBytes: secondBytes,
      }),
    ]);

    expect(results.map(({ receipt }) => receipt.sequence)).toEqual(['1', '2']);
    expect(results.every((result) => result.acknowledgementEligible)).toBe(true);
    expect(results.every((result) => result.broadcastEligible)).toBe(true);
    expect(
      projectGraphDocumentFromHarness(harness)
        .nodes.map(({ title }) => title)
        .sort(),
    ).toEqual([firstNode.title, secondNode.title].sort());

    const boards = (await dataSource.query(
      `SELECT "latest_seq"::text, "content_updated_at" FROM "boards" WHERE "id" = $1`,
      [boardId],
    )) as { latest_seq: string; content_updated_at: Date }[];
    const persisted = (await dataSource.query(
      `SELECT u."update_bytes", r."payload_hash"
       FROM "board_updates" u
       JOIN "update_receipts" r USING ("board_id", "update_id")
       WHERE u."board_id" = $1 ORDER BY u."seq"`,
      [boardId],
    )) as { update_bytes: Buffer; payload_hash: Buffer }[];
    expect(boards[0]!.latest_seq).toBe(String(TWO_ACCEPTED_UPDATES));
    expect(boards[0]!.content_updated_at.getTime()).toBeGreaterThan(INITIAL_CONTENT_TIME.getTime());
    expect(persisted.map(({ update_bytes: bytes }) => bytes)).toEqual([
      Buffer.from(firstBytes),
      Buffer.from(secondBytes),
    ]);
    expect(persisted.map(({ payload_hash: hash }) => hash)).toEqual([
      createHash(UPDATE_HASH_ALGORITHM).update(firstBytes).digest(),
      createHash(UPDATE_HASH_ALGORITHM).update(secondBytes).digest(),
    ]);
  });

  it('returns the original receipt after a crash between commit and ACK without a second update', async () => {
    const updateId = randomUUID();
    const updateBytes = createUpdate(accepted, node('Crash-window node'));
    failpoints.arm(DURABLE_UPDATE_FAILPOINTS.AFTER_COMMIT_BEFORE_ACK);

    await expect(
      harness.accept({ boardId, updateId, sessionToken: OWNER_SESSION, updateBytes }),
    ).rejects.toBeInstanceOf(InjectedPostCommitCrashError);

    const committedBeforeRetry = (await dataSource.query(
      `SELECT "actor_user_id", "payload_hash", "seq"::text, "created_at"
       FROM "update_receipts"
       WHERE "board_id" = $1 AND "update_id" = $2`,
      [boardId, updateId],
    )) as { actor_user_id: string; payload_hash: Buffer; seq: string; created_at: Date }[];
    expect(committedBeforeRetry).toHaveLength(1);

    const retry = await harness.accept({
      boardId,
      updateId,
      sessionToken: OWNER_SESSION,
      updateBytes,
    });
    expect(retry.receipt.sequence).toBe(committedBeforeRetry[0]!.seq);
    expect(retry.receipt.createdAt).toEqual(committedBeforeRetry[0]!.created_at);
    expect(retry.receipt.actorUserId).toBe(committedBeforeRetry[0]!.actor_user_id);
    expect(Buffer.from(retry.receipt.payloadHash)).toEqual(committedBeforeRetry[0]!.payload_hash);
    expect(retry.acknowledgementEligible).toBe(true);
    expect(retry.broadcastEligible).toBe(false);
    await expectPersistedCounts(dataSource, boardId, 1);
  });

  it('merges an offline edit with an independently committed remote edit after a full snapshot', async () => {
    const offlineNode = node('Offline owner edit');
    const remoteNode = node('Remote editor edit');
    const offlineId = randomUUID();
    const offlineBytes = createUpdate(accepted, offlineNode);
    const remoteBytes = createUpdate(accepted, remoteNode);

    const remote = await harness.accept({
      boardId,
      updateId: randomUUID(),
      sessionToken: EDITOR_SESSION,
      updateBytes: remoteBytes,
    });
    expect(remote.receipt.sequence).toBe('1');

    const reloadedOfflineDocument = createGraphDocument();
    Y.applyUpdate(reloadedOfflineDocument, offlineBytes);
    Y.applyUpdate(reloadedOfflineDocument, harness.acceptedStateAsUpdate());
    expect(
      projectGraphDocument(reloadedOfflineDocument)
        .nodes.map(({ title }) => title)
        .sort(),
    ).toEqual([offlineNode.title, remoteNode.title].sort());

    const reconciled = await harness.accept({
      boardId,
      updateId: offlineId,
      sessionToken: OWNER_SESSION,
      updateBytes: offlineBytes,
    });
    expect(reconciled.receipt.sequence).toBe('2');
    expect(reconciled.acknowledgementEligible).toBe(true);
    expect(
      projectGraphDocumentFromHarness(harness)
        .nodes.map(({ title }) => title)
        .sort(),
    ).toEqual([offlineNode.title, remoteNode.title].sort());

    const retry = await harness.accept({
      boardId,
      updateId: offlineId,
      sessionToken: OWNER_SESSION,
      updateBytes: offlineBytes,
    });
    expect(retry.receipt.sequence).toBe(reconciled.receipt.sequence);
    expect(retry.broadcastEligible).toBe(false);
    await expectPersistedCounts(dataSource, boardId, TWO_ACCEPTED_UPDATES);
  });

  it('rolls back a forced commit-boundary failure without eligibility or accepted-state mutation', async () => {
    const before = harness.acceptedStateAsUpdate();
    failpoints.arm(DURABLE_UPDATE_FAILPOINTS.DATABASE_COMMIT);

    await expectCode(
      harness.accept({
        boardId,
        updateId: randomUUID(),
        sessionToken: OWNER_SESSION,
        updateBytes: createUpdate(accepted, node('Must roll back')),
      }),
      ERROR_CODES.PERSISTENCE_FAILED,
    );

    expect(harness.acceptedStateAsUpdate()).toEqual(before);
    await expectPersistedCounts(dataSource, boardId, 0);
    const boards = (await dataSource.query(
      `SELECT "latest_seq"::text FROM "boards" WHERE "id" = $1`,
      [boardId],
    )) as { latest_seq: string }[];
    expect(boards[0]!.latest_seq).toBe('0');
  });

  it('rejects update ID reuse by a different authorized actor or payload hash', async () => {
    const updateId = randomUUID();
    const originalBytes = createUpdate(accepted, node('Original payload'));
    await harness.accept({
      boardId,
      updateId,
      sessionToken: OWNER_SESSION,
      updateBytes: originalBytes,
    });

    await expectCode(
      harness.accept({
        boardId,
        updateId,
        sessionToken: EDITOR_SESSION,
        updateBytes: originalBytes,
      }),
      ERROR_CODES.UPDATE_ID_REUSED,
    );
    await expectCode(
      harness.accept({
        boardId,
        updateId,
        sessionToken: OWNER_SESSION,
        updateBytes: createUpdate(accepted, node('Different payload')),
      }),
      ERROR_CODES.UPDATE_ID_REUSED,
    );
    await expectPersistedCounts(dataSource, boardId, 1);
  });

  it('authenticates and authorizes before revealing an existing receipt', async () => {
    const updateId = randomUUID();
    const updateBytes = createUpdate(accepted, node('Protected receipt'));
    await harness.accept({
      boardId,
      updateId,
      sessionToken: OWNER_SESSION,
      updateBytes,
    });

    await expectCode(
      harness.accept({ boardId, updateId, sessionToken: INVALID_SESSION, updateBytes }),
      ERROR_CODES.UNAUTHENTICATED,
    );
    await expectCode(
      harness.accept({ boardId, updateId, sessionToken: VIEWER_SESSION, updateBytes }),
      ERROR_CODES.FORBIDDEN,
    );
  });

  it('rejects viewer and nonmember graph updates without changing accepted or persisted state', async () => {
    const before = harness.acceptedStateAsUpdate();
    for (const [sessionToken, code] of [
      [VIEWER_SESSION, ERROR_CODES.FORBIDDEN],
      [NONMEMBER_SESSION, ERROR_CODES.NOT_FOUND],
    ] as const) {
      await expectCode(
        harness.accept({
          boardId,
          updateId: randomUUID(),
          sessionToken,
          updateBytes: createUpdate(accepted, node('Denied graph write')),
        }),
        code,
      );
      expect(harness.acceptedStateAsUpdate()).toEqual(before);
      await expectPersistedCounts(dataSource, boardId, 0);
    }
  });

  it('rechecks archive state while holding the board row lock', async () => {
    const before = harness.acceptedStateAsUpdate();
    failpoints.arm(DURABLE_UPDATE_FAILPOINTS.AFTER_VALIDATION_BEFORE_TRANSACTION, async () => {
      await dataSource.query(
        `UPDATE "boards" SET "archived_at" = CURRENT_TIMESTAMP WHERE "id" = $1`,
        [boardId],
      );
    });

    await expectCode(
      harness.accept({
        boardId,
        updateId: randomUUID(),
        sessionToken: OWNER_SESSION,
        updateBytes: createUpdate(accepted, node('Archived before lock')),
      }),
      ERROR_CODES.BOARD_ARCHIVED,
    );
    expect(harness.acceptedStateAsUpdate()).toEqual(before);
    await expectPersistedCounts(dataSource, boardId, 0);
  });

  it('rechecks editor authority while holding the board row lock', async () => {
    const before = harness.acceptedStateAsUpdate();
    failpoints.arm(DURABLE_UPDATE_FAILPOINTS.AFTER_VALIDATION_BEFORE_TRANSACTION, async () => {
      await dataSource.query(
        `DELETE FROM "board_members" WHERE "board_id" = $1 AND "user_id" = $2`,
        [boardId, EDITOR_USER_ID],
      );
    });

    await expectCode(
      harness.accept({
        boardId,
        updateId: randomUUID(),
        sessionToken: EDITOR_SESSION,
        updateBytes: createUpdate(accepted, node('Revoked before lock')),
      }),
      ERROR_CODES.NOT_FOUND,
    );
    expect(harness.acceptedStateAsUpdate()).toEqual(before);
    await expectPersistedCounts(dataSource, boardId, 0);
  });

  it('rejects invalid and causally incomplete candidates without mutating accepted state', async () => {
    const before = harness.acceptedStateAsUpdate();
    await expectCode(
      harness.accept({
        boardId,
        updateId: randomUUID(),
        sessionToken: OWNER_SESSION,
        updateBytes: createInvalidSchemaUpdate(accepted),
      }),
      ERROR_CODES.DOCUMENT_INVALID,
    );
    await expectCode(
      harness.accept({
        boardId,
        updateId: randomUUID(),
        sessionToken: OWNER_SESSION,
        updateBytes: createCausalGapFixtures()[0]!.dependentUpdate,
      }),
      ERROR_CODES.CAUSAL_GAP,
    );
    expect(harness.acceptedStateAsUpdate()).toEqual(before);
    await expectPersistedCounts(dataSource, boardId, 0);
  });
});

function projectGraphDocumentFromHarness(harness: PostgresDurableUpdateHarness) {
  const document = createGraphDocument();
  Y.applyUpdate(document, harness.acceptedStateAsUpdate());
  return projectGraphDocument(document);
}

async function expectPersistedCounts(
  dataSource: DataSource,
  boardId: string,
  expected: number,
): Promise<void> {
  const rows = (await dataSource.query(
    `SELECT
       (SELECT count(*)::integer FROM "board_updates" WHERE "board_id" = $1) AS "updates",
       (SELECT count(*)::integer FROM "update_receipts" WHERE "board_id" = $1) AS "receipts",
       (SELECT latest_seq::text FROM "boards" WHERE "id" = $1) AS "sequence"`,
    [boardId],
  )) as { updates: number; receipts: number; sequence: string }[];
  expect(rows[0]).toEqual({ updates: expected, receipts: expected, sequence: String(expected) });
}
