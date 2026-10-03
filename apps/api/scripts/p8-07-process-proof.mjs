// PREPARED ONLY: real PostgreSQL, HTTP, sockets and child-process termination.
// Execution remains deferred under docs/verification-policy.md.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { DataSource } from 'typeorm';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { createNode, projectGraphDocument } from '@archboard/document-model';
import {
  serverMessageSchema,
  PROTOCOL_VERSION,
  GRAPH_SCHEMA_VERSION,
  COLOR_TOKENS,
  COMPONENT_CATEGORIES,
} from '@archboard/contracts';
import { proofTarget } from '../../../scripts/ops/proof-target.mjs';
import { DATABASE_ENTITIES } from '../dist/platform/database/database-entities.js';
import { InitialDatabaseFoundation1789300000000 } from '../dist/migrations/1789300000000-InitialDatabaseFoundation.js';
import { RetainCompactedUpdateReceipts1790426800000 } from '../dist/migrations/1790426800000-RetainCompactedUpdateReceipts.js';
import { BoardEntity } from '../dist/modules/boards/infrastructure/entities/board.entity.js';
import { BoardSnapshotEntity } from '../dist/modules/collaboration/infrastructure/entities/board-snapshot.entity.js';
import { createEmptyBoardSnapshot } from '../dist/modules/boards/infrastructure/empty-board-snapshot.js';

const children = new Set();
const sockets = new Set();
const schema = `p8_ops_${process.pid}_${randomUUID().replaceAll('-', '')}`;
let admin,
  database,
  schemaCreated = false,
  stage = 'target';
const within = (work, ms = 12_000) => {
  let timer;
  return Promise.race([
    work,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Proof deadline exceeded.')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function start(environment, fault) {
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL(fault ? './p8-07-fault-child.mjs' : '../dist/main.js', import.meta.url),
      ),
    ],
    {
      env: { ...environment, ...(fault ? { P8_FAULT_POINT: fault } : {}) },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    },
  );
  children.add(child);
  // Drain but never persist child driver/auth output or fixture credentials.
  child.stdout.resume();
  child.stderr.resume();
  child.done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  void child.done.catch(() => undefined);
  return child;
}
async function ready(child, origin) {
  await within(
    (async () => {
      for (;;) {
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error('Child startup failed.');
        try {
          if ((await fetch(`${origin}/health/ready`, { signal: AbortSignal.timeout(1000) })).ok)
            break;
        } catch {
          /* Wait for startup. */
        }
        await delay(50);
      }
      assert.equal((await fetch(`${origin}/health/live`)).status, 200);
    })(),
  );
}
function held(child) {
  return within(
    new Promise((resolve) => {
      const listener = (message) => {
        if (message?.event === 'fault-held') {
          child.off('message', listener);
          resolve();
        }
      };
      child.on('message', listener);
    }),
  );
}
async function connect(origin, boardId, cookie) {
  const socket = new WebSocket(`${origin.replace('http:', 'ws:')}/ws/boards/${boardId}`, {
    origin,
    headers: { cookie },
  });
  sockets.add(socket);
  const messages = [];
  socket.on('message', (raw) =>
    messages.push(serverMessageSchema.parse(JSON.parse(raw.toString()))),
  );
  socket.on('error', () => undefined);
  await within(
    new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    }),
  );
  socket.send(
    JSON.stringify({
      event: 'hello',
      data: {
        protocolVersion: PROTOCOL_VERSION,
        schemaVersion: GRAPH_SCHEMA_VERSION,
        tabId: randomUUID(),
      },
    }),
  );
  const next = async (predicate) =>
    within(
      (async () => {
        for (;;) {
          const found = messages.find(predicate);
          if (found) return found;
          if (socket.readyState === WebSocket.CLOSED)
            throw new Error('Socket closed before expected event.');
          await delay(10);
        }
      })(),
    );
  const initial = await next((message) => message.event === 'ready');
  return { socket, messages, next, initial };
}
function update(snapshotBase64) {
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, Buffer.from(snapshotBase64, 'base64'));
    const before = Y.encodeStateVector(document),
      nodeId = randomUUID();
    createNode(document, {
      id: nodeId,
      kind: 'component',
      position: { x: 0, y: 0 },
      size: { width: 240, height: 140 },
      title: 'Process proof',
      color: COLOR_TOKENS.BLUE,
      content: {
        category: COMPONENT_CATEGORIES.SERVICE,
        description: '',
        technology: 'TypeScript',
        externalUrl: null,
      },
    });
    return {
      nodeId,
      message: {
        event: 'update',
        data: {
          updateId: randomUUID(),
          updateBase64: Buffer.from(Y.encodeStateAsUpdate(document, before)).toString('base64'),
        },
      },
    };
  } finally {
    document.destroy();
  }
}
async function kill(child, signal) {
  assert.equal(child.kill(signal), true);
  return within(child.done, 28_000);
}
async function receipt(boardId, updateId) {
  return (
    await database.query(
      'SELECT seq::text, payload_hash FROM update_receipts WHERE board_id=$1 AND update_id=$2',
      [boardId, updateId],
    )
  )[0];
}
try {
  const target = proofTarget(process.env);
  if (process.platform === 'win32')
    throw new Error('Literal SIGTERM/SIGKILL proof requires Linux.');
  admin = new Pool({ connectionString: target.toString(), max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  target.searchParams.set('options', `-c search_path=${schema}`);
  database = new DataSource({
    type: 'postgres',
    url: target.toString(),
    schema,
    entities: [...DATABASE_ENTITIES],
    migrations: [
      InitialDatabaseFoundation1789300000000,
      RetainCompactedUpdateReceipts1790426800000,
    ],
    synchronize: false,
    migrationsRun: false,
  });
  await database.initialize();
  await database.runMigrations({ transaction: 'all' });
  const port = await freePort(),
    origin = `http://127.0.0.1:${port}`;
  const lockUrl = new URL(target);
  lockUrl.searchParams.set('application_name', schema);
  const environment = {
    PATH: process.env.PATH,
    NODE_ENV: 'test',
    PORT: String(port),
    PUBLIC_API_ORIGIN: origin,
    ALLOWED_WEB_ORIGINS: origin,
    DATABASE_URL: target.toString(),
    DATABASE_DIRECT_URL: lockUrl.toString(),
    BETTER_AUTH_SECRET: 'synthetic-process-proof-auth-secret-32chars',
  };
  stage = 'startup-singleton';
  let child = start(environment);
  await ready(child, origin);
  const duplicate = start({ ...environment, PORT: String(await freePort()) });
  assert.notEqual((await within(duplicate.done)).code, 0);
  const email = `${randomUUID()}@example.com`;
  const signup = await fetch(`${origin}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({
      name: 'Synthetic process proof',
      email,
      password: 'synthetic-password-32characters-long',
    }),
  });
  assert.equal(signup.status, 200);
  const cookie = signup.headers
    .getSetCookie()
    .find((value) => value.includes('.session_token='))
    .split(';', 1)[0];
  const owner = (await database.query('SELECT id FROM "user" WHERE email=$1', [email]))[0].id;
  const boardId = randomUUID(),
    now = new Date();
  await database.getRepository(BoardEntity).save({
    id: boardId,
    ownerUserId: owner,
    title: 'Process proof',
    description: '',
    archivedAt: null,
    metadataVersion: 1,
    latestSeq: '0',
    contentUpdatedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await database
    .getRepository(BoardSnapshotEntity)
    .save({ boardId, ...createEmptyBoardSnapshot(), updatedAt: now });
  stage = 'graceful-idle';
  assert.equal((await kill(child, 'SIGTERM')).code, 0);

  for (const point of ['database-commit', 'after-commit-before-ack']) {
    stage = `literal-kill-${point}`;
    child = start(environment, point);
    await ready(child, origin);
    const client = await connect(origin, boardId, cookie),
      peer = await connect(origin, boardId, cookie);
    const proposal = update(client.initial.data.snapshotBase64),
      reached = held(child);
    client.socket.send(JSON.stringify(proposal.message));
    await reached;
    assert.equal(
      client.messages.some((message) => message.event === 'ack'),
      false,
    );
    assert.equal(
      peer.messages.some((message) => message.event === 'update'),
      false,
    );
    const committed = await receipt(boardId, proposal.message.data.updateId);
    assert.equal(committed !== undefined, point === 'after-commit-before-ack');
    assert.equal((await kill(child, 'SIGKILL')).signal, 'SIGKILL');
    child = start(environment);
    await ready(child, origin);
    const retry = await connect(origin, boardId, cookie),
      observer = await connect(origin, boardId, cookie);
    const reopened = new Y.Doc();
    Y.applyUpdate(reopened, Buffer.from(retry.initial.data.snapshotBase64, 'base64'));
    assert.equal(
      projectGraphDocument(reopened).nodes.some((node) => node.id === proposal.nodeId),
      point === 'after-commit-before-ack',
    );
    reopened.destroy();
    retry.socket.send(JSON.stringify(proposal.message));
    const ack = await retry.next(
      (message) =>
        message.event === 'ack' && message.data.updateId === proposal.message.data.updateId,
    );
    if (committed) {
      assert.equal(ack.data.seq, committed.seq);
      await delay(150);
      assert.equal(
        observer.messages.some((message) => message.event === 'update'),
        false,
      );
    } else
      await observer.next(
        (message) => message.event === 'update' && message.data.seq === ack.data.seq,
      );
    assert.equal(
      (
        await database.query(
          'SELECT count(*)::int AS n FROM update_receipts WHERE board_id=$1 AND update_id=$2',
          [boardId, proposal.message.data.updateId],
        )
      )[0].n,
      1,
    );
    assert.equal((await kill(child, 'SIGTERM')).code, 0);
  }
  stage = 'graceful-admitted-transaction';
  child = start(environment, 'database-commit');
  await ready(child, origin);
  const client = await connect(origin, boardId, cookie),
    proposal = update(client.initial.data.snapshotBase64),
    reached = held(child);
  client.socket.send(JSON.stringify(proposal.message));
  await reached;
  child.kill('SIGTERM');
  await delay(100);
  assert.equal((await fetch(`${origin}/health/ready`)).status, 503);
  assert.equal((await fetch(`${origin}/api/boards`)).status, 503);
  child.send({ event: 'resume' });
  assert.equal((await within(child.done, 28_000)).code, 0);
  assert.ok(await receipt(boardId, proposal.message.data.updateId));
  assert.equal(
    client.messages.some((message) => message.event === 'ack'),
    false,
  );

  stage = 'hung-transaction-deadline';
  child = start(environment, 'database-commit');
  await ready(child, origin);
  const stuck = await connect(origin, boardId, cookie),
    stuckProposal = update(stuck.initial.data.snapshotBase64),
    stuckReached = held(child);
  stuck.socket.send(JSON.stringify(stuckProposal.message));
  await stuckReached;
  child.kill('SIGTERM');
  assert.equal((await within(child.done, 28_000)).code, 1);
  assert.equal(await receipt(boardId, stuckProposal.message.data.updateId), undefined);
  assert.equal(
    stuck.messages.some((message) => message.event === 'ack'),
    false,
  );

  stage = 'dedicated-lock-loss';
  child = start(environment, 'database-commit');
  await ready(child, origin);
  const lossClient = await connect(origin, boardId, cookie);
  const lossPeer = await connect(origin, boardId, cookie);
  const lossProposal = update(lossClient.initial.data.snapshotBase64),
    lossReached = held(child);
  lossClient.socket.send(JSON.stringify(lossProposal.message));
  await lossReached;
  const rows = await admin.query(
    'SELECT pg_terminate_backend(pid) AS terminated FROM pg_stat_activity WHERE application_name=$1 AND pid<>pg_backend_pid()',
    [schema],
  );
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].terminated, true);
  assert.equal((await within(child.done)).code, 1);
  assert.equal(await receipt(boardId, lossProposal.message.data.updateId), undefined);
  assert.equal(
    lossClient.messages.some((message) => message.event === 'ack'),
    false,
  );
  assert.equal(
    lossPeer.messages.some((message) => message.event === 'update'),
    false,
  );
  await within(
    new Promise((resolve) =>
      lossClient.socket.readyState === WebSocket.CLOSED
        ? resolve()
        : lossClient.socket.once('close', resolve),
    ),
  );
  stage = 'incompatible-schema-startup';
  await database.query('ALTER TABLE checkpoints RENAME TO incompatible_checkpoints');
  child = start(environment);
  assert.notEqual((await within(child.done)).code, 0);
  await database.query('ALTER TABLE incompatible_checkpoints RENAME TO checkpoints');
  child = start(environment);
  await ready(child, origin);
  assert.equal((await kill(child, 'SIGTERM')).code, 0);
  process.stdout.write(
    'PASS P8-07 process proof: singleton, live/ready, pre/post-commit kill, exact retry, drain and lock-loss/restart.\n',
  );
} catch {
  process.stderr.write(`FAIL P8-07 process proof at ${stage}; sensitive output withheld.\n`);
  process.exitCode = 1;
} finally {
  for (const socket of sockets) socket.terminate();
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await within(child.done).catch(() => undefined);
    }
  if (database?.isInitialized)
    await database.destroy().catch(() => {
      process.exitCode = 1;
    });
  if (schemaCreated)
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`).catch(() => {
      process.exitCode = 1;
    });
  await admin?.end();
}
