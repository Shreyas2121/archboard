import { GRAPH_SCHEMA_VERSION } from '@archboard/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteDB } from 'idb';

import { LOCAL_DEMO_USER_KEY, SYNC_DATABASE_NAME } from '../config/index.js';
import type { BoardStorageNamespace } from '../persistence/namespace.js';
import { LOCK_HINT_TYPES, WRITER_LOCK_PREFIX } from './constants.js';
import type { WriterLockHarness } from './test-harness.js';
import {
  BrowserWriterSession,
  WRITER_SESSION_PHASES,
  WriterLockRequiredError,
} from './writer-session.js';
import { writerLockName } from './names.js';

interface HarnessWindow extends Window {
  archboardWriterLockHarness?: WriterLockHarness;
  archboardWriterLockHarnessReady?: Promise<void>;
}

const POLL_INTERVAL_MS = 10;
const POLL_ATTEMPTS = 500;
const EXPECTED_OUTBOX_AFTER_TRANSFER = 2;
const harnessWindows: HarnessWindow[] = [];

function namespace(boardId = crypto.randomUUID()): BoardStorageNamespace {
  return {
    deploymentOrigin: window.location.origin,
    userId: LOCAL_DEMO_USER_KEY,
    boardId,
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('Timed out waiting for writer-lock harness state.');
}

async function openHarness(boardId: string): Promise<HarnessWindow> {
  const url = new URL('/src/locking/test-harness.html', window.location.origin);
  url.searchParams.set('boardId', boardId);
  const opened = window.open(url, '_blank');
  if (opened === null) throw new Error('Browser blocked the writer-lock test page.');
  const harnessWindow = opened as HarnessWindow;
  harnessWindows.push(harnessWindow);
  await waitFor(() => harnessWindow.archboardWriterLockHarnessReady !== undefined);
  await harnessWindow.archboardWriterLockHarnessReady;
  return harnessWindow;
}

function harness(page: HarnessWindow): WriterLockHarness {
  const value = page.archboardWriterLockHarness;
  if (value === undefined) throw new Error('Writer-lock harness did not initialize.');
  return value;
}

afterEach(async () => {
  await Promise.all(
    harnessWindows.splice(0).map(async (page) => {
      await page.archboardWriterLockHarness?.close();
      page.close();
    }),
  );
  await deleteDB(SYNC_DATABASE_NAME);
});

describe('Web Lock and BroadcastChannel writer ownership in independent pages', () => {
  it('proves A12 ownership, forged-hint resistance, and hydrated lock transfer', async () => {
    const boardId = crypto.randomUUID();
    const storageNamespace = namespace(boardId);
    const firstPage = await openHarness(boardId);
    const first = harness(firstPage);
    expect(first.snapshot()).toMatchObject({
      phase: WRITER_SESSION_PHASES.WRITER,
      writable: true,
    });

    const secondPage = await openHarness(boardId);
    const second = harness(secondPage);
    expect(second.snapshot()).toMatchObject({
      phase: WRITER_SESSION_PHASES.READ_ONLY_HELD_ELSEWHERE,
      writable: false,
    });
    expect((await navigator.locks.query()).held?.map(({ name }) => name)).toContain(
      writerLockName(storageNamespace),
    );
    expect(writerLockName(storageNamespace)).toMatch(new RegExp(`^${WRITER_LOCK_PREFIX}`));

    expect(await first.mutate('Written by first page')).toBe(true);
    await waitFor(() => second.snapshot().lastHint === LOCK_HINT_TYPES.CACHE_CHANGED);
    first.announceResetComplete();
    await waitFor(() => second.snapshot().lastHint === LOCK_HINT_TYPES.RESET_COMPLETE);
    const updatesBeforeReadOnlyAttempt = await second.localUpdateCount();
    expect(await second.mutate('Forbidden second-page write')).toBe(false);
    expect(await second.localUpdateCount()).toBe(updatesBeforeReadOnlyAttempt);

    second.forgeReleaseHint();
    await waitFor(
      () =>
        second.snapshot().lastHint === LOCK_HINT_TYPES.LOCK_RELEASED &&
        second.snapshot().phase === WRITER_SESSION_PHASES.READ_ONLY_HELD_ELSEWHERE,
    );
    expect(second.snapshot().writable).toBe(false);

    await first.close();
    await waitFor(() => second.snapshot().phase === WRITER_SESSION_PHASES.WRITER);
    expect(second.snapshot().writable).toBe(true);
    expect(second.projection().nodes.map(({ title }) => title)).toContain('Written by first page');
    expect(await second.mutate('Written after transfer')).toBe(true);
    expect(await second.outboxCount()).toBe(EXPECTED_OUTBOX_AFTER_TRANSFER);
  });

  it('uses explicit unsupported, releasing, and closed states without a fallback lease', async () => {
    const writer = await BrowserWriterSession.open({ namespace: namespace() });
    const writerPhases: string[] = [];
    writer.subscribe(() => writerPhases.push(writer.getSnapshot().phase));
    await writer.close();
    expect(writerPhases).toContain(WRITER_SESSION_PHASES.RELEASING);
    expect(writerPhases).toContain(WRITER_SESSION_PHASES.CLOSED);

    const unsupported = await BrowserWriterSession.open({
      namespace: namespace(),
      lockManager: null,
    });
    expect(unsupported.getSnapshot()).toMatchObject({
      phase: WRITER_SESSION_PHASES.UNSUPPORTED,
      writable: false,
    });
    expect(unsupported.getWritableBinding()).toBeNull();
    expect(() => unsupported.executeMutation(() => undefined)).toThrow(WriterLockRequiredError);

    const phases: string[] = [];
    unsupported.subscribe(() => phases.push(unsupported.getSnapshot().phase));
    const firstClose = unsupported.close();
    expect(unsupported.close()).toBe(firstClose);
    await firstClose;
    expect(unsupported.getSnapshot().phase).toBe(WRITER_SESSION_PHASES.CLOSED);
    expect(phases).toContain(WRITER_SESSION_PHASES.CLOSED);
  });
});
