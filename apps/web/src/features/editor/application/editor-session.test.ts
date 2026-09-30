import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD_ROLES, COLOR_TOKENS } from '@archboard/contracts';
import {
  createGraphDocument,
  createNode,
  editGraphText,
  projectGraphDocument,
} from '@archboard/document-model';
import { WRITER_SESSION_PHASES } from '@archboard/sync-client';

import { EditorSession } from './editor-session';
import { closeEditorSession } from './close-editor-session';

const mocks = vi.hoisted(() => ({ writer: vi.fn(), sync: vi.fn() }));
vi.mock('@archboard/sync-client', async (original) => ({
  ...(await original()),
  BrowserWriterSession: { create: mocks.writer },
  OrderedSyncClient: vi.fn(function () {
    return mocks.sync();
  }),
}));

const NODE_SIZE = { width: 240, height: 140 };

function harness() {
  let documentGeneration = 0;
  const id = crypto.randomUUID();
  const target = { entity: 'node', id, field: 'title' } as const;
  const documentWithTitle = (title: string) => {
    const document = createGraphDocument();
    createNode(document, {
      id,
      kind: 'note',
      title,
      color: COLOR_TOKENS.BLUE,
      position: { x: 0, y: 0 },
      size: NODE_SIZE,
      content: { body: '' },
    });
    document.on('afterTransaction', (transaction) => {
      if (transaction.changed.size > 0) documentGeneration += 1;
    });
    return document;
  };
  const initial = documentWithTitle('first');
  let document = initial;
  let writable = true;
  let phase: string = WRITER_SESSION_PHASES.WRITER;
  const listeners = new Set<() => void>();
  const persistence = {
    readCachedBoardAccess: async () => ({ role: BOARD_ROLES.VIEWER, archived: false }),
    cacheBoardAccess: vi.fn(async () => {}),
    hasQueuedInitialState: async () => false,
  };
  const writer = {
    initialize: vi.fn(async () => {}),
    getSnapshot: () => ({
      documentGeneration,
      phase,
      writable,
      persistence: { editingPaused: !writable },
    }),
    getWritableBinding: () => (writable ? { document, persistence } : null),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getProjection: vi.fn(() => projectGraphDocument(document)),
    hadStoredStateOnOpen: () => true,
    executeMutation: (mutate: (document: typeof initial) => void) => mutate(document),
    close: vi.fn(async () => {
      writable = false;
      phase = WRITER_SESSION_PHASES.CLOSED;
    }),
  };
  const sync = {
    getSnapshot: () => ({
      ready: false,
      phase: 'disconnected',
      errorCode: null,
      role: BOARD_ROLES.VIEWER,
    }),
    subscribe: vi.fn(() => vi.fn()),
    resumeDrain: vi.fn(),
    start: vi.fn(async () => {}),
    stop: vi.fn(),
  };
  mocks.writer.mockReturnValue(writer);
  mocks.sync.mockReturnValue(sync);
  const session = new EditorSession({
    deploymentOrigin: 'https://example.test',
    board: {
      boardId: crypto.randomUUID(),
      userId: 'test-user',
      webSocketOrigin: 'wss://example.test',
    },
  });
  return {
    session,
    initial,
    writer,
    sync,
    target,
    notify: () => {
      for (const listener of listeners) listener();
    },
    setWritable: (next: boolean) => {
      writable = next;
      phase = next ? WRITER_SESSION_PHASES.WRITER : WRITER_SESSION_PHASES.READ_ONLY_HELD_ELSEWHERE;
      for (const listener of listeners) listener();
    },
    replace: () => {
      document = documentWithTitle('replacement');
      documentGeneration += 1;
      for (const listener of listeners) listener();
      return document;
    },
  };
}

beforeEach(() => {
  mocks.writer.mockReset();
  mocks.sync.mockReset();
});

describe('editor text binding availability', () => {
  it('reuses projection across status changes and rebuilds after a document edit', async () => {
    const state = harness();
    try {
      await state.session.open();
      const before = state.session.getSnapshot().projection;
      state.writer.getProjection.mockClear();
      state.notify();
      await state.session.setBoardAccess(BOARD_ROLES.VIEWER, false);
      expect(state.session.getSnapshot().projection).toBe(before);
      expect(state.writer.getProjection).not.toHaveBeenCalled();
      editGraphText(state.initial, state.target, { index: 0, deleteCount: 1, insert: 'Y' });
      state.notify();
      expect(state.session.getSnapshot().projection).not.toBe(before);
      expect(state.writer.getProjection).toHaveBeenCalledTimes(1);
      state.replace();
      const afterReplacementCount = 2;
      expect(state.writer.getProjection).toHaveBeenCalledTimes(afterReplacementCount);
    } finally {
      await state.session.close();
    }
  });
  it('changes generation for viewer promotion, permission loss, and writer takeover', async () => {
    const state = harness();
    const { session, target } = state;
    try {
      await session.open();
      await session.setBoardAccess(BOARD_ROLES.VIEWER, false);
      const viewer = session.getTextBindingGeneration();
      expect(session.accessText(target)).toBeNull();
      await session.setBoardAccess(BOARD_ROLES.EDITOR, false);
      const editor = session.getTextBindingGeneration();
      expect(editor).toBeGreaterThan(viewer);
      expect(session.accessText(target)?.value).toBe('first');
      state.notify();
      expect(session.getTextBindingGeneration()).toBe(editor);
      state.setWritable(false);
      const secondary = session.getTextBindingGeneration();
      expect(secondary).toBeGreaterThan(editor);
      expect(session.accessText(target)).toBeNull();
      state.setWritable(true);
      expect(session.getTextBindingGeneration()).toBeGreaterThan(secondary);
      session.editText(target, { index: 0, deleteCount: 0, insert: '+' });
      expect(session.accessText(target)?.value).toBe('+first');
    } finally {
      await session.close();
      state.initial.destroy();
    }
  });

  it('provides a new binding after document replacement and releases the old observer', async () => {
    const state = harness();
    let replacement: ReturnType<typeof createGraphDocument> | null = null;
    try {
      await state.session.open();
      await state.session.setBoardAccess(BOARD_ROLES.EDITOR, false);
      const oldAccess = state.session.accessText(state.target)!;
      const oldListener = vi.fn();
      const unsubscribe = oldAccess.subscribe(oldListener);
      const generation = state.session.getTextBindingGeneration();
      replacement = state.replace();
      expect(state.session.getTextBindingGeneration()).toBeGreaterThan(generation);
      unsubscribe();
      const access = state.session.accessText(state.target)!;
      const listener = vi.fn();
      const stop = access.subscribe(listener);
      try {
        state.session.editText(state.target, { index: 0, deleteCount: 0, insert: '+' });
        expect(access.value).toBe('+replacement');
        expect(listener).toHaveBeenCalledTimes(1);
        editGraphText(state.initial, state.target, { index: 0, deleteCount: 0, insert: '-' });
        expect(oldListener).not.toHaveBeenCalled();
        expect(listener).toHaveBeenCalledTimes(1);
        state.notify();
        const unchanged = state.session.getTextBindingGeneration();
        state.notify();
        expect(state.session.getTextBindingGeneration()).toBe(unchanged);
      } finally {
        stop();
      }
    } finally {
      await state.session.close();
      state.initial.destroy();
      replacement?.destroy();
    }
  });

  it('closes once and continues cleanup if stopping sync fails', async () => {
    const state = harness();
    const failure = new Error('stop failed');
    try {
      await state.session.open();
      state.sync.stop.mockImplementation(() => {
        throw failure;
      });
      const close = state.session.close();
      expect(state.session.close()).toBe(close);
      await expect(close).rejects.toBe(failure);
      expect(state.writer.close).toHaveBeenCalledTimes(1);
      expect(state.session.canEdit()).toBe(false);
      const report = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await closeEditorSession(state.session);
        expect(report).toHaveBeenCalledWith('Editor session cleanup failed.', failure);
      } finally {
        report.mockRestore();
      }
    } finally {
      state.initial.destroy();
    }
  });
});
