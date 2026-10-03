import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as contracts from '../packages/contracts/dist/index.js';
import {
  BoardResourceRefresh,
  boardResourceQueryKey,
  boardListQueryKey,
} from '../apps/web/src/features/boards/board-resource-refresh.ts';
import { readInBoardScope } from '../apps/web/src/features/boards/board-request-lifecycle.ts';

const ts = createRequire(new URL('../package.json', import.meta.url))('typescript');
const { QueryClient } = createRequire(new URL('../apps/web/package.json', import.meta.url))(
  '@tanstack/react-query',
);
const token = `${'A'.repeat(42)}A`; // Synthetic canonical fixture, never an issued token.
const preview = {
  boardTitle: 'Synthetic board',
  inviterName: 'Synthetic owner',
  role: 'viewer',
  expiresAt: '2099-01-01T00:00:00Z',
};
const accepted = { boardId: '00000000-0000-4000-8000-000000000001', effectiveRole: 'viewer' };
class ApiClientError extends Error {
  constructor(kind, code = null, status = null) {
    super('Synthetic API failure');
    this.kind = kind;
    this.code = code;
    this.status = status;
  }
}
async function load(path, imports = {}, globals = {}) {
  const context = vm.createContext({ URL, AbortController, AbortSignal, ...globals });
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { context },
  );
  await module.link((specifier) => {
    const values = imports[specifier];
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
const { InviteAcceptanceFlow } = await load('../apps/web/src/features/boards/invite-acceptance.ts');
const { inviteFailure } = await load('../apps/web/src/features/boards/invite-failure.ts', {
  '@archboard/contracts': contracts,
  '@/platform/api': { ApiClientError },
});
const { safeReturnPath } = await load('../apps/web/src/features/auth/return-path.ts', {
  '@archboard/contracts': contracts,
});
function harness(overrides = {}) {
  const calls = [];
  const state = {
    authenticated: true,
    current: true,
    previewError: null,
    acceptError: null,
    openError: null,
  };
  const flow = new InviteAcceptanceFlow({
    current: () => state.current,
    authenticate: async () => {
      calls.push(['authenticate']);
      return state.authenticated;
    },
    preview: async () => {
      calls.push(['preview', token]);
      if (state.previewError) throw state.previewError;
      return preview;
    },
    accept: async () => {
      calls.push(['accept', token]);
      if (state.acceptError) throw state.acceptError;
      return accepted;
    },
    failure: inviteFailure,
    alreadyMember: () => false,
    openBoard: async (result) => {
      calls.push(['open', result]);
      if (state.openError) throw state.openError;
    },
    ...overrides,
  });
  return { flow, calls, state };
}

test('safe continuation accepts canonical app paths and rejects open redirects, encoding tricks and extra fields', () => {
  assert.equal(safeReturnPath('/boards'), '/boards');
  assert.equal(safeReturnPath(`/invite/${token}`), `/invite/${token}`);
  for (const value of [
    null,
    {},
    '//evil.test',
    'https://evil.test/boards',
    '/boards/../invite/x',
    `/invite/${token}?next=https://evil.test`,
    `/invite/${token}#fragment`,
    `/invite/${token}/`,
    `/invite/%41${token.slice(1)}`,
    '/invite/short',
    '/invite/../boards',
    `/invite/${token.slice(0, -1)}B`,
  ])
    assert.equal(safeReturnPath(value), null);
});

test('actual social sign-in uses a same-origin callback and performs no call for invalid continuation', async () => {
  const calls = [];
  const { startSocialSignIn } = await load(
    '../apps/web/src/features/auth/social-sign-in.ts',
    {
      './return-path': { safeReturnPath },
      './auth-client': {
        authClient: {
          signIn: {
            social: async (value) => {
              calls.push(value);
              return {};
            },
          },
        },
      },
    },
    { window: { location: { origin: 'https://example.test' } } },
  );
  assert.equal(await startSocialSignIn('https://evil.test'), false);
  assert.equal(calls.length, 0);
  assert.equal(await startSocialSignIn(`/invite/${token}`), true);
  assert.equal(calls[0].provider, 'github');
  assert.equal(calls[0].callbackURL, `https://example.test/invite/${token}`);
});

test('loading verifies the actor, exposes only preview and never accepts automatically', async () => {
  const h = harness();
  await h.flow.accept();
  assert.equal(h.calls.length, 0);
  await h.flow.load();
  assert.equal(h.flow.getSnapshot().stage, 'ready');
  assert.ok(h.flow.getSnapshot().previewFetchedAt > 0);
  assert.deepEqual(h.flow.getSnapshot().preview, preview);
  assert.equal(
    h.calls.some(([kind]) => kind === 'accept'),
    false,
  );
  const signedOut = harness();
  signedOut.state.authenticated = false;
  await signedOut.flow.load();
  assert.equal(signedOut.flow.getSnapshot().stage, 'session-expired');
  assert.equal(signedOut.flow.getSnapshot().preview, null);
  assert.equal(
    signedOut.calls.some(([kind]) => kind === 'preview'),
    false,
  );
});

test('definitive preview errors remain distinct from connection/server/invalid-response failures', async () => {
  for (const [code, stage] of [
    ['INVITE_EXPIRED', 'expired'],
    ['INVITE_UNAVAILABLE', 'unavailable'],
    ['INVITE_EXHAUSTED', 'exhausted'],
    ['BOARD_ARCHIVED', 'archived'],
  ]) {
    const h = harness();
    h.state.previewError = new ApiClientError('http', code);
    await h.flow.load();
    assert.equal(h.flow.getSnapshot().stage, stage);
    assert.equal(h.flow.getSnapshot().preview, null);
  }
  for (const kind of ['network', 'invalid-response'])
    assert.equal(inviteFailure(new ApiClientError(kind)), 'network');
  assert.equal(inviteFailure(new ApiClientError('http', null, 503)), 'network');
  assert.equal(inviteFailure(new ApiClientError('unauthenticated')), 'session-expired');
});

test('explicit acceptance rechecks session and surfaces revoke/expiry after preview without opening a board', async () => {
  for (const [code, stage] of [
    ['INVITE_EXPIRED', 'expired'],
    ['INVITE_UNAVAILABLE', 'unavailable'],
    ['INVITE_EXHAUSTED', 'exhausted'],
  ]) {
    const h = harness();
    await h.flow.load();
    h.state.acceptError = new ApiClientError('http', code);
    await h.flow.accept();
    assert.equal(h.flow.getSnapshot().stage, stage);
    assert.equal(h.calls.filter(([kind]) => kind === 'authenticate').length, 2);
    assert.equal(
      h.calls.some(([kind]) => kind === 'open'),
      false,
    );
  }
  const h = harness();
  await h.flow.load();
  h.state.authenticated = false;
  await h.flow.accept();
  assert.equal(h.flow.getSnapshot().stage, 'session-expired');
  assert.equal(h.flow.getSnapshot().preview, null);
  assert.equal(
    h.calls.some(([kind]) => kind === 'accept'),
    false,
  );
});

test('uncertain acceptance preserves explicit recovery with the same token; reconnect only loads reads', async () => {
  const h = harness();
  await h.flow.load();
  h.state.acceptError = new ApiClientError('network');
  await h.flow.accept();
  assert.equal(h.flow.getSnapshot().stage, 'uncertain');
  await h.flow.load();
  assert.equal(h.calls.filter(([kind]) => kind === 'accept').length, 1);
  h.state.acceptError = null;
  await h.flow.accept();
  assert.equal(h.flow.getSnapshot().stage, 'accepted');
  assert.equal(h.calls.filter(([kind]) => kind === 'accept').length, 2);
  assert.equal(
    h.calls.filter(([kind]) => kind === 'accept').every(([, submitted]) => submitted === token),
    true,
  );
  assert.equal(JSON.stringify(h.flow.getSnapshot()).includes(token), false);
});

test('exhausted preview allows recorded-user confirmation only after explicit action', async () => {
  const h = harness();
  h.state.previewError = new ApiClientError('http', 'INVITE_EXHAUSTED');
  await h.flow.load();
  assert.equal(
    h.calls.some(([kind]) => kind === 'accept'),
    false,
  );
  await h.flow.accept();
  assert.equal(h.flow.getSnapshot().stage, 'accepted');
});

test('committed acceptance retains the result after refresh failure; opening retry never repeats acceptance', async () => {
  const h = harness({ alreadyMember: () => true });
  await h.flow.load();
  h.state.openError = new Error('Refresh failed');
  await h.flow.accept();
  assert.equal(h.flow.getSnapshot().stage, 'already-member');
  assert.equal(h.flow.getSnapshot().refreshFailed, true);
  assert.equal(h.flow.getSnapshot().opening, false);
  h.state.openError = null;
  await h.flow.openBoard();
  assert.equal(h.flow.getSnapshot().opening, false);
  assert.equal(h.flow.getSnapshot().refreshFailed, false);
  assert.equal(h.calls.filter(([kind]) => kind === 'accept').length, 1);
  assert.equal(h.calls.filter(([kind]) => kind === 'open').length, 2);
});

test('late responses after account change or disposal never reveal preview or navigate', async () => {
  for (const operation of ['preview', 'accept']) {
    for (const dispose of [true, false]) {
      let resolve;
      const pendingResult = new Promise((done) => {
        resolve = done;
      });
      let started;
      const sent = new Promise((done) => {
        started = done;
      });
      const h = harness({
        [operation]: async () => {
          started();
          return pendingResult;
        },
      });
      if (operation === 'accept') await h.flow.load();
      const pending = operation === 'accept' ? h.flow.accept() : h.flow.load();
      await sent;
      if (dispose) h.flow.dispose();
      else h.state.current = false;
      resolve(operation === 'accept' ? accepted : preview);
      await pending;
      assert.equal(h.flow.getSnapshot().result, null);
      assert.notEqual(h.flow.getSnapshot().stage, 'ready');
      assert.equal(
        h.calls.some(([kind]) => kind === 'open'),
        false,
      );
    }
  }
});

test('offline abort after submission is uncertain and concurrent acceptance never submits twice', async () => {
  let started;
  const sent = new Promise((done) => {
    started = done;
  });
  let sends = 0;
  const h = harness({
    accept: (signal) =>
      new Promise((resolve, reject) => {
        sends++;
        started();
        signal.addEventListener('abort', () => reject(new ApiClientError('network')), {
          once: true,
        });
      }),
  });
  await h.flow.load();
  const pending = h.flow.accept();
  await sent;
  await h.flow.accept();
  assert.equal(sends, 1);
  h.flow.cancelForOffline();
  await pending;
  assert.equal(h.flow.getSnapshot().stage, 'uncertain');
  await h.flow.load();
  assert.equal(sends, 1);
});

test('actual recipient adapter POSTs token in body, validates minimal responses and rejects forged fields', async () => {
  const calls = [];
  const replies = [
    { data: preview },
    { data: accepted },
    { data: { ...preview, boardId: accepted.boardId } },
  ];
  const api = await load('../apps/web/src/features/boards/invite-recipient-api.ts', {
    '@archboard/contracts': contracts,
    '@/platform/api': {
      apiRequest: async (path, schema, options) => {
        calls.push({ path, ...options });
        return schema.parse(replies.shift());
      },
    },
  });
  const signal = new AbortController().signal;
  assert.deepEqual(await api.previewInvite(token, signal), preview);
  assert.deepEqual(await api.acceptInvite(token, signal), accepted);
  for (const call of calls) {
    assert.equal(call.method, 'POST');
    assert.equal(call.signal, signal);
    assert.equal(call.path.includes(token), false);
    assert.deepEqual(call.body, { token });
  }
  await assert.rejects(api.previewInvite(token, signal));
  await assert.rejects(api.acceptInvite('malformed', signal));
  assert.equal(calls.length, 3);
});

test('actual accepted-board refresh invalidates relational resources and fetches current metadata/list without a socket', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const scope = {
    deploymentOrigin: 'https://example.test',
    accountId: 'actor-a',
    boardId: accepted.boardId,
  };
  const calls = [];
  const board = { id: accepted.boardId, effectiveRole: 'editor' };
  const { refreshAcceptedBoard } = await load(
    '../apps/web/src/features/boards/refresh-accepted-board.ts',
    {
      './board-request-lifecycle': { readInBoardScope },
      './board-resource-refresh': {
        BoardResourceRefresh,
        boardResourceQueryKey,
        boardListQueryKey,
      },
      './board-api': {
        readBoard: async (id, signal) => {
          calls.push(['metadata', id, signal]);
          return board;
        },
        listBoards: async (search, archived, cursor, signal) => {
          calls.push(['list', search, archived, cursor, signal]);
          return { data: [board], nextCursor: null };
        },
      },
    },
  );
  client.setQueryData(boardResourceQueryKey(scope, 'members'), [{ id: 'old-member' }]);
  const signal = new AbortController().signal;
  await refreshAcceptedBoard(client, scope, signal, () => true);
  assert.equal(client.getQueryData(boardResourceQueryKey(scope, 'metadata')), board);
  assert.equal(client.getQueryState(boardResourceQueryKey(scope, 'members')).isInvalidated, true);
  assert.equal(calls.filter(([kind]) => kind === 'metadata').length, 1);
  assert.equal(calls.filter(([kind]) => kind === 'list').length, 1);
  assert.equal(
    client.getQueryData(boardResourceQueryKey({ ...scope, accountId: 'actor-b' }, 'metadata')),
    undefined,
  );
  await assert.rejects(refreshAcceptedBoard(client, scope, signal, () => false));
  assert.equal(calls.length, 2);
  client.clear();
});

test('source/build policy excludes invitation navigation and runtime caching, sets early referrer policy and safe diagnostics', async () => {
  const [html, config, hosting, router, runtime] = await Promise.all(
    [
      '../apps/web/index.html',
      '../apps/web/vite.config.ts',
      '../apps/web/vercel.json',
      '../apps/web/src/app/router.tsx',
      '../apps/api/src/modules/auth/infrastructure/better-auth.runtime.ts',
    ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')),
  );
  assert.ok(html.indexOf('name="referrer" content="no-referrer"') < html.indexOf('<link'));
  const rules = JSON.parse(hosting);
  assert.equal(rules.headers[0].headers[0].value, 'no-referrer');
  assert.equal(rules.headers[1].source, '/invite/:path*');
  assert.equal(rules.headers[1].headers[0].value, 'no-store');
  assert.equal(
    rules.rewrites.find((rule) => rule.source === '/invite/:path*').destination,
    '/index.html',
  );
  assert.match(config, /runtimeCaching: \[\]/);
  assert.ok(config.includes('/^\\/invite(?:s)?(?:\\/|$)/'));
  assert.match(router, /getScrollRestorationKey/);
  assert.match(router, /\/invite\/:redacted/);
  assert.match(runtime, /logger: \{ log: logAuthDiagnostic \}/);
});
