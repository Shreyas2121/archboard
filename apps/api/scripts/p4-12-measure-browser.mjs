import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { cpus, totalmem } from 'node:os';
import * as Y from 'yjs';
import { createGraphDocument, createNode } from '@archboard/document-model';
import { COLOR_TOKENS, COMPONENT_CATEGORIES } from '@archboard/contracts';
import { BoardSnapshotEntity } from '../dist/modules/collaboration/infrastructure/entities/board-snapshot.entity.js';
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
import { BoardMemberEntity } from '../dist/modules/boards/infrastructure/entities/board-member.entity.js';

const apiOrigin = 'http://127.0.0.1:4174';
const webOrigin = 'http://127.0.0.1:4173';
const schema = `archboard_p412_measure_${process.pid}_${randomUUID().slice(0, 8)}`;
const directUrl = process.env.DATABASE_URL_UNPOOLED;
if (!directUrl) throw new Error('DATABASE_URL_UNPOOLED is required.');
const serverTimings = { dbWriteMs: [], ackLatencyMs: [] };
console.info = (line) => {
  try {
    const metric = JSON.parse(line);
    if (metric.event === 'collaboration.db_write' && !metric.duplicate) {
      serverTimings.dbWriteMs.push(metric.durationMs);
    }
    if (metric.event === 'collaboration.ack' && !metric.duplicate) {
      serverTimings.ackLatencyMs.push(metric.latencyMs);
    }
  } catch {
    // Only structured, numeric collaboration timings are retained for the report.
  }
};

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
      email: `p412_measure-${name}-${randomUUID()}@example.test`,
      password: 'p412_measure-test-password-32-characters',
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
    BETTER_AUTH_SECRET: 'p412_measure-browser-test-secret-32-characters',
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

  const users = [];
  for (let index = 0; index < 5; index += 1) users.push(await signup('writer-' + index));
  const board = await request('/boards', users[0].cookie, 'POST', {
    title: '200-node measurement board',
  });
  await database.getRepository(BoardMemberEntity).insert(
    users.slice(1).map((user) => ({
      boardId: board.id,
      userId: user.id,
      role: 'editor',
      createdAt: new Date(),
    })),
  );
  const seed = createGraphDocument();
  for (let index = 0; index < 200; index += 1) {
    createNode(seed, {
      id: randomUUID(),
      kind: 'component',
      position: { x: (index % 20) * 300, y: Math.floor(index / 20) * 200 },
      size: { width: 240, height: 140 },
      title: 'Fixture ' + index,
      color: COLOR_TOKENS.BLUE,
      content: {
        category: COMPONENT_CATEGORIES.SERVICE,
        description: '',
        technology: 'TypeScript',
        externalUrl: null,
      },
    });
  }
  const snapshotBytes = Buffer.from(Y.encodeStateAsUpdate(seed));
  seed.destroy();
  await database.getRepository(BoardSnapshotEntity).update(
    { boardId: board.id },
    {
      throughSeq: '0',
      updateBytes: snapshotBytes,
      byteLength: snapshotBytes.byteLength,
    },
  );

  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const pages = [];

  for (const user of users) {
    const context = await contextFor(user);
    const page = await context.newPage();
    const session = await context.newCDPSession(page);
    await session.send('Network.enable');
    await session.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 100,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    pages.push(page);
  }
  const boardUrl = webOrigin + '/boards/' + board.id;
  await Promise.all(pages.map((page) => page.goto(boardUrl)));
  await Promise.all(
    pages.map((page) =>
      page.getByText('Saved to server', { exact: true }).first().waitFor({ timeout: 30000 }),
    ),
  );
  await Promise.all(
    pages.map((page) =>
      page.waitForFunction(
        () => globalThis.document.querySelectorAll('.react-flow__node').length >= 200,
      ),
    ),
  );

  const visibilityMs = [];
  for (let sample = 0; sample < 20; sample += 1) {
    const writer = pages[sample % pages.length];
    const started = performance.now();
    await writer.getByRole('button', { name: /Component.*Service or application/ }).click();
    await Promise.all(
      pages.map((page) =>
        page.waitForFunction(
          (minimum) => globalThis.document.querySelectorAll('.react-flow__node').length >= minimum,
          201 + sample,
          { timeout: 30000 },
        ),
      ),
    );
    visibilityMs.push(Math.round(performance.now() - started));
  }
  const openingMs = [];
  for (let sample = 0; sample < 5; sample += 1) {
    const started = performance.now();
    await pages[0].reload();
    await pages[0].waitForFunction(
      () =>
        globalThis.document.querySelectorAll('.react-flow__node').length >= 220 &&
        !globalThis.document.querySelector('button[aria-label^="Component"]')?.disabled,
      undefined,
      { timeout: 30000 },
    );
    openingMs.push(Math.round(performance.now() - started));
  }
  const percentile95 = (numbers) =>
    [...numbers].sort((a, b) => a - b)[Math.ceil(numbers.length * 0.95) - 1];
  console.log(
    JSON.stringify(
      {
        sample: 'P4-12 local served build; CDP 100ms network latency setting',
        machine: {
          cpu: cpus()[0]?.model ?? 'unknown',
          logicalCpus: cpus().length,
          totalMemoryBytes: totalmem(),
          platform: process.platform,
          node: process.version,
        },
        browser: 'Chrome headless',
        users: pages.length,
        seededNodes: 200,
        updates: visibilityMs.length,
        visibilityMs: { values: visibilityMs, p95: percentile95(visibilityMs), target: 500 },
        cachedOpeningMs: { values: openingMs, p95: percentile95(openingMs), target: 2000 },
        serverTimings: {
          dbWriteMs: {
            samples: serverTimings.dbWriteMs.length,
            p95: percentile95(serverTimings.dbWriteMs),
          },
          ackLatencyMs: {
            samples: serverTimings.ackLatencyMs.length,
            p95: percentile95(serverTimings.ackLatencyMs),
          },
        },
      },
      null,
      2,
    ),
  );
  if (percentile95(visibilityMs) > 500 || percentile95(openingMs) > 2000) {
    process.exitCode = 1;
  }
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
