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
import { BetterAuthRuntime, configureAuthHttp } from '../dist/modules/auth/index.js';
import { BoardEntity } from '../dist/modules/boards/infrastructure/entities/board.entity.js';
import { BoardMemberEntity } from '../dist/modules/boards/infrastructure/entities/board-member.entity.js';

const apiOrigin = 'http://127.0.0.1:4174';
const webOrigin = 'http://127.0.0.1:4173';
const schema = `archboard_p412_${process.pid}_${randomUUID().slice(0, 8)}`;
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
      email: `p412-${name}-${randomUUID()}@example.test`,
      password: 'p412-test-password-32-characters',
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
    BETTER_AUTH_SECRET: 'p412-browser-test-secret-32-characters',
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
  const board = await request('/boards', owner.cookie, 'POST', { title: 'Live P4-12 board' });
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
  console.log('P4-12 browser: board routes opened');
  await ownerPage.getByText('Saved to server', { exact: true }).first().waitFor({ timeout: 20000 });
  await editorPage
    .getByText('Saved to server', { exact: true })
    .first()
    .waitFor({ timeout: 20000 });
  await viewerPage
    .getByText('Read-only · viewer', { exact: true })
    .first()
    .waitFor({ timeout: 20000 });
  console.log('P4-12 browser: roles and handshake ready');
  expect(
    await viewerPage
      .getByRole('button', { name: /Component.*Service or application/ })
      .isDisabled(),
    'Viewer create control remained enabled',
  );

  await ownerPage.getByRole('button', { name: /Component.*Service or application/ }).click();
  await ownerPage.getByText('Saved to server', { exact: true }).first().waitFor({ timeout: 20000 });
  const before = await database.getRepository(BoardEntity).findOneByOrFail({ id: board.id });
  const countBefore = await ownerPage.locator('.react-flow__node').count();
  const reloadButton = ownerPage.getByRole('button', { name: 'Reload server version' });
  await reloadButton.click();
  const dialog = ownerPage.getByRole('dialog', { name: 'Reload the server version?' });
  await dialog.getByText(/pending changes for this account/).waitFor();
  await dialog.getByText(/Changes without a server receipt will be lost/).waitFor();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(
    (await ownerPage.locator('.react-flow__node').count()) === countBefore,
    'Cancel changed the local graph',
  );
  expect(
    (await database.getRepository(BoardEntity).findOneByOrFail({ id: board.id })).latestSeq ===
      before.latestSeq,
    'Cancel changed committed state',
  );
  await reloadButton.click();
  const download = ownerPage.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download recovery' }).click();
  expect(
    (await download).suggestedFilename() === 'archboard-local-recovery.json',
    'Recovery download missing',
  );
  await dialog.getByRole('button', { name: 'Delete local copy and reload' }).click();
  await ownerPage.getByText('Saved to server', { exact: true }).first().waitFor({ timeout: 20000 });
  expect(
    (await ownerPage.locator('.react-flow__node').count()) === countBefore,
    'Server reload did not recover committed graph',
  );
  console.log(
    'P4-12 LIVE BROWSER PASS: warning, cancel, validated export, explicit scoped reload, committed graph reopened',
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
