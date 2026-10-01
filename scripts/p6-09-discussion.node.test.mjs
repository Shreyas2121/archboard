import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { DiscussionModeration } from '../apps/web/src/features/editor/discussion/discussion-moderation-state.ts';
import {
  canModerateComment,
  discussionWriteAllowed,
  canRestartInspectedCreation,
  anchorDraftKey,
  definitiveCreationRejection,
  creationFailureUncertain,
} from '../apps/web/src/features/editor/discussion/discussion-model.ts';
import * as contracts from '../packages/contracts/dist/index.js';

const boardId = '00000000-0000-4000-8000-000000000001';
const threadId = '00000000-0000-4000-8000-000000000002';
const commentId = '00000000-0000-4000-8000-000000000003';
const otherId = '00000000-0000-4000-8000-000000000004';
const author = { id: 'editor-a', name: 'Synthetic author', image: null };
const comment = {
  id: commentId,
  threadId,
  author,
  body: 'Synthetic original',
  version: 1,
  createdAt: '2026-10-01T00:00:00Z',
  editedAt: null,
  deletedAt: null,
};
const thread = {
  id: threadId,
  boardId,
  anchor: { type: 'point', position: { x: 12, y: 24 } },
  resolvedAt: null,
  resolvedBy: null,
  version: 1,
  createdBy: author,
  createdAt: comment.createdAt,
};
const authority = {
  accountMatches: true,
  authenticated: true,
  online: true,
  fresh: true,
  denied: false,
  archived: false,
  role: 'editor',
  accountId: author.id,
  ownerId: 'owner-a',
};
const conflict = () =>
  Object.assign(new Error('Synthetic version conflict'), { code: 'VERSION_CONFLICT' });
const edit = (body = 'Synthetic unsent edit') => ({ kind: 'edit', resource: comment, body });
function harness(overrides = {}) {
  const calls = [];
  let row = comment;
  let current = true;
  let access = authority;
  let commits = 0;
  const ports = {
    isCurrent: () => current,
    authorize: async (action) => {
      if (
        !current ||
        !(action.kind === 'resolve'
          ? discussionWriteAllowed(access)
          : canModerateComment(access, action.resource))
      )
        throw new Error('Synthetic unavailable authority');
    },
    send: async (action) => {
      calls.push(action);
      if (action.resource.version !== row.version) throw conflict();
      row = {
        ...row,
        body: action.body,
        version: row.version + 1,
        editedAt: '2026-10-01T01:00:00Z',
      };
      return { kind: 'comment', value: row };
    },
    read: async () => {
      if (!current) throw new Error('Unavailable');
      return { kind: 'comment', value: row };
    },
    committed: async () => {
      commits += 1;
    },
    failed: () => {},
    isConflict: (cause) => cause.code === 'VERSION_CONFLICT',
    ...overrides,
  };
  return {
    controller: new DiscussionModeration(ports),
    calls,
    setRow: (value) => {
      row = value;
    },
    row: () => row,
    commits: () => commits,
    setCurrent: (value) => {
      current = value;
    },
    setAccess: (value) => {
      access = value;
    },
  };
}

test('current role governs own/other moderation; deleted markers cannot be restored', () => {
  assert.equal(canModerateComment(authority, comment), true);
  assert.equal(
    canModerateComment(authority, { ...comment, author: { ...author, id: 'editor-b' } }),
    false,
  );
  assert.equal(
    canModerateComment({ ...authority, accountId: 'owner-a', role: 'owner' }, comment),
    true,
  );
  for (const patch of [
    { role: 'viewer' },
    { archived: true },
    { online: false },
    { fresh: false },
    { authenticated: false },
    { accountMatches: false },
    { denied: true },
  ])
    assert.equal(canModerateComment({ ...authority, ...patch }, comment), false);
  assert.equal(
    canModerateComment(
      { ...authority, role: 'owner' },
      { ...comment, deletedAt: comment.createdAt, body: contracts.COMMENT_DELETION_MARKER },
    ),
    false,
  );
});

test('A20 state keeps the unsent edit and original version until an explicit reviewed retry', async () => {
  const h = harness();
  h.controller.begin(edit());
  h.setRow({ ...comment, body: 'Synthetic winning update', version: 2 });
  await h.controller.submit();
  assert.equal(h.calls.length, 1);
  assert.equal(h.row().body, 'Synthetic winning update');
  const state = h.controller.getSnapshot();
  assert.equal(state.phase, 'review');
  assert.equal(state.action.body, 'Synthetic unsent edit');
  assert.equal(state.action.resource.version, 1);
  assert.equal(state.current.value.version, 2);
  assert.equal(h.commits(), 0);
  await h.controller.submit();
  assert.equal(h.calls.length, 1);
  await h.controller.retryReviewed();
  assert.equal(h.calls[1].resource.version, 2);
  assert.equal(h.calls[1].body, 'Synthetic unsent edit');
  assert.equal(h.row().version, 3);
  assert.equal(h.row().author.id, author.id);
  assert.equal(h.controller.getSnapshot().action, null);
  assert.equal(h.commits(), 1);
});

test('a second race during reviewed retry returns to review without merging newer content', async () => {
  const h = harness();
  h.controller.begin(edit());
  h.setRow({ ...comment, body: 'Synthetic winner', version: 2 });
  await h.controller.submit();
  h.setRow({ ...comment, body: 'Synthetic newer winner', version: 3 });
  await h.controller.retryReviewed();
  assert.equal(h.calls[1].resource.version, 2);
  assert.equal(h.row().body, 'Synthetic newer winner');
  assert.equal(h.controller.getSnapshot().current.value.version, 3);
  assert.equal(h.controller.getSnapshot().action.body, 'Synthetic unsent edit');
  assert.equal(h.commits(), 0);
});

test('cancel/reopen retains unsent text and its old CAS rather than silently adopting a new version', async () => {
  const h = harness();
  h.controller.begin(edit());
  h.controller.setBody('Synthetic retained typing');
  h.setRow({ ...comment, body: 'Synthetic winner', version: 2 });
  await h.controller.submit();
  h.controller.cancel();
  assert.equal(h.controller.getSnapshot().retainedEdits[0].body, 'Synthetic retained typing');
  h.controller.begin({ kind: 'edit', resource: h.row(), body: h.row().body });
  assert.equal(h.controller.getSnapshot().action.body, 'Synthetic retained typing');
  assert.equal(h.controller.getSnapshot().action.resource.version, 1);
});

test('delete/edit conflicts fetch the marker and disable resurrection even after review', async () => {
  const marker = {
    ...comment,
    body: contracts.COMMENT_DELETION_MARKER,
    deletedAt: '2026-10-01T01:00:00Z',
    version: 2,
  };
  for (const action of [edit(), { kind: 'delete', resource: comment }]) {
    const h = harness();
    h.controller.begin(action);
    h.setRow(marker);
    await h.controller.submit();
    await h.controller.retryReviewed();
    assert.equal(h.calls.length, 1);
    assert.equal(h.row().body, contracts.COMMENT_DELETION_MARKER);
    assert.equal(h.controller.getSnapshot().current.value.deletedAt, marker.deletedAt);
    assert.match(h.controller.getSnapshot().error, /cannot be edited or restored/);
  }
});

test('resolve/reopen preserves the original intent and requires reviewed thread versions', async () => {
  for (const resolved of [true, false]) {
    const calls = [];
    const current = {
      ...thread,
      version: 4,
      resolvedAt: resolved ? null : comment.createdAt,
      resolvedBy: resolved ? null : author,
    };
    const h = harness({
      send: async (action) => {
        calls.push(action);
        if (calls.length === 1) throw conflict();
        return { kind: 'thread', value: { ...current, version: 5 } };
      },
      read: async () => ({ kind: 'thread', value: current }),
    });
    h.controller.begin({ kind: 'resolve', resource: thread, resolved });
    await h.controller.submit();
    assert.equal(h.controller.getSnapshot().action.resource.version, 1);
    assert.equal(h.controller.getSnapshot().action.resolved, resolved);
    assert.equal(h.commits(), 0);
    await h.controller.retryReviewed();
    assert.equal(calls[1].resource.version, 4);
    assert.equal(calls[1].resolved, resolved);
    assert.equal(h.commits(), 1);
  }
});

test('unknown mutation outcome requires fresh review; failed reads retain the draft', async () => {
  let online = false;
  const h = harness({
    send: async () => {
      throw new Error('Synthetic lost response');
    },
    read: async () => {
      if (!online) throw new Error('Offline');
      return { kind: 'comment', value: { ...comment, version: 2 } };
    },
  });
  h.controller.begin(edit());
  await h.controller.submit();
  assert.equal(h.controller.getSnapshot().current, null);
  assert.equal(h.controller.getSnapshot().action.body, 'Synthetic unsent edit');
  await h.controller.retryReviewed();
  assert.equal(h.commits(), 0);
  online = true;
  await h.controller.review();
  assert.equal(h.controller.getSnapshot().current.value.version, 2);
  assert.equal(h.controller.getSnapshot().action.resource.version, 1);
});

test('double clicks cannot duplicate a pending mutation or announce success before response', async () => {
  let finish;
  const completion = new Promise((resolve) => {
    finish = resolve;
  });
  let sends = 0;
  const h = harness({
    send: async () => {
      sends += 1;
      await completion;
      return { kind: 'comment', value: comment };
    },
  });
  h.controller.begin(edit());
  const pending = h.controller.submit();
  await Promise.resolve();
  await h.controller.submit();
  assert.equal(sends, 1);
  assert.equal(h.controller.getSnapshot().phase, 'sending');
  assert.equal(h.commits(), 0);
  h.controller.cancel();
  assert.notEqual(h.controller.getSnapshot().action, null);
  finish();
  await pending;
  assert.equal(h.commits(), 1);
});

test('downgrade blocks submission; scope loss and disposal suppress late mutations/reads', async () => {
  const denied = harness();
  denied.controller.begin(edit());
  denied.setAccess({ ...authority, role: 'viewer' });
  await denied.controller.submit();
  assert.equal(denied.calls.length, 0);
  assert.equal(denied.controller.getSnapshot().action.body, 'Synthetic unsent edit');
  for (const disposed of [false, true]) {
    let finish;
    const completion = new Promise((resolve) => {
      finish = resolve;
    });
    const h = harness({
      send: async () => {
        await completion;
        return { kind: 'comment', value: comment };
      },
    });
    h.controller.begin(edit());
    const pending = h.controller.submit();
    await Promise.resolve();
    if (disposed) h.controller.dispose();
    else {
      h.setCurrent(false);
      h.controller.suspend();
    }
    finish();
    await pending;
    assert.equal(h.commits(), 0);
    assert.notEqual(h.controller.getSnapshot().action, null);
  }
});

test('creation expiry needs an inspection of the same exact keyed request before deliberate restart', () => {
  const request = { key: boardId, startedAt: 100 };
  assert.equal(canRestartInspectedCreation(request, 200, boardId, 200), false);
  assert.equal(canRestartInspectedCreation(request, 82_800_100, null, 82_800_100), false);
  assert.equal(canRestartInspectedCreation(request, 82_800_100, threadId, 82_800_100), false);
  assert.equal(canRestartInspectedCreation(request, 82_800_100, boardId, null), false);
  assert.equal(canRestartInspectedCreation(request, 82_800_100, boardId, 200), false);
  assert.equal(canRestartInspectedCreation(request, 82_800_100, boardId, 82_800_100), true);
  assert.equal(canRestartInspectedCreation(request, 82_800_100, boardId, 82_800_101), false);
  assert.equal(canRestartInspectedCreation(request, 99, boardId, 99), false);
  assert.equal(request.key, boardId);
});

test('idempotency conflicts never authorize replacement keys, while rejected retries retain prior uncertainty', () => {
  assert.equal(definitiveCreationRejection(409, 'IDEMPOTENCY_CONFLICT'), false);
  assert.equal(definitiveCreationRejection(400, 'VALIDATION_ERROR'), true);
  assert.equal(definitiveCreationRejection(403, 'FORBIDDEN'), true);
  assert.equal(definitiveCreationRejection(503, 'TEMPORARILY_UNAVAILABLE'), false);
  assert.equal(definitiveCreationRejection(null, null), false);
  assert.equal(
    creationFailureUncertain(false, true, definitiveCreationRejection(409, 'IDEMPOTENCY_CONFLICT')),
    true,
  );
  assert.equal(
    creationFailureUncertain(true, true, definitiveCreationRejection(403, 'FORBIDDEN')),
    true,
  );
});

async function apiWithPort(port) {
  const ts = createRequire(new URL('../package.json', import.meta.url))('typescript');
  const source = await readFile(
    new URL('../apps/web/src/features/editor/discussion/discussion-api.ts', import.meta.url),
    'utf8',
  );
  const context = vm.createContext({ URLSearchParams });
  const module = new vm.SourceTextModule(
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText,
    { context },
  );
  await module.link((specifier) => {
    const values = {
      '@archboard/contracts': contracts,
      '@/platform/api': { apiRequest: port },
      './discussion-model': { anchorDraftKey },
    }[specifier];
    assert.ok(values, `Unexpected import ${specifier}`);
    return new vm.SyntheticModule(
      Object.keys(values),
      function () {
        for (const [key, value] of Object.entries(values)) this.setExport(key, value);
      },
      { context },
    );
  });
  await module.evaluate();
  return module.namespace;
}

test('actual mutation adapters send original versions, strict DELETE bodies, and retain authorship', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const api = await apiWithPort(async (path, schema, options) => {
    calls.push({ path, options });
    return { data: path.includes('/comments/') ? comment : thread };
  });
  await api.mutateDiscussion(boardId, edit(), signal);
  await api.mutateDiscussion(boardId, { kind: 'delete', resource: comment }, signal);
  await api.mutateDiscussion(
    boardId,
    { kind: 'resolve', resource: thread, resolved: true },
    signal,
  );
  assert.equal(calls[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].options.body)), {
    body: 'Synthetic unsent edit',
    expectedVersion: 1,
  });
  assert.equal(calls[1].options.method, 'DELETE');
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].options.body)), { expectedVersion: 1 });
  assert.equal(calls[2].options.body.expectedVersion, 1);
  assert.equal(calls[2].options.body.resolved, true);
  assert.equal(calls[0].options.headers, undefined);
  assert.equal(calls[1].options.signal, signal);
  const wrong = await apiWithPort(async () => ({
    data: { ...comment, author: { ...author, id: 'owner-a' } },
  }));
  await assert.rejects(
    wrong.mutateDiscussion(boardId, edit(), signal),
    /different message or author/,
  );
});

test('current resource review traverses later pages and threads across resolution filters', async () => {
  const calls = [];
  const cursor = contracts.encodePageCursor(comment.createdAt, otherId);
  const api = await apiWithPort(async (path) => {
    calls.push(path);
    const url = new URL(path, 'https://example.test');
    const later = url.searchParams.has('cursor');
    assert.equal(url.searchParams.has('resolved'), false);
    return {
      data: later ? [path.includes('/comments?') ? comment : thread] : [],
      nextCursor: later ? null : cursor,
    };
  });
  assert.equal(
    (await api.readCurrentTarget(boardId, edit(), new AbortController().signal)).value.id,
    commentId,
  );
  assert.equal(
    (
      await api.readCurrentTarget(
        boardId,
        { kind: 'resolve', resource: thread, resolved: true },
        new AbortController().signal,
      )
    ).value.id,
    threadId,
  );
  assert.equal(calls.length, 4);
});

test('creation reconciliation scans actual relevant pages, ignores other actors/deleted text, and sends no POST', async () => {
  const calls = [];
  const cursor = contracts.encodePageCursor(comment.createdAt, otherId);
  const api = await apiWithPort(async (path, schema, options) => {
    calls.push(path);
    assert.equal(options.method, undefined);
    const later = new URL(path, 'https://example.test').searchParams.has('cursor');
    return {
      data: later
        ? [
            comment,
            { ...comment, id: otherId, author: { ...author, id: 'editor-b' } },
            { ...comment, id: boardId, deletedAt: comment.createdAt },
          ]
        : [],
      nextCursor: later ? null : cursor,
    };
  });
  const request = {
    key: boardId,
    startedAt: 0,
    operation: { kind: 'reply', threadId, input: { body: comment.body } },
  };
  const matches = await api.inspectCreation(
    boardId,
    request,
    author.id,
    new AbortController().signal,
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, commentId);
  assert.equal(calls.length, 2);
});

test('thread creation inspection uses original object identity and the first message, not latest replies', async () => {
  const calls = [];
  const anchor = {
    type: 'node',
    id: otherId,
    label: 'Synthetic client label',
    position: { x: 1, y: 2 },
  };
  const api = await apiWithPort(async (path, schema, options) => {
    calls.push(path);
    assert.equal(options.method, undefined);
    if (!path.includes('/comments?'))
      return {
        data: [
          {
            ...thread,
            anchor: { ...anchor, label: 'Synthetic server label', position: { x: 300, y: 400 } },
          },
          { ...thread, id: otherId, anchor: { ...anchor, id: boardId } },
        ],
        nextCursor: null,
      };
    return { data: [comment, { ...comment, id: otherId }], nextCursor: null };
  });
  const matches = await api.inspectCreation(
    boardId,
    {
      key: boardId,
      startedAt: 0,
      operation: { kind: 'thread', input: { anchor, body: comment.body } },
    },
    author.id,
    new AbortController().signal,
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, commentId);
  assert.equal(calls.length, 2);
  assert.ok(!calls[0].includes('resolved='));
});
