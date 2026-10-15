import { randomUUID } from 'node:crypto';
import { projectContextV1Schema, type AiCreateRun } from '@archboard/contracts';
import { AiPrivateIdentity, canonicalAiJson } from './private-identity.js';
import {
  fixturePersistencePolicy,
  TEST_ACTOR,
  TEST_KEY,
} from '../infrastructure/testing/persistence-fixtures.js';
import type { AiResolvedConfiguration } from './operator-policy.js';

const OTHER_KEY = 'e'.repeat(TEST_KEY.length);
const config = () => {
  const policy = fixturePersistencePolicy();
  return { provider: 'openai' as const, profile: policy.profiles[0]!, policy };
};
const body: AiCreateRun = {
  schemaVersion: 1,
  task: 'diagram-described',
  target: { kind: 'new-board' },
  prompt: 'Design API -> queue',
  history: [
    { role: 'user', text: 'Constraint One' },
    { role: 'assistant', text: 'Constraint Two' },
  ],
};
const prepare = (
  request = body,
  resolved: AiResolvedConfiguration = config(),
  actor = TEST_ACTOR,
  secret = TEST_KEY,
) => new AiPrivateIdentity(secret).prepare(actor, randomUUID(), request, resolved).intent;

it('canonicalizes object keys while preserving arrays, exact case and whitespace', () => {
  const reordered: AiCreateRun = {
    history: body.history,
    prompt: body.prompt,
    target: body.target,
    task: body.task,
    schemaVersion: 1,
  };
  expect(prepare(reordered).fingerprint).toBe(prepare().fingerprint);
  expect(canonicalAiJson({ b: 1, a: { d: 1, c: 1 } })).toBe(
    canonicalAiJson({ a: { c: 1, d: 1 }, b: 1 }),
  );
  for (const changed of [
    { ...body, prompt: body.prompt.toLowerCase() },
    { ...body, prompt: body.prompt + ' ' },
    { ...body, history: [...body.history].reverse() },
  ])
    expect(prepare(changed).fingerprint).not.toBe(prepare().fingerprint);
});
it('includes optional diagram focus in exact reuse and receipt identity', () => {
  const context = projectContextV1Schema.parse({
    kind: 'archboard.project-context',
    schemaVersion: 1,
    project: { name: 'Project', description: 'Reviewed architecture' },
  });
  const overview = prepare({ ...body, context: { ...context, diagramFocus: 'overview' } });
  const api = prepare({ ...body, context: { ...context, diagramFocus: 'api' } });
  expect(api.fingerprint).not.toBe(overview.fingerprint);
  expect(api.requestHash).not.toBe(overview.requestHash);
});
it('separates provider routing partitions from exact private result and receipt identity', () => {
  const resolved = config();
  resolved.profile = { ...resolved.profile, promptCaching: 'openai-in-memory' };
  const identity = new AiPrivateIdentity(TEST_KEY);
  const first = identity.prepare(TEST_ACTOR, randomUUID(), body, resolved);
  const changed = identity.prepare(
    TEST_ACTOR,
    randomUUID(),
    { ...body, prompt: 'Changed private task', history: [] },
    resolved,
  );
  expect(first.request.promptCache).toBe('stable-prefix');
  expect(first.request.cachePartition).toMatch(/^[a-f0-9]{64}$/);
  expect(changed.request.cachePartition).toBe(first.request.cachePartition);
  expect(changed.intent.fingerprint).not.toBe(first.intent.fingerprint);
  expect(
    identity.prepare('other-actor', randomUUID(), body, resolved).request.cachePartition,
  ).not.toBe(first.request.cachePartition);
  expect(
    identity.prepare(
      TEST_ACTOR,
      randomUUID(),
      { ...body, target: { kind: 'board', boardId: randomUUID() } },
      resolved,
    ).request.cachePartition,
  ).not.toBe(first.request.cachePartition);
  const disabled = identity.prepare(TEST_ACTOR, randomUUID(), body, config());
  expect(disabled.request.cachePartition).toBeUndefined();
  expect(disabled.request.promptCache).toBe('disabled');
  expect(disabled.intent.requestHash).toBe(first.intent.requestHash);
  expect(disabled.intent.fingerprint).not.toBe(first.intent.fingerprint);
});
it('isolates actors, boards, new-board scope, deployments and cache secrets', () => {
  const initial = prepare();
  expect(prepare(body, config(), 'other-actor').fingerprint).not.toBe(initial.fingerprint);
  expect(
    prepare({ ...body, target: { kind: 'board', boardId: randomUUID() } }).fingerprint,
  ).not.toBe(initial.fingerprint);
  const changed = config();
  changed.policy = { ...changed.policy, deploymentNamespace: 'other-deployment' };
  expect(prepare(body, changed).fingerprint).not.toBe(initial.fingerprint);
  expect(prepare(body, config(), TEST_ACTOR, OTHER_KEY).fingerprint).not.toBe(initial.fingerprint);
});
it('includes model, prompt/schema/config versions and generation policy but keeps receipt identity stable', () => {
  const initial = prepare();
  const changed = config();
  changed.profile = { ...changed.profile, model: 'fixture-next-model' };
  changed.policy = {
    ...changed.policy,
    configurationVersion: 'next-config',
    fingerprint: 'd'.repeat(TEST_KEY.length),
  };
  const next = prepare(body, changed);
  expect(next.fingerprint).not.toBe(initial.fingerprint);
  expect(next.requestHash).toBe(initial.requestHash);
  const limits = config();
  limits.policy = { ...limits.policy, cache: { ...limits.policy.cache, ttlMs: 1 } };
  expect(prepare(body, limits).fingerprint).not.toBe(initial.fingerprint);
});
it('does not expose the secret through serialization and rejects non-JSON values', () => {
  expect(JSON.stringify(new AiPrivateIdentity(TEST_KEY))).not.toContain(TEST_KEY);
  expect(() => new AiPrivateIdentity('private-invalid-secret')).toThrow(
    'AI persistence operation failed.',
  );
  expect(() => canonicalAiJson({ secret: undefined })).toThrow();
  expect(() => canonicalAiJson(Number.NaN)).toThrow();
});
it('includes reviewed project descriptions and unsynchronized graph fields and preconditions', () => {
  const nodeId = randomUUID();
  const selected: AiCreateRun = {
    ...body,
    target: { kind: 'board', boardId: randomUUID() },
    context: projectContextV1Schema.parse({
      kind: 'archboard.project-context',
      schemaVersion: 1,
      project: { name: 'Project', description: 'Reviewed description' },
    }),
    boardContext: {
      graph: { schemaVersion: 1, nodes: [], edges: [], boundaries: [], steps: [] },
      nodeBindings: [],
      confirmedServerSequence: null,
    },
  };
  const initial = prepare(selected);
  const description = {
    ...selected,
    context: {
      ...selected.context!,
      project: { ...selected.context!.project, description: 'Changed description' },
    },
  };
  expect(prepare(description).fingerprint).not.toBe(initial.fingerprint);
  const local: AiCreateRun = {
    ...selected,
    boardContext: {
      ...selected.boardContext!,
      graph: {
        ...selected.boardContext!.graph,
        nodes: [
          {
            id: nodeId,
            kind: 'component',
            title: 'Local edit',
            color: 'blue',
            content: { category: 'service', technology: '', description: '', externalUrl: null },
            position: { x: 0, y: 0 },
            size: { width: 320, height: 180 },
          },
        ],
      },
      nodeBindings: [{ key: 'local', nodeId }],
    },
  };
  expect(prepare(local).fingerprint).not.toBe(initial.fingerprint);
  expect(
    prepare({
      ...selected,
      boardContext: { ...selected.boardContext!, confirmedServerSequence: '1' },
    }).fingerprint,
  ).not.toBe(initial.fingerprint);
});
