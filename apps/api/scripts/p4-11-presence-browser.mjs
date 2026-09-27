import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { projectGraphDocument } from '@archboard/document-model';
import { PostgresRoomLoader } from '../dist/modules/collaboration/infrastructure/room/postgres-room-loader.js';
import { DataSource } from 'typeorm';
import { NestFactory } from '@nestjs/core';
import { chromium } from '../../../packages/sync-client/node_modules/playwright/index.mjs';

import { AppModule } from '../dist/app.module.js';
import { InitialDatabaseFoundation1789300000000 } from '../dist/migrations/1789300000000-InitialDatabaseFoundation.js';
import { RetainCompactedUpdateReceipts1790426800000 } from '../dist/migrations/1790426800000-RetainCompactedUpdateReceipts.js';
import { DATABASE_ENTITIES } from '../dist/platform/database/database-entities.js';
import { loadApiConfig } from '../dist/platform/config/index.js';
import { configureCollaborationWebSockets } from '../dist/modules/collaboration/infrastructure/websocket/index.js';
import { BetterAuthRuntime, configureAuthHttp } from '../dist/modules/auth/index.js';
import { BoardEntity } from '../dist/modules/boards/infrastructure/entities/board.entity.js';
import { BoardMemberEntity } from '../dist/modules/boards/infrastructure/entities/board-member.entity.js';

const apiOrigin = 'http://127.0.0.1:4174';
const webOrigin = 'http://127.0.0.1:4173';
const schema = `archboard_p411_${process.pid}_${randomUUID().slice(0, 8)}`;
const directUrl = process.env.DATABASE_URL_UNPOOLED;
if (!directUrl) throw new Error('DATABASE_URL_UNPOOLED is required.');
console.info = () => undefined;

const scoped = new URL(directUrl);
scoped.searchParams.set('options', `-c search_path=${schema}`);
const admin = new Pool({ connectionString: directUrl, max: 1 });
let database;
let application;
let preview;
let browser;

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function waitForServer(url) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server did not start: ${url}`);
}

async function request(path, cookie, method = 'GET', body) {
  const response = await fetch(`${apiOrigin}/api/v1${path}`, {
    method,
    headers: {
      origin: webOrigin,
      ...(cookie ? { cookie } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(method === 'POST' ? { 'idempotency-key': randomUUID() } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  expect(
    response.ok,
    `${method} ${path} failed with ${response.status}: ${JSON.stringify(payload)}`,
  );
  return payload.data;
}

async function signup(name) {
  const response = await fetch(`${apiOrigin}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { origin: webOrigin, 'content-type': 'application/json' },
    body: JSON.stringify({
      name,
      email: `p411-${name}-${randomUUID()}@example.test`,
      password: 'p411-test-password-32-characters',
    }),
  });
  expect(response.ok, `Sign-up failed for ${name}: ${response.status}`);
  const pair = response.headers
    .getSetCookie()
    .find((header) => header.includes('.session_token='))
    ?.split(';', 1)[0];
  expect(pair, `Session cookie missing for ${name}`);
  const user = await request('/me', pair);
  return { id: user.id, cookie: pair };
}

async function contextFor(user) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const separator = user.cookie.indexOf('=');
  await context.addCookies([
    {
      name: user.cookie.slice(0, separator),
      value: user.cookie.slice(separator + 1),
      url: apiOrigin,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  return context;
}

try {
  await admin.query(`CREATE SCHEMA "${schema}"`);
  database = new DataSource({
    type: 'postgres',
    url: scoped.toString(),
    schema,
    entities: [...DATABASE_ENTITIES],
    migrations: [
      InitialDatabaseFoundation1789300000000,
      RetainCompactedUpdateReceipts1790426800000,
    ],
    synchronize: false,
    migrationsRun: false,
    extra: { max: 6, options: `-c search_path=${schema}` },
  });
  await database.initialize();
  await database.runMigrations({ transaction: 'all' });
  const config = loadApiConfig({
    NODE_ENV: 'test',
    PUBLIC_API_ORIGIN: apiOrigin,
    ALLOWED_WEB_ORIGINS: webOrigin,
    PORT: '4174',
    DATABASE_URL: scoped.toString(),
    DATABASE_DIRECT_URL: scoped.toString(),
    BETTER_AUTH_SECRET: 'p411-browser-test-secret-32-characters',
  });
  application = await NestFactory.create(AppModule.register(config), {
    bodyParser: false,
    logger: false,
  });
  configureCollaborationWebSockets(application);
  configureAuthHttp(application, application.get(BetterAuthRuntime), config);
  await application.listen(4174, '127.0.0.1');

  const webDir = fileURLToPath(new URL('../../web/', import.meta.url));
  preview = spawn(
    process.execPath,
    [
      'node_modules/vite/bin/vite.js',
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      '4173',
      '--strictPort',
    ],
    {
      cwd: webDir,
      windowsHide: true,
      stdio: 'ignore',
    },
  );
  await waitForServer(webOrigin);

  const owner = await signup('owner');
  const editor = await signup('editor');
  const viewer = await signup('viewer');
  const board = await request('/boards', owner.cookie, 'POST', { title: 'Live P4-11 board' });
  await database.getRepository(BoardMemberEntity).insert([
    { boardId: board.id, userId: editor.id, role: 'editor', createdAt: new Date() },
    { boardId: board.id, userId: viewer.id, role: 'viewer', createdAt: new Date() },
  ]);

  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const ownerContext = await contextFor(owner);
  const editorContext = await contextFor(editor);
  const viewerContext = await contextFor(viewer);
  const ownerPage = await ownerContext.newPage();
  const editorPage = await editorContext.newPage();
  const viewerPage = await viewerContext.newPage();
  for (const page of [ownerPage, editorPage, viewerPage]) {
    page.on('pageerror', (error) => console.log('Browser page error:', error.message));
    page.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload }) => {
        try {
          const frame = JSON.parse(payload);
          if (frame.event === 'error') console.log('WebSocket rejection:', frame.data.code);
        } catch {
          /* ignored diagnostic */
        }
      });
    });
  }
  const boardUrl = `${webOrigin}/boards/${board.id}`;
  await Promise.all([
    ownerPage.goto(boardUrl),
    editorPage.goto(boardUrl),
    viewerPage.goto(boardUrl),
  ]);
  console.log('P4-11 browser: board routes opened');
  await ownerPage.getByText('Saved to server', { exact: true }).first().waitFor({ timeout: 20000 });
  await editorPage
    .getByText('Saved to server', { exact: true })
    .first()
    .waitFor({ timeout: 20000 });
  await viewerPage
    .getByText('Read-only · viewer', { exact: true })
    .first()
    .waitFor({ timeout: 20000 });
  console.log('P4-11 browser: roles and handshake ready');
  expect(
    await viewerPage
      .getByRole('button', { name: /Component.*Service or application/ })
      .isDisabled(),
    'Viewer create control remained enabled',
  );

  await ownerPage.getByRole('button', { name: /Component.*Service or application/ }).click();
  try {
    await ownerPage
      .getByText('Saved to server', { exact: true })
      .first()
      .waitFor({ timeout: 12000 });
  } catch (error) {
    console.log(
      'Owner phase after edit:',
      await ownerPage.locator('[data-phase]').first().getAttribute('data-phase'),
    );
    console.log(
      'Owner status after edit:',
      await ownerPage.locator('[role=status]').allTextContents(),
    );
    console.log(
      'Board sequence after edit:',
      (await database.getRepository(BoardEntity).findOne({ where: { id: board.id } }))?.latestSeq,
    );
    throw error;
  }
  await editorPage.locator('.react-flow__node').first().waitFor({ timeout: 20000 });
  await editorPage.getByRole('button', { name: /Note.*Context for the team/ }).click();
  await ownerPage.locator('.react-flow__node').nth(1).waitFor({ timeout: 20000 });
  await editorPage
    .getByText('Saved to server', { exact: true })
    .first()
    .waitFor({ timeout: 20000 });
  console.log('P4-11 browser: edits converged');

  const boardRow = () => database.getRepository(BoardEntity).findOneByOrFail({ id: board.id });
  const committedGraph = async () => {
    const room = await new PostgresRoomLoader(database).load(board.id);
    try {
      return projectGraphDocument(room.document);
    } finally {
      room.document.destroy();
    }
  };
  const initial = await boardRow();
  const initialGraph = await committedGraph();
  const component = initialGraph.nodes.find((node) => node.kind === 'component');
  expect(component, 'Missing committed component');
  const nodeSelector = '.react-flow__node[data-id="' + component.id + '"]';
  const ownerNode = ownerPage.locator(nodeSelector);
  const peerNode = editorPage.locator(nodeSelector);
  const peerTransform = await peerNode.getAttribute('style');
  const box = await ownerNode.boundingBox();
  expect(box, 'Component is not visible');
  const x = box.x + 40;
  const y = box.y + 25;
  await ownerPage.mouse.move(x, y);
  await editorPage.locator('[data-presence-cursor]').first().waitFor();
  await ownerPage.mouse.down();
  await ownerPage.mouse.move(x + 100, y + 80, { steps: 15 });
  const previewSelector = '[data-presence-preview="' + component.id + '"]';
  await editorPage.locator(previewSelector).waitFor();
  await viewerPage.locator(previewSelector).waitFor();
  await editorPage.locator('[data-presence-selection]').first().waitFor();
  expect((await boardRow()).latestSeq === initial.latestSeq, 'Mid-drag changed server sequence');
  expect(
    (await peerNode.getAttribute('style')) === peerTransform,
    'Preview replaced committed peer geometry',
  );
  expect(
    JSON.stringify(await committedGraph()) === JSON.stringify(initialGraph),
    'Mid-drag changed committed document',
  );
  expect(
    (await boardRow()).contentUpdatedAt.getTime() === initial.contentUpdatedAt.getTime(),
    'Presence changed content timestamp',
  );
  await ownerPage.screenshot({ path: '../../docs/evidence/phase4/P4-11-owner-drag.png' });
  await editorPage.screenshot({ path: '../../docs/evidence/phase4/P4-11-peer-preview.png' });
  await ownerPage.mouse.up();
  await ownerPage.getByText('Saved to server', { exact: true }).first().waitFor();
  await editorPage.locator(previewSelector).waitFor({ state: 'detached' });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await boardRow()).latestSeq !== initial.latestSeq) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const afterDrag = await boardRow();
  console.log('Drag sequences:', initial.latestSeq, afterDrag.latestSeq);
  expect(
    BigInt(afterDrag.latestSeq) === BigInt(initial.latestSeq) + 1n,
    'Drag end did not commit exactly one update',
  );
  const movedGraph = await committedGraph();
  const moved = movedGraph.nodes.find((node) => node.id === component.id);
  expect(
    JSON.stringify(moved.position) !== JSON.stringify(component.position),
    'Drag end did not move geometry',
  );
  await editorPage.waitForFunction(
    ({ selector, previous }) =>
      globalThis.document.querySelector(selector)?.getAttribute('style') !== previous,
    { selector: nodeSelector, previous: peerTransform },
  );
  console.log(
    'P4-11 browser: peer cursor/preview, no mid-drag writes, exactly one final geometry commit PASS',
  );

  // No synthetic expiry clock: the connected sender stops producing presence for 30 seconds.
  await ownerPage.mouse.move(x + 105, y + 85);
  await editorPage.locator('[data-presence-cursor]').first().waitFor();
  await editorPage.waitForFunction(
    () => globalThis.document.querySelectorAll('[data-presence-cursor]').length === 0,
    undefined,
    { timeout: 35000 },
  );
  expect(
    (await boardRow()).latestSeq === afterDrag.latestSeq,
    'Presence expiry changed graph sequence',
  );
  console.log('P4-11 browser: real 30-second inactivity expiry PASS');

  // Closing the sender while its pointer is down must leave only committed geometry.
  const movedBox = await ownerNode.boundingBox();
  await ownerPage.mouse.move(movedBox.x + 40, movedBox.y + 25);
  await ownerPage.mouse.down();
  await ownerPage.mouse.move(movedBox.x + 150, movedBox.y + 100, { steps: 15 });
  await editorPage.locator(previewSelector).waitFor();
  await ownerPage.close();
  await editorPage.locator(previewSelector).waitFor({ state: 'detached', timeout: 5000 });
  expect((await boardRow()).latestSeq === afterDrag.latestSeq, 'Mid-drag close committed geometry');
  expect(
    JSON.stringify(await committedGraph()) === JSON.stringify(movedGraph),
    'Mid-drag close changed committed document',
  );
  console.log('P4-11 browser: mid-drag close removes preview and preserves last commit PASS');
  console.log(
    'P4-11 LIVE BROWSER PASS: real cookies, independent owner/editor/viewer contexts, cursor/selection/preview, expiry, drag commit, mid-drag close',
  );
} finally {
  await browser?.close();
  preview?.kill();
  await application?.close();
  if (database?.isInitialized) await database.destroy();
  try {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await admin.end();
  }
}
