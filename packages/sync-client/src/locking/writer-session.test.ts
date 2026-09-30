import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GRAPH_SCHEMA_VERSION } from '@archboard/contracts';
import { createGraphDocument, projectGraphDocument } from '@archboard/document-model';
import * as Y from 'yjs';
import { createGraphObjects, editGraphText } from '@archboard/document-model';
import { COLOR_TOKENS, NODE_KINDS, type GraphNode } from '@archboard/contracts';

import type { LocalPersistenceAdapterOptions } from '../persistence/local-persistence-adapter.js';
import {
  BrowserWriterSession,
  WRITER_SESSION_PHASES,
  type BrowserWriterSessionOptions,
} from './writer-session.js';

const mocks = vi.hoisted(() => ({ create: vi.fn(), deleteNamespace: vi.fn() }));
vi.mock('../persistence/local-persistence-adapter.js', async (original) => ({
  ...(await original()),
  LocalPersistenceAdapter: { create: mocks.create },
}));
vi.mock('../persistence/namespace-storage.js', () => ({
  deleteBoardStorageNamespace: mocks.deleteNamespace,
}));

function deferred() {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function harness() {
  let held = false;
  const lockManager: NonNullable<BrowserWriterSessionOptions['lockManager']> = {
    async request(name, options, callback) {
      expect(options).toEqual({ mode: 'exclusive', ifAvailable: true });
      if (held) {
        await callback(null);
        return;
      }
      held = true;
      try {
        await callback({ name, mode: 'exclusive' });
      } finally {
        held = false;
      }
    },
  };
  const namespace = {
    deploymentOrigin: 'https://example.test',
    userId: 'writer-test',
    boardId: crypto.randomUUID(),
    graphSchemaVersion: GRAPH_SCHEMA_VERSION,
  };
  function session(documentFactory?: () => Y.Doc) {
    const channel = {
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      close: vi.fn(),
    };
    let pagehide: (() => void) | null = null;
    const lifecycle = {
      addEventListener: vi.fn((type: 'pagehide', listener: () => void) => {
        expect(type).toBe('pagehide');
        pagehide = listener;
      }),
      removeEventListener: vi.fn(() => {
        pagehide = null;
      }),
    };
    const writer = BrowserWriterSession.create({
      namespace,
      lockManager,
      channelFactory: () => channel,
      lifecycleTarget: lifecycle,
      ...(documentFactory === undefined ? {} : { documentFactory }),
    });
    return { writer, channel, lifecycle, pagehide: () => pagehide?.() };
  }
  return { session, held: () => held };
}

function persistence(options: LocalPersistenceAdapterOptions) {
  return {
    initialize: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    subscribe: vi.fn((listener: () => void) => {
      void listener;
      return vi.fn();
    }),
    whenIdle: vi.fn(async () => {}),
    assertEditingAllowed: vi.fn(),
    exportInMemoryProjection: () => projectGraphDocument(options.document),
    getSnapshot: () => ({
      phase: 'ready',
      savedOnDevice: true,
      editingPaused: options.mode === 'read-only',
      pendingWrites: 0,
      errorCode: null,
      diagnostic: null,
    }),
  };
}

beforeEach(() => {
  mocks.create.mockReset().mockImplementation(persistence);
  mocks.deleteNamespace.mockReset().mockResolvedValue(undefined);
});

describe('writer session failure cleanup', () => {
  it('invalidates a read-only projection when a remote update arrives', async () => {
    const state = harness();
    const owner = state.session();
    await owner.writer.initialize();
    const document = createGraphDocument();
    const secondary = state.session(() => document);
    const remote = createGraphDocument();
    const nodeSize = { width: 240, height: 140 };
    try {
      await secondary.writer.initialize();
      expect(secondary.writer.getSnapshot().writable).toBe(false);
      const before = secondary.writer.getProjection();
      const generation = secondary.writer.getSnapshot().documentGeneration;
      createGraphObjects(remote, {
        nodes: [
          {
            id: crypto.randomUUID(),
            kind: NODE_KINDS.NOTE,
            title: 'Remote card',
            position: { x: 0, y: 0 },
            size: nodeSize,
            color: COLOR_TOKENS.BLUE,
            content: { body: '' },
          },
        ],
      });
      Y.applyUpdate(document, Y.encodeStateAsUpdate(remote), 'remote');
      expect(secondary.writer.getSnapshot().documentGeneration).toBeGreaterThan(generation);
      expect(secondary.writer.getProjection()).not.toBe(before);
      expect(secondary.writer.getProjection().nodes[0]?.title).toBe('Remote card');
    } finally {
      remote.destroy();
      await secondary.writer.close();
      await owner.writer.close();
    }
  });
  it('projects a large document once across status notifications and invalidates on edits and replacement', async () => {
    const nodeCount = 500;
    const nodeSize = { width: 240, height: 140 };
    const afterEditCount = 2;
    const afterReplacementCount = 3;
    const fixture = {
      nodes: Array.from({ length: nodeCount }, (): GraphNode => ({
        id: crypto.randomUUID(),
        kind: NODE_KINDS.NOTE,
        title: 'Initial title',
        position: { x: 0, y: 0 },
        size: nodeSize,
        color: COLOR_TOKENS.BLUE,
        content: { body: '' },
      })),
    };
    const state = harness();
    const { writer } = state.session(() => {
      const document = createGraphDocument();
      createGraphObjects(document, fixture);
      return document;
    });
    const exportProjection = vi.fn();
    mocks.create.mockImplementation((options: LocalPersistenceAdapterOptions) => {
      const adapter = persistence(options);
      adapter.exportInMemoryProjection = exportProjection.mockImplementation(() =>
        projectGraphDocument(options.document),
      );
      return adapter;
    });
    try {
      await writer.initialize();
      const first = writer.getProjection();
      const generation = writer.getSnapshot().documentGeneration;
      const adapter = mocks.create.mock.results[0]?.value as ReturnType<typeof persistence>;
      const notify = adapter.subscribe.mock.calls[0]?.[0] as (() => void) | undefined;
      expect(notify).toBeTypeOf('function');
      for (let index = 0; index < fixture.nodes.length; index += 1) {
        notify?.();
        expect(writer.getProjection()).toBe(first);
      }
      expect(writer.getSnapshot().documentGeneration).toBe(generation);
      expect(exportProjection).toHaveBeenCalledTimes(1);
      writer.executeMutation((document) =>
        editGraphText(
          document,
          { entity: 'node', id: fixture.nodes[0]!.id, field: 'title' },
          { index: 0, deleteCount: 1, insert: 'Y' },
        ),
      );
      expect(writer.getSnapshot().documentGeneration).toBeGreaterThan(generation);
      const changed = writer.getProjection();
      expect(changed).not.toBe(first);
      expect(exportProjection).toHaveBeenCalledTimes(afterEditCount);
      await writer.replaceLocalState(() => {});
      expect(writer.getProjection()).not.toBe(changed);
      expect(exportProjection).toHaveBeenCalledTimes(afterReplacementCount);
    } finally {
      await writer.close();
    }
  });
  it('releases the lock and channel after document factory failure', async () => {
    const state = harness();
    const failure = new Error('document factory failed');
    const { writer, channel, lifecycle } = state.session(() => {
      throw failure;
    });
    await expect(writer.initialize()).rejects.toBe(failure);
    expect(state.held()).toBe(false);
    const close = writer.close();
    expect(writer.close()).toBe(close);
    await expect(close).rejects.toBe(failure);
    expect(channel.close).toHaveBeenCalledTimes(1);
    expect(channel.removeEventListener).toHaveBeenCalledTimes(1);
    expect(lifecycle.removeEventListener).toHaveBeenCalledTimes(1);
    expect(writer.getSnapshot().phase).toBe(WRITER_SESSION_PHASES.CLOSED);
    const next = state.session();
    await next.writer.initialize();
    expect(next.writer.getSnapshot().writable).toBe(true);
    await next.writer.close();
  });

  it('disposes a partially initialized view even when its close rejects', async () => {
    const state = harness();
    const document = createGraphDocument();
    const destroy = vi.spyOn(document, 'destroy');
    const failure = new Error('persistence initialize failed');
    const resource = persistence({
      namespace: {
        deploymentOrigin: 'https://example.test',
        userId: 'unused',
        boardId: crypto.randomUUID(),
        graphSchemaVersion: GRAPH_SCHEMA_VERSION,
      },
      document,
    });
    resource.initialize.mockRejectedValue(failure);
    resource.close.mockRejectedValue(new Error('close failed'));
    mocks.create.mockReturnValueOnce(resource);
    const { writer, channel } = state.session(() => document);
    await expect(writer.initialize()).rejects.toBe(failure);
    await expect(writer.close()).rejects.toBe(failure);
    expect(resource.close).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(channel.close).toHaveBeenCalledTimes(1);
    expect(state.held()).toBe(false);
  });

  it.each(['delete', 'replacement-open', 'seed', 'view-close'])(
    'cleans failed reset at $0',
    async (stage) => {
      const state = harness();
      const documents: Y.Doc[] = [];
      const destroys: ReturnType<typeof vi.spyOn>[] = [];
      const { writer, channel } = state.session(() => {
        const document = createGraphDocument();
        documents.push(document);
        destroys.push(vi.spyOn(document, 'destroy'));
        return document;
      });
      await writer.initialize();
      const failure = new Error(`failed ${stage}`);
      if (stage === 'delete') mocks.deleteNamespace.mockRejectedValueOnce(failure);
      if (stage === 'replacement-open')
        mocks.create.mockImplementationOnce((options: LocalPersistenceAdapterOptions) => {
          const resource = persistence(options);
          resource.initialize.mockRejectedValue(failure);
          return resource;
        });
      if (stage === 'view-close') {
        const resource = mocks.create.mock.results[0]?.value as ReturnType<typeof persistence>;
        resource.close.mockRejectedValueOnce(failure);
      }
      await expect(
        writer.replaceLocalState(() => {
          if (stage === 'seed') throw failure;
        }),
      ).rejects.toBe(failure);
      await writer.close();
      expect(state.held()).toBe(false);
      expect(channel.close).toHaveBeenCalledTimes(1);
      for (const destroy of destroys) expect(destroy).toHaveBeenCalledTimes(1);
      expect(documents.every((document) => document.isDestroyed)).toBe(true);
      const next = state.session();
      await next.writer.initialize();
      expect(next.writer.getSnapshot().writable).toBe(true);
      await next.writer.close();
    },
  );

  it('waits for an owned deletion before releasing the lock and prevents reopening', async () => {
    const state = harness();
    const { writer, channel } = state.session();
    await writer.initialize();
    const started = deferred();
    const resume = deferred();
    mocks.deleteNamespace.mockImplementationOnce(async () => {
      started.resolve();
      await resume.promise;
    });
    const reset = writer.clearOwnedLocalState();
    await started.promise;
    const close = writer.close();
    expect(state.held()).toBe(true);
    resume.resolve();
    await Promise.all([reset, close]);
    expect(state.held()).toBe(false);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(channel.close).toHaveBeenCalledTimes(1);
  });

  it('handles a rejected pagehide close without leaving a floating rejection', async () => {
    const state = harness();
    const failed = new Error('persistence close failed');
    mocks.create.mockImplementationOnce((options: LocalPersistenceAdapterOptions) => {
      const resource = persistence(options);
      resource.close.mockRejectedValue(failed);
      return resource;
    });
    const session = state.session();
    await session.writer.initialize();
    const reported = deferred();
    const report = vi.spyOn(console, 'error').mockImplementation(() => reported.resolve());
    try {
      session.pagehide();
      await reported.promise;
      expect(report).toHaveBeenCalledWith(
        'Board writer session cleanup or transition failed.',
        failed,
      );
      expect(state.held()).toBe(false);
      expect(session.channel.close).toHaveBeenCalledTimes(1);
      await expect(session.writer.close()).rejects.toBe(failed);
    } finally {
      report.mockRestore();
    }
  });
});
