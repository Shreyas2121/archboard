import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { DataSource } from 'typeorm';
import { NestFactory } from '@nestjs/core';
import { chromium } from '../../../packages/sync-client/node_modules/playwright/index.mjs';

import { AppModule } from '../dist/app.module.js';
import { InitialDatabaseFoundation1789300000000 } from '../dist/migrations/1789300000000-InitialDatabaseFoundation.js';
import { RetainCompactedUpdateReceipts1790426800000 } from '../dist/migrations/1790426800000-RetainCompactedUpdateReceipts.js';
import { DATABASE_ENTITIES } from '../dist/platform/database/database-entities.js';
import { loadApiConfig } from '../dist/platform/config/index.js';
import { configureCollaborationWebSockets } from '../dist/modules/collaboration/infrastructure/websocket/index.js';
import { CollaborationGateway } from '../dist/modules/collaboration/infrastructure/websocket/collaboration.gateway.js';
import { BetterAuthRuntime, configureAuthHttp } from '../dist/modules/auth/index.js';
import { BoardEntity } from '../dist/modules/boards/infrastructure/entities/board.entity.js';
import { BoardMemberEntity } from '../dist/modules/boards/infrastructure/entities/board-member.entity.js';

const apiOrigin = 'http://127.0.0.1:4174';
const webOrigin = 'http://127.0.0.1:4173';
const schema = `archboard_p410_${process.pid}_${randomUUID().slice(0, 8)}`;
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
      email: `p410-${name}-${randomUUID()}@example.test`,
      password: 'p410-test-password-32-characters',
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
    BETTER_AUTH_SECRET: 'p410-browser-test-secret-32-characters',
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
  const board = await request('/boards', owner.cookie, 'POST', { title: 'Live P4-10 board' });
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
  console.log('P4-10 browser: board routes opened');
  await ownerPage.getByText('Saved to server', { exact: true }).first().waitFor({ timeout: 20000 });
  await editorPage
    .getByText('Saved to server', { exact: true })
    .first()
    .waitFor({ timeout: 20000 });
  await viewerPage
    .getByText('Read-only · viewer', { exact: true })
    .first()
    .waitFor({ timeout: 20000 });
  console.log('P4-10 browser: roles and handshake ready');
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
  console.log('P4-10 browser: edits converged');

  const secondOwnerPage = await ownerContext.newPage();
  await secondOwnerPage.goto(boardUrl);
  await secondOwnerPage
    .getByText('Read-only · open in another tab', { exact: true })
    .first()
    .waitFor({ timeout: 20000 });
  expect(
    await secondOwnerPage
      .getByRole('button', { name: /Component.*Service or application/ })
      .isDisabled(),
    'Second tab create control remained enabled',
  );
  await secondOwnerPage.close();

  await ownerContext.setOffline(true);
  for (const socket of application.get(CollaborationGateway).server.clients) socket.terminate();
  await ownerPage
    .getByText('Offline · cached copy', { exact: true })
    .first()
    .waitFor({ timeout: 20000 });
  await ownerContext.setOffline(false);
  await ownerPage.getByText('Saved to server', { exact: true }).first().waitFor({ timeout: 20000 });

  const archived = await request(`/boards/${board.id}/archive`, owner.cookie, 'POST', {
    expectedVersion: board.metadataVersion,
  });
  expect(archived.archivedAt !== null, 'Board archive did not commit');
  await ownerPage
    .getByText('Access changed · local changes preserved', { exact: true })
    .first()
    .waitFor({ timeout: 20000 });
  expect(
    await ownerPage.getByRole('button', { name: /Component.*Service or application/ }).isDisabled(),
    'Archived board create control remained enabled',
  );

  const demoPage = await ownerContext.newPage();
  let demoSockets = 0;
  demoPage.on('websocket', () => {
    demoSockets += 1;
  });
  await demoPage.goto(`${webOrigin}/demo`);
  await demoPage
    .getByText('Saved on this device', { exact: true })
    .first()
    .waitFor({ timeout: 20000 });
  expect(demoSockets === 0, 'Local demo opened a collaboration socket');
  console.log(
    'P4-10 LIVE BROWSER PASS: independent owner/editor/viewer profiles, convergence, second-tab read-only, offline reconnect, archive freeze, demo socket isolation',
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
