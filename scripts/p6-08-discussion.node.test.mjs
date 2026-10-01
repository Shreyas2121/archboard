import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import {
  localAnchor,
  selectedAnchor,
  anchorDraftKey,
  anchorLabel,
  discussionWriteAllowed,
  canRetryDiscussion,
  creationFailureUncertain,
} from '../apps/web/src/features/editor/discussion/discussion-model.ts';
import * as contracts from '../packages/contracts/dist/index.js';

const id = '00000000-0000-4000-8000-000000000001';
const targetId = '00000000-0000-4000-8000-000000000002';
const edgeId = '00000000-0000-4000-8000-000000000003';
const node = {
  id,
  kind: 'note',
  title: '<script>inert</script>',
  position: { x: -100, y: 20 },
  size: { width: 200, height: 100 },
  color: 'gray',
  content: { body: '' },
};
const graph = {
  schemaVersion: 1,
  nodes: [node, { ...node, id: targetId, position: { x: 400, y: -200 } }],
  edges: [{ id: edgeId, sourceId: id, targetId, label: 'Link' }],
  boundaries: [],
  steps: [],
};
const saved = { type: 'node', id, label: 'Saved label', position: { x: 12, y: 24 } };
const authority = {
  accountMatches: true,
  authenticated: true,
  online: true,
  fresh: true,
  denied: false,
  archived: false,
  role: 'editor',
};

test('selection maps node centers and edge endpoint-center midpoints without boundary anchors', () => {
  assert.deepEqual(selectedAnchor([{ kind: 'node', id }], graph), {
    type: 'node',
    id,
    label: node.title,
    position: { x: 0, y: 70 },
  });
  assert.deepEqual(selectedAnchor([{ kind: 'edge', id: edgeId }], graph), {
    type: 'edge',
    id: edgeId,
    label: 'Link',
    position: { x: 250, y: -40 },
  });
  assert.equal(selectedAnchor([{ kind: 'boundary', id }], graph), null);
  assert.equal(
    selectedAnchor(
      [
        { kind: 'node', id },
        { kind: 'node', id: targetId },
      ],
      graph,
    ),
    null,
  );
  assert.equal(selectedAnchor([{ kind: 'edge', id: edgeId }], { ...graph, nodes: [node] }), null);
});

test('deleted anchors preserve saved context and cannot invent a selectable graph object', () => {
  const deleted = { ...graph, nodes: [], edges: [] };
  assert.equal(localAnchor(saved, deleted), null);
  assert.deepEqual(saved.position, { x: 12, y: 24 });
  assert.equal(saved.label, 'Saved label');
  const point = { type: 'point', position: { x: -12, y: 24 } };
  assert.equal(localAnchor(point, null), point);
  assert.match(anchorLabel(point), /-12, 24/);
});

test('draft identity follows object ID through moves/renames and distinguishes points', () => {
  assert.equal(
    anchorDraftKey(saved),
    anchorDraftKey({ ...saved, label: 'Renamed', position: { x: 900, y: 800 } }),
  );
  assert.notEqual(anchorDraftKey(saved), anchorDraftKey({ ...saved, type: 'edge' }));
  assert.notEqual(
    anchorDraftKey({ type: 'point', position: { x: 1, y: 2 } }),
    anchorDraftKey({ type: 'point', position: { x: 2, y: 1 } }),
  );
});

test('writes require current online editing authority; unrelated graph pending state is irrelevant', () => {
  assert.equal(discussionWriteAllowed(authority), true);
  assert.equal(discussionWriteAllowed({ ...authority, role: 'owner' }), true);
  for (const patch of [
    { role: 'viewer' },
    { role: null },
    { authenticated: false },
    { accountMatches: false },
    { online: false },
    { fresh: false },
    { denied: true },
    { archived: true },
  ])
    assert.equal(discussionWriteAllowed({ ...authority, ...patch }), false);
  assert.equal(discussionWriteAllowed({ ...authority, graphPending: 20 }), true);
});

test('shared Unicode body limits and point bounds match the composer', () => {
  const input = '😀'.repeat(contracts.MAX_COMMENT_BODY_CHARACTERS);
  assert.equal(contracts.countCommentBodyCharacters(input), contracts.MAX_COMMENT_BODY_CHARACTERS);
  assert.equal(contracts.commentBodySchema.safeParse(input).success, true);
  assert.equal(contracts.commentBodySchema.safeParse(`${input}x`).success, false);
  assert.equal(contracts.commentBodySchema.safeParse(' \n\t').success, false);
  assert.equal(
    contracts.threadAnchorSchema.safeParse({ type: 'point', position: { x: Infinity, y: 0 } })
      .success,
    false,
  );
  assert.equal(
    contracts.threadAnchorSchema.safeParse({
      type: 'point',
      position: { x: contracts.MAX_GRAPH_COORDINATE + 1, y: 0 },
    }).success,
    false,
  );
});

test('retry window ends conservatively without replacing an expired key', () => {
  const request = { startedAt: 100, key: 'same-key' };
  assert.equal(canRetryDiscussion(request, 100), true);
  assert.equal(canRetryDiscussion(request, 99), false);
  assert.equal(canRetryDiscussion(request, 82_800_100), false);
  assert.equal(request.key, 'same-key');
});

test('failed retry preflight or permission denial preserves an earlier uncertain creation', () => {
  assert.equal(creationFailureUncertain(false, false, false), false);
  assert.equal(creationFailureUncertain(false, true, true), false);
  assert.equal(creationFailureUncertain(false, true, false), true);
  assert.equal(creationFailureUncertain(true, false, false), true);
  assert.equal(creationFailureUncertain(true, true, true), true);
});

async function apiWithPort(port) {
  const source = await readFile(
    new URL('../apps/web/src/features/editor/discussion/discussion-api.ts', import.meta.url),
    'utf8',
  );
  const ts = createRequire(new URL('../package.json', import.meta.url))('typescript');
  const context = vm.createContext({ URLSearchParams });
  const module = new vm.SourceTextModule(
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText,
    { context },
  );
  await module.link((specifier) => {
    const values = specifier === '@archboard/contracts' ? contracts : { apiRequest: port };
    assert.ok(['@archboard/contracts', '@/platform/api'].includes(specifier));
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

test('list adapters encode stable cursors and resolved filters; abort signal is forwarded', async () => {
  const calls = [];
  const api = await apiWithPort((path, schema, options) => {
    calls.push({ path, schema, options });
    return { data: [], nextCursor: null };
  });
  const cursor = contracts.encodePageCursor('2026-10-01T00:00:00Z', id);
  const signal = new AbortController().signal;
  await api.readThreads(id, true, cursor, signal);
  const url = new URL(calls[0].path, 'https://example.test');
  assert.equal(url.searchParams.get('resolved'), 'true');
  assert.equal(url.searchParams.get('cursor'), cursor);
  assert.equal(calls[0].schema, contracts.threadListResponseSchema);
  await api.readComments(id, targetId, null, signal);
  assert.equal(calls[1].path, `/boards/${id}/threads/${targetId}/comments?limit=30`);
  assert.equal(calls[1].options.signal, signal);
});

test('creation adapters retry the identical keyed payload and wait for a committed response', async () => {
  const calls = [];
  let succeed = false;
  const api = await apiWithPort(async (path, schema, options) => {
    calls.push({ path, schema, options });
    if (!succeed) throw new Error('Synthetic lost response');
    return {
      data: { thread: { id: targetId, boardId: id }, comment: { id: edgeId, threadId: targetId } },
    };
  });
  const request = {
    key: id,
    startedAt: Date.now(),
    operation: { kind: 'thread', input: { anchor: saved, body: '  unchanged\nplain text 😀 ' } },
  };
  const signal = new AbortController().signal;
  await assert.rejects(api.sendDiscussion(id, request, signal), /lost response/);
  succeed = true;
  const result = await api.sendDiscussion(id, request, signal);
  assert.equal(result.threadId, targetId);
  assert.equal(
    calls[0].options.headers['Idempotency-Key'],
    calls[1].options.headers['Idempotency-Key'],
  );
  assert.deepEqual(calls[0].options.body, calls[1].options.body);
  assert.equal(calls[1].options.body.body, request.operation.input.body);
  assert.equal(calls[1].options.signal, signal);
  const replyApi = await apiWithPort(async (path, schema, options) => {
    assert.equal(path, `/boards/${id}/threads/${targetId}/comments`);
    assert.equal(options.headers['Idempotency-Key'], edgeId);
    assert.equal(schema, contracts.commentResponseSchema);
    return { data: { id: edgeId, threadId: targetId } };
  });
  assert.equal(
    (
      await replyApi.sendDiscussion(
        id,
        {
          ...request,
          key: edgeId,
          operation: { kind: 'reply', threadId: targetId, input: { body: 'reply' } },
        },
        signal,
      )
    ).comment.id,
    edgeId,
  );
});

test('adapters reject mismatched board/thread responses before exposing scoped data', async () => {
  const api = await apiWithPort(async (path) => ({
    data: path.includes('/comments?') ? [{ threadId: edgeId }] : [{ boardId: edgeId }],
    nextCursor: null,
  }));
  const signal = new AbortController().signal;
  await assert.rejects(api.readThreads(id, false, null, signal), /different board/);
  await assert.rejects(api.readComments(id, targetId, null, signal), /different thread/);
  const create = await apiWithPort(async () => ({
    data: { thread: { boardId: edgeId, id: targetId }, comment: {} },
  }));
  await assert.rejects(
    create.sendDiscussion(
      id,
      {
        key: id,
        startedAt: 0,
        operation: { kind: 'thread', input: { anchor: saved, body: 'synthetic' } },
      },
      signal,
    ),
    /different board/,
  );
  const reply = await apiWithPort(async () => ({ data: { id, threadId: edgeId } }));
  await assert.rejects(
    reply.sendDiscussion(
      id,
      {
        key: id,
        startedAt: 0,
        operation: { kind: 'reply', threadId: targetId, input: { body: 'synthetic' } },
      },
      signal,
    ),
    /different thread/,
  );
});
