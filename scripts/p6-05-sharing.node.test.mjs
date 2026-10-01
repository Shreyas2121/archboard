import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  canLeaveBoard,
  canManageMember,
  sharingWriteBlocker,
} from '../apps/web/src/features/boards/board-sharing-policy.ts';
import { MemberLeave } from '../apps/web/src/features/boards/member-leave.ts';
import * as contracts from '../packages/contracts/dist/index.js';

const authority = {
  accountMatches: true,
  authenticated: true,
  online: true,
  denied: false,
  fresh: true,
  archived: false,
  role: 'owner',
  accountId: 'owner-a',
  ownerId: 'owner-a',
};
const namespace = {
  deploymentOrigin: 'https://example.test',
  userId: 'member-a',
  boardId: 'board-a',
  graphSchemaVersion: 1,
};
const pending = () => ({ namespace, pendingCount: 1, updateIds: ['update-a'] });
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(overrides = {}) {
  const calls = [];
  const graphBytes = new Uint8Array([1, 7, 9]);
  const queuedBytes = new Uint8Array([5, 4, 2]);
  const state = { allowed: true, boards: [pending()] };
  const leave = new MemberLeave({
    namespace,
    assertAllowed: () => {
      calls.push('authorize');
      if (!state.allowed) throw new Error('Access ended');
    },
    freeze: async () => {
      calls.push('freeze');
    },
    resume: () => {
      calls.push('resume');
    },
    readPending: async () => {
      calls.push('read');
      return state.boards;
    },
    download: async () => {
      calls.push('download');
    },
    remove: async () => {
      calls.push('remove');
    },
    left: () => {
      calls.push('left');
    },
    ...overrides,
  });
  return { leave, calls, state, graphBytes, queuedBytes };
}

test('only a derived owner manages nonowners; editors/viewers leave only their own membership', () => {
  assert.equal(canManageMember(authority, 'member-a'), true);
  assert.equal(canManageMember(authority, 'owner-a'), false);
  assert.equal(canLeaveBoard(authority), false);
  assert.equal(canManageMember({ ...authority, accountId: 'forged-owner' }, 'member-a'), false);
  for (const role of ['editor', 'viewer']) {
    const member = { ...authority, role, accountId: 'member-a' };
    assert.equal(canManageMember(member, 'member-b'), false);
    assert.equal(canLeaveBoard(member), true);
  }
});

test('offline, archived, expired, removed, switched-account and stale reads disable both mutation paths', () => {
  for (const patch of [
    { online: false },
    { archived: true },
    { authenticated: false },
    { denied: true },
    { accountMatches: false },
    { fresh: false },
  ]) {
    const current = { ...authority, ...patch };
    assert.equal(canManageMember(current, 'member-a'), false);
    assert.equal(canLeaveBoard({ ...current, accountId: 'member-a', role: 'viewer' }), false);
    assert.ok(sharingWriteBlocker(current));
  }
});

test('leave freezes and flushes before reading exact pending work; unrelated namespaces are excluded', async () => {
  const { leave, calls, state } = setup();
  state.boards = [
    pending(),
    { ...pending(), namespace: { ...namespace, boardId: 'other-board' } },
    { ...pending(), namespace: { ...namespace, userId: 'other-account' } },
    { ...pending(), namespace: { ...namespace, deploymentOrigin: 'https://other.test' } },
  ];
  await leave.begin();
  assert.deepEqual(calls, ['authorize', 'freeze', 'authorize', 'read', 'authorize']);
  assert.equal(leave.getSnapshot().phase, 'preserve');
  assert.deepEqual(leave.getSnapshot().boards, [pending()]);
  assert.equal(calls.includes('remove'), false);
});

test('cancel resumes the graph session, sends no removal and preserves queued bytes', async () => {
  const { leave, calls, graphBytes, queuedBytes, state } = setup();
  await leave.begin();
  leave.cancel();
  await leave.commit();
  assert.equal(leave.getSnapshot().phase, 'idle');
  assert.equal(calls.includes('resume'), true);
  assert.equal(calls.includes('remove'), false);
  assert.deepEqual(graphBytes, new Uint8Array([1, 7, 9]));
  assert.deepEqual(queuedBytes, new Uint8Array([5, 4, 2]));
  assert.deepEqual(state.boards, [pending()]);
});

test('failed recovery export retains the preservation decision and sends nothing', async () => {
  const { leave, calls, state } = setup({
    download: async () => {
      throw new Error('Export failed');
    },
  });
  await leave.begin();
  await assert.rejects(leave.download(), /Export failed/);
  assert.equal(leave.getSnapshot().phase, 'preserve');
  assert.equal(calls.includes('remove'), false);
  assert.deepEqual(state.boards, [pending()]);
  leave.cancel();
});

test('changed queued IDs block confirmed removal until the user reviews again', async () => {
  const { leave, calls, state } = setup();
  await leave.begin();
  state.boards = [{ ...pending(), updateIds: ['new-update'] }];
  await assert.rejects(leave.commit(), /Pending changes changed/);
  assert.equal(calls.includes('remove'), false);
  assert.equal(leave.getSnapshot().phase, 'preserve');
});

test('current authority is checked after the pending-work read before sending removal', async () => {
  const gate = deferred();
  let reads = 0;
  const { leave, calls, state } = setup({
    readPending: async () => {
      reads += 1;
      if (reads > 1) await gate.promise;
      return [pending()];
    },
  });
  await leave.begin();
  const committing = leave.commit();
  state.allowed = false;
  gate.resolve();
  await assert.rejects(committing, /Access ended/);
  assert.equal(calls.includes('remove'), false);
  assert.equal(leave.getSnapshot().phase, 'preserve');
});

test('confirmed retained leave submits once and ends access without deleting graph/outbox', async () => {
  const gate = deferred();
  let removals = 0;
  const { leave, calls, state, graphBytes, queuedBytes } = setup({
    remove: async () => {
      removals += 1;
      await gate.promise;
    },
  });
  await leave.begin();
  await leave.download();
  const first = leave.commit();
  await Promise.resolve();
  await leave.commit();
  leave.cancel();
  assert.equal(leave.getSnapshot().phase, 'leaving');
  gate.resolve();
  await first;
  assert.equal(removals, 1);
  assert.equal(calls.includes('left'), true);
  assert.equal(leave.getSnapshot().phase, 'left');
  assert.deepEqual(state.boards, [pending()]);
  assert.deepEqual(graphBytes, new Uint8Array([1, 7, 9]));
  assert.deepEqual(queuedBytes, new Uint8Array([5, 4, 2]));
});

test('cancel during preparation prevents late removal and releases the completed freeze', async () => {
  const gate = deferred();
  const { leave, calls } = setup({ freeze: () => gate.promise });
  const opening = leave.begin();
  leave.cancel();
  await leave.begin(); // No overlapping freeze while the cancelled one finishes.
  gate.resolve();
  await opening;
  await leave.commit();
  assert.equal(leave.getSnapshot().phase, 'idle');
  assert.equal(calls.includes('remove'), false);
  assert.equal(calls.filter((value) => value === 'resume').length, 2);
});

test('no pending work still requires explicit commit; storage inspection failure resumes safely', async () => {
  const empty = setup({ readPending: async () => [] });
  await empty.leave.begin();
  assert.equal(empty.leave.getSnapshot().phase, 'ready');
  assert.equal(empty.calls.includes('remove'), false);
  await empty.leave.commit();
  assert.equal(empty.leave.getSnapshot().phase, 'left');
  const failed = setup({
    readPending: async () => {
      throw new Error('Storage unavailable');
    },
  });
  await assert.rejects(failed.leave.begin(), /Storage unavailable/);
  assert.equal(failed.leave.getSnapshot().phase, 'idle');
  assert.equal(failed.calls.includes('resume'), true);
  assert.equal(failed.calls.includes('remove'), false);
});

test('disposing an old account prevents late preparation; a committed removal still ends its old session', async () => {
  const read = deferred();
  const old = setup({ readPending: () => read.promise });
  const opening = old.leave.begin();
  await Promise.resolve();
  old.leave.dispose();
  read.resolve([pending()]);
  await opening;
  await old.leave.commit();
  assert.equal(old.calls.includes('remove'), false);
  const removal = deferred();
  const committed = setup({ remove: () => removal.promise });
  await committed.leave.begin();
  const finishing = committed.leave.commit();
  await Promise.resolve();
  committed.leave.dispose();
  removal.resolve();
  await finishing;
  assert.equal(committed.calls.includes('left'), true);
  assert.equal(committed.calls.includes('resume'), false);
});

// Load the actual platform source in Node; substitute only config and fetch boundaries.
// No browser, HTTP server, PostgreSQL, IndexedDB, or cloud connection is involved.
async function apiHarness() {
  const requireRoot = createRequire(new URL('../package.json', import.meta.url));
  const requireWeb = createRequire(new URL('../apps/web/package.json', import.meta.url));
  const ts = requireRoot('typescript');
  const { z } = requireWeb('zod');
  const responses = [];
  const requests = [];
  const context = vm.createContext({
    URL,
    fetch: async (url, options) => {
      requests.push({ url: String(url), ...options });
      return responses.shift();
    },
  });
  const source = await readFile(
    new URL('../apps/web/src/platform/api/api-client.ts', import.meta.url),
    'utf8',
  );
  const module = new vm.SourceTextModule(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      context,
      initializeImportMeta: (meta) => {
        meta.env = {};
      },
    },
  );
  await module.link((specifier) => {
    const exports =
      specifier === '@archboard/contracts'
        ? contracts
        : { loadWebConfig: () => ({ apiOrigin: 'https://api.example.test' }) };
    return new vm.SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
      },
      { context },
    );
  });
  await module.evaluate();
  const memberSource = await readFile(
    new URL('../apps/web/src/features/boards/board-members-api.ts', import.meta.url),
    'utf8',
  );
  const memberModule = new vm.SourceTextModule(
    ts.transpileModule(memberSource, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { context },
  );
  await memberModule.link((specifier) => {
    const exports =
      specifier === '@archboard/contracts'
        ? contracts
        : specifier === 'zod'
          ? { z }
          : module.namespace;
    return new vm.SyntheticModule(
      Object.keys(exports),
      function () {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
      },
      { context },
    );
  });
  await memberModule.evaluate();
  return { api: module.namespace, memberApi: memberModule.namespace, z, responses, requests };
}

test('actual member API validates roles and responses and encodes mapped auth IDs without UUID assumptions', async () => {
  const { memberApi, responses, requests } = await apiHarness();
  const signal = new AbortController().signal;
  const userId = 'member/a ?#';
  const record = {
    user: { id: userId, name: 'Synthetic member', image: null },
    role: 'editor',
    joinedAt: '2026-10-01T00:00:00Z',
  };
  responses.push(Response.json({ data: [record], nextCursor: null }));
  assert.equal((await memberApi.readMembers('board-a', signal))[0].user.id, userId);
  responses.push(Response.json({ data: record }));
  await memberApi.changeMemberRole('board-a', userId, 'editor', signal);
  assert.equal(requests[1].method, 'PATCH');
  assert.equal(requests[1].body, JSON.stringify({ role: 'editor' }));
  assert.equal(
    requests[1].url,
    'https://api.example.test/api/v1/boards/board-a/members/member%2Fa%20%3F%23',
  );
  await assert.rejects(memberApi.changeMemberRole('board-a', userId, 'owner', signal));
  assert.equal(requests.length, 2);
  responses.push(new Response(null, { status: 204 }));
  await memberApi.removeMember('board-a', userId, signal);
  assert.equal(requests[2].method, 'DELETE');
  assert.equal(requests[2].signal, signal);
  assert.equal(requests[2].credentials, 'include');
});

test('actual API adapter accepts 204 only for the no-content contract and keeps credentials/scoped paths', async () => {
  const { api, z, responses, requests } = await apiHarness();
  responses.push(new Response(null, { status: 204 }));
  assert.equal(
    await api.apiRequest('/boards/board-a/members/member-a', z.undefined(), { method: 'DELETE' }),
    undefined,
  );
  assert.equal(requests[0].credentials, 'include');
  assert.equal(requests[0].method, 'DELETE');
  assert.equal(requests[0].url, 'https://api.example.test/api/v1/boards/board-a/members/member-a');
  responses.push(new Response(null, { status: 204 }));
  await assert.rejects(
    api.apiRequest('/boards/board-a', contracts.boardDetailResponseSchema),
    (error) => error.kind === 'invalid-response',
  );
});

test('actual API adapter retains 401/403/404 distinctions and never treats a denied removal as success', async () => {
  const { api, z, responses } = await apiHarness();
  let signedOut = 0;
  api.setUnauthorizedListener(() => {
    signedOut += 1;
  });
  responses.push(new Response(null, { status: 401 }));
  await assert.rejects(
    api.apiRequest('/boards/board-a/members/member-a', z.undefined(), { method: 'DELETE' }),
    (error) => error.kind === 'unauthenticated' && error.status === 401,
  );
  assert.equal(signedOut, 1);
  for (const [status, code] of [
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
  ]) {
    responses.push(
      Response.json(
        { error: { code, message: 'Unavailable', requestId: 'synthetic-request' } },
        { status },
      ),
    );
    await assert.rejects(
      api.apiRequest('/boards/board-a/members/member-a', z.undefined(), { method: 'DELETE' }),
      (error) => error.kind === 'http' && error.code === code && error.status === status,
    );
  }
});
