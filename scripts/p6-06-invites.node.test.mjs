import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readInBoardScope } from '../apps/web/src/features/boards/board-request-lifecycle.ts';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { canManageInvites } from '../apps/web/src/features/boards/board-sharing-policy.ts';
import { canReconcileInvite } from '../apps/web/src/features/boards/invite-request.ts';
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
const scope = {
  deploymentOrigin: 'https://example.test',
  accountId: 'owner-a',
  boardId: 'board-a',
};
const metadata = {
  id: '00000000-0000-4000-8000-000000000001',
  role: 'viewer',
  createdBy: { id: 'owner-a', name: 'Synthetic owner', image: null },
  createdAt: '2026-10-01T00:00:00Z',
  expiresAt: '2026-10-08T00:00:00Z',
  status: 'active',
};
const fresh = {
  ...metadata,
  inviteUrl: 'https://example.test/invite/synthetic',
  inviteUrlAvailable: true,
};
const requireRoot = createRequire(new URL('../package.json', import.meta.url));
const ts = requireRoot('typescript');

async function loadModule(path, exports, globals = {}) {
  const context = vm.createContext({ URL, URLSearchParams, ...globals });
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { context },
  );
  await module.link((specifier) => {
    const values = exports[specifier];
    assert.ok(values, `Unexpected dependency ${specifier}`);
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

test('invite authority requires a verified active owner and blocks every unavailable state', () => {
  assert.equal(canManageInvites(authority), true);
  for (const patch of [
    { role: 'editor' },
    { role: 'viewer' },
    { accountId: 'forged' },
    { accountMatches: false },
    { authenticated: false },
    { online: false },
    { denied: true },
    { fresh: false },
    { archived: true },
  ])
    assert.equal(canManageInvites({ ...authority, ...patch }), false);
});

test('reconciliation stops before key expiry and rejects backwards clock changes', () => {
  const request = { key: 'synthetic-key', input: { role: 'viewer' }, startedAt: 1000 };
  assert.equal(canReconcileInvite(request, 1000), true);
  assert.equal(canReconcileInvite(request, 1000 + 23 * 60 * 60 * 1000 - 1), true);
  assert.equal(canReconcileInvite(request, 1000 + 23 * 60 * 60 * 1000), false);
  assert.equal(canReconcileInvite(request, 999), false);
});

test('actual invite adapter validates safe paginated metadata, role and keyed POST; revoke is 204', async () => {
  const requests = [];
  const replies = [{ data: [metadata], nextCursor: null }, { data: fresh }, undefined];
  const { z } = createRequire(new URL('../apps/web/package.json', import.meta.url))('zod');
  const api = await loadModule('../apps/web/src/features/boards/board-invites-api.ts', {
    '@archboard/contracts': contracts,
    zod: { z },
    '@/platform/api': {
      apiRequest: async (path, schema, options) => {
        requests.push({ path, ...options });
        return schema.parse(replies.shift());
      },
    },
  });
  const signal = new AbortController().signal;
  await api.readInvites('board-a', null, signal);
  assert.equal(requests[0].path, '/boards/board-a/invites?limit=30');
  const cursor = contracts.encodePageCursor(metadata.createdAt, metadata.id);
  replies.unshift({ data: [], nextCursor: null });
  await api.readInvites('board-a', cursor, signal);
  assert.equal(
    new URL(requests[1].path, scope.deploymentOrigin).searchParams.get('cursor'),
    cursor,
  );
  await api.createInvite('board-a', { role: 'viewer' }, 'key-a', signal);
  assert.equal(requests[2].method, 'POST');
  assert.equal(requests[2].headers['Idempotency-Key'], 'key-a');
  assert.deepEqual(requests[2].body, { role: 'viewer' });
  await api.revokeInvite('board-a', 'invite/a', signal);
  assert.equal(requests[3].method, 'DELETE');
  assert.equal(requests[3].path, '/boards/board-a/invites/invite%2Fa');
  assert.equal(requests[3].signal, signal);
  await assert.rejects(api.createInvite('board-a', { role: 'owner' }, 'key-a', signal));
  assert.equal(requests.length, 4);
  assert.equal(
    contracts.boardInviteListResponseSchema.safeParse({ data: [fresh], nextCursor: null }).success,
    false,
  );
  assert.equal(
    contracts.boardInviteListResponseSchema.safeParse({
      data: [{ ...metadata, tokenHash: 'forged' }],
      nextCursor: null,
    }).success,
    false,
  );
});

// Run the actual hook operations with state/query/clipboard ports; no React renderer,
// browser, database or network. This does not establish rendered acceptance.
async function hookHarness() {
  const slots = [];
  const effects = [];
  const cleanups = [];
  let index = 0;
  const calls = [];
  const replies = [];
  const sharing = {
    authority: { ...authority },
    accountMatches: true,
    authenticated: true,
    online: true,
    busyMember: null,
    isCurrent: () => sharing.accountMatches && !sharing.authority.denied,
    canRead: () => sharing.isCurrent() && sharing.authenticated && sharing.online,
    refresh: async () => {
      calls.push(['authority']);
    },
    assertInviteAllowed: () => {
      if (!canManageInvites(sharing.authority)) throw new Error('Owner access unavailable');
    },
  };
  const client = {
    cancelQueries: async (value) => {
      calls.push(['cancel', value]);
    },
    removeQueries: (value) => {
      calls.push(['remove', value]);
    },
    invalidateQueries: async (value) => {
      calls.push(['invalidate', value]);
    },
  };
  const clipboard = {
    writeText: async () => {
      throw new Error('Denied');
    },
  };
  class ApiClientError extends Error {
    constructor(kind, status = null) {
      super('Synthetic failure');
      this.kind = kind;
      this.status = status;
    }
  }
  const hooks = await loadModule(
    '../apps/web/src/features/boards/use-board-invites.ts',
    {
      './board-request-lifecycle': { readInBoardScope },
      react: {
        useState: (initial) => {
          const at = index++;
          if (!(at in slots)) slots[at] = initial;
          return [
            slots[at],
            (value) => {
              slots[at] = typeof value === 'function' ? value(slots[at]) : value;
            },
          ];
        },
        useRef: (initial) => {
          const at = index++;
          if (!(at in slots)) slots[at] = { current: initial };
          return slots[at];
        },
        useEffect: (effect, deps) => {
          const at = index++;
          if (!slots[at] || deps.some((value, i) => value !== slots[at][i])) {
            slots[at] = deps;
            effects.push(() => {
              cleanups[at]?.();
              cleanups[at] = effect();
            });
          }
        },
      },
      '@tanstack/react-query': {
        useQueryClient: () => client,
        useInfiniteQuery: (options) => {
          calls.push(['query', options]);
          return {
            refetch: async () => {
              calls.push(['list']);
              return { data: { pages: [{ data: [metadata], nextCursor: null }] } };
            },
          };
        },
      },
      '@/platform/api': { ApiClientError },
      './board-invites-api': {
        readInvites: async () => ({ data: [metadata], nextCursor: null }),
        createInvite: async (...args) => {
          calls.push(['create', ...args]);
          const reply = replies.shift();
          if (typeof reply === 'function') return reply();
          if (reply instanceof Error) throw reply;
          return reply;
        },
        revokeInvite: async (...args) => {
          calls.push(['revoke', ...args]);
        },
      },
      './board-resource-refresh': {
        boardResourceQueryKey: (scope, resource) => [
          'board-resources',
          scope.deploymentOrigin,
          scope.accountId,
          scope.boardId,
          resource,
        ],
      },
      './board-sharing-policy': { canManageInvites },
      './invite-request': { canReconcileInvite },
    },
    {
      AbortController,
      crypto: { randomUUID: () => 'fixed-operation-key' },
      navigator: { onLine: true, clipboard },
    },
  );
  function render(open = true) {
    index = 0;
    const result = hooks.useBoardInvites(scope, sharing, open);
    effects.splice(0).forEach((effect) => effect());
    return result;
  }
  return {
    render,
    calls,
    replies,
    sharing,
    ApiClientError,
    dispose: () => cleanups.forEach((cleanup) => cleanup?.()),
  };
}

test('uncertain creation survives dialog close; explicit reconciliation retains role/key and refreshes without caching links', async () => {
  const h = await hookHarness();
  h.replies.push(new h.ApiClientError('network'));
  await h.render().create('editor');
  assert.ok(h.render().uncertain);
  h.render(false);
  const state = h.render();
  await state.create('viewer');
  assert.equal(h.calls.filter(([kind]) => kind === 'create').length, 1);
  h.replies.push({ ...metadata, role: 'editor', inviteUrl: null, inviteUrlAvailable: false });
  await h.render().reconcile();
  const sends = h.calls.filter(([kind]) => kind === 'create');
  assert.equal(sends.length, 2);
  assert.equal(sends[0][3], sends[1][3]);
  assert.deepEqual(sends[0][2], sends[1][2]);
  assert.equal(h.render().uncertain, null);
  assert.equal(h.render().fresh.inviteUrl, null);
  assert.match(h.render().notice, /cannot be shown again/);
  assert.ok(h.calls.some(([kind]) => kind === 'list'));
  assert.equal(
    JSON.stringify(h.calls.filter(([kind]) => ['query', 'invalidate'].includes(kind))).includes(
      'inviteUrl',
    ),
    false,
  );
});

test('clipboard failure retains fresh link for manual copy; closing removes it; revocation clears it', async () => {
  const h = await hookHarness();
  h.replies.push(fresh);
  await h.render().create('viewer');
  await h.render().copy();
  assert.equal(h.render().fresh.inviteUrl, fresh.inviteUrl);
  assert.match(h.render().error, /copy it manually/);
  await h.render().revoke(metadata.id);
  assert.equal(h.render().fresh, null);
  assert.match(h.render().notice, /revoked/);
  h.replies.push(fresh);
  await h.render().create('viewer');
  h.render(false);
  assert.equal(h.render().fresh, null);
});

test('server and malformed-response failures retain the request; definitive rejection clears it', async () => {
  for (const [kind, status, retained] of [
    ['http', 503, true],
    ['invalid-response', 201, true],
    ['http', 403, false],
  ]) {
    const h = await hookHarness();
    h.replies.push(new h.ApiClientError(kind, status));
    await h.render().create('viewer');
    assert.equal(h.render().uncertain !== null, retained);
    assert.equal(h.render().fresh, null);
    assert.equal(h.calls.filter(([call]) => call === 'create').length, 1);
  }
});

test('a committed create keeps the fresh result when refresh fails and blocks concurrent submission', async () => {
  const h = await hookHarness();
  let resolve;
  let started;
  const sent = new Promise((done) => {
    started = done;
  });
  h.replies.push(
    () =>
      new Promise((done) => {
        resolve = done;
        started();
      }),
  );
  const pending = h.render().create('viewer');
  await sent;
  await h.render().create('editor');
  assert.equal(h.calls.filter(([kind]) => kind === 'create').length, 1);
  h.sharing.refresh = async () => {
    throw new Error('Read unavailable');
  };
  resolve(fresh);
  await pending;
  assert.equal(h.render().fresh.inviteUrl, fresh.inviteUrl);
  assert.equal(h.render().uncertain, null);
  assert.match(h.render().error, /committed.*could not refresh/);
});

test('preflight denies stale authority and late old-account or disposed responses cannot display links', async () => {
  const denied = await hookHarness();
  denied.sharing.authority.archived = true;
  await denied.render().create('viewer');
  assert.equal(
    denied.calls.some(([kind]) => kind === 'create'),
    false,
  );
  for (const dispose of [false, true]) {
    const h = await hookHarness();
    let resolve;
    let started;
    const sent = new Promise((done) => {
      started = done;
    });
    h.replies.push(
      () =>
        new Promise((done) => {
          resolve = done;
          started();
        }),
    );
    const pending = h.render().create('viewer');
    await sent;
    if (dispose) h.dispose();
    else {
      h.sharing.accountMatches = false;
      h.sharing.authority.accountMatches = false;
      h.render();
    }
    resolve(fresh);
    await pending;
    assert.equal(h.render().fresh, null);
  }
});
