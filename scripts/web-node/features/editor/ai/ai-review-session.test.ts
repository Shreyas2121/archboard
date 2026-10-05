import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  aiRunSchema,
  aiCreateRunSchema,
  MAX_AI_CONTEXT_FILE_BYTES,
  MAX_AI_PROMPT_CHARACTERS,
} from '@archboard/contracts';
import { AiReviewSession } from '@/features/editor/ai/ai-review-session';
import {
  AI_RECEIPT_WINDOW_MS,
  emptyAiForm,
  contextFromForm,
  parseAiContext,
} from '@/features/editor/ai/ai-review-model';
import { ApiClientError } from '@/platform/api/api-client';
import type { AiTransport } from '@/platform/api/ai-api';
vi.mock('@/platform/config', () => ({
  loadWebConfig: () => ({ apiOrigin: 'https://api.example.test' }),
}));
const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_RATE_LIMITED = 429;
const RETRY_SECONDS = 30;
const TWO = 2;
const INVALID_UTF8 = 255;
const now = Date.parse('2026-10-04T10:00:00Z');
function run(state: 'pending' | 'ready' | 'unknown' = 'ready') {
  return aiRunSchema.parse({
    schemaVersion: 1,
    id: randomUUID(),
    task: 'diagram-described',
    state:
      state === 'pending' ? 'generating' : state === 'unknown' ? 'outcome-unknown' : 'needs-input',
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    content:
      state === 'pending'
        ? { status: 'pending' }
        : state === 'unknown'
          ? { status: 'unavailable' }
          : {
              status: 'available',
              expiresAt: new Date(now + RETRY_SECONDS).toISOString(),
              result: {
                schemaVersion: 1,
                kind: 'clarification',
                explanation: 'Private facts',
                questions: ['Which service?'],
              },
            },
    failure: state === 'unknown' ? { code: 'AI_OUTCOME_UNKNOWN' } : null,
    source: 'generation',
  });
}
function setup(authenticate: (signal: AbortSignal) => Promise<void> = async () => undefined) {
  const guard = { allowed: true, online: true, now };
  const transport = {
    availability: vi.fn<AiTransport['availability']>().mockResolvedValue({
      schemaVersion: 1,
      available: true,
      allowance: { remainingFreshRuns: TWO, remainingMicroUsd: '1000', resetsAt: null },
    }),
    create: vi.fn<AiTransport['create']>().mockResolvedValue(run()),
    read: vi.fn<AiTransport['read']>(),
    cancel: vi.fn<AiTransport['cancel']>(),
    events: vi.fn<AiTransport['events']>().mockResolvedValue(undefined),
  };
  const key = vi.fn(() => randomUUID());
  const boardId = randomUUID();
  const session = new AiReviewSession(
    boardId,
    transport,
    () => guard.allowed,
    () => guard.online,
    key,
    () => guard.now,
    authenticate,
  );
  const prepared = async () => {
    session.draft({ prompt: 'Reviewed architecture' });
    session.review();
    await session.availability();
  };
  return { session, transport, guard, key, prepared, boardId };
}
const context = () =>
  contextFromForm({
    ...emptyAiForm(),
    name: 'Reviewed project',
    description: 'Facts 🧠',
    technologies: 'TypeScript\nPostgres',
  });
const file = (text = JSON.stringify(context())) => ({
  name: 'context.json',
  size: new TextEncoder().encode(text).byteLength,
  arrayBuffer: vi.fn(async () => new TextEncoder().encode(text).buffer),
});
describe('AI reviewed inputs and session-only lifecycle', () => {
  it.each(['explain-selection', 'scoped-edit', 'presentation'] as const)(
    'requires a same-board %s review and rechecks selection/history after asynchronous authentication',
    async (task) => {
      let finishAuth!: () => void;
      const f = setup(
        () =>
          new Promise<void>((resolve) => {
            finishAuth = resolve;
          }),
      );
      const request = aiCreateRunSchema.parse({
        schemaVersion: 1,
        task,
        prompt: 'Explain my selection',
        history: [{ role: 'user', text: 'Private prior question' }],
        target: { kind: 'board', boardId: f.boardId },
        boardContext: {
          graph: { schemaVersion: 1, nodes: [], edges: [], boundaries: [], steps: [] },
          nodeBindings: [],
          confirmedServerSequence: null,
        },
      });
      f.session.reviewGuidance({ ...request, target: { kind: 'board', boardId: randomUUID() } });
      expect(f.session.snapshot().review).toBeNull();
      f.session.reviewGuidance(request);
      await f.session.availability();
      let current = true;
      const pending = f.session.generate(() => current);
      current = false;
      finishAuth();
      await pending;
      expect(f.transport.create).not.toHaveBeenCalled();
      expect(f.session.snapshot().phase).toBe('rejected');
      expect(f.session.snapshot().problem).toContain('changed');
      expect(f.session.snapshot().intent).toBeNull();
      expect(f.session.editable()).toBe(true);
      f.guard.allowed = false;
      f.session.clear();
      expect(f.session.snapshot().review).toBeNull();
      expect(f.session.snapshot().intent).toBeNull();
    },
  );
  it('requires review and positive availability; draft edits invalidate the reviewed body', async () => {
    const f = setup();
    f.session.draft({ prompt: 'A design' });
    await f.session.generate();
    expect(f.transport.create).not.toHaveBeenCalled();
    f.session.review();
    expect(f.session.canGenerate()).toBe(false);
    await f.session.availability();
    expect(f.session.canGenerate()).toBe(true);
    f.session.draft({ prompt: 'Changed facts' });
    expect(f.session.snapshot().review).toBeNull();
    expect(f.session.canGenerate()).toBe(false);
  });
  it('selection and validation are local; exactly one JSON file is included only after review', async () => {
    const f = setup();
    await f.session.file(file());
    expect(f.session.snapshot().context?.project.name).toBe('Reviewed project');
    expect(f.transport.create).not.toHaveBeenCalled();
    f.session.draft({ prompt: 'Design this project' });
    f.session.review();
    expect(f.session.snapshot().review?.context?.project.description).toBe('Facts 🧠');
    expect(f.session.snapshot().review?.boardContext).toBeUndefined();
    expect(f.session.snapshot().review?.task).toBe('propose-design');
  });
  it('bounds declared and actual file bytes before parsing and reports malformed/unsupported JSON', async () => {
    const f = setup();
    const large = file();
    large.size = MAX_AI_CONTEXT_FILE_BYTES + 1;
    await f.session.file(large);
    expect(large.arrayBuffer).not.toHaveBeenCalled();
    expect(f.session.snapshot().problem).toContain('1 MiB');
    const dishonest = file(' '.repeat(MAX_AI_CONTEXT_FILE_BYTES + 1));
    dishonest.size = 1;
    await f.session.file(dishonest);
    expect(f.session.snapshot().context).toBeNull();
    for (const text of [
      '{',
      '{"constructor":{}}',
      JSON.stringify({ ...context(), model: 'forged' }),
    ]) {
      await f.session.file(file(text));
      expect(f.session.snapshot().problem).not.toBe('');
      expect(f.session.snapshot().context).toBeNull();
    }
    expect(() => parseAiContext(new Uint8Array([INVALID_UTF8]))).toThrow();
    expect(f.transport.create).not.toHaveBeenCalled();
  });
  it('rejects duplicate logical keys, broken references and excessive prompt/request input', () => {
    const component = {
      rowId: 'row',
      key: 'api',
      name: 'API',
      category: 'service' as const,
      technology: '',
      description: '',
      evidenceKeys: [],
    };
    expect(() =>
      contextFromForm({
        ...emptyAiForm(),
        name: 'Project',
        components: [component, { ...component, rowId: 'second' }],
      }),
    ).toThrow();
    expect(() =>
      contextFromForm({
        ...emptyAiForm(),
        name: 'Project',
        connections: [
          {
            rowId: 'connection',
            source: 'missing',
            target: 'missing',
            label: '',
            protocol: '',
            evidenceKeys: [],
          },
        ],
      }),
    ).toThrow();
    const f = setup();
    f.session.draft({ prompt: 'x'.repeat(MAX_AI_PROMPT_CHARACTERS + 1) });
    f.session.review();
    expect(f.session.snapshot().review).toBeNull();
    expect(f.session.snapshot().problem).not.toBe('');
    const exported = context();
    expect(parseAiContext(new TextEncoder().encode(JSON.stringify(exported)))).toEqual(exported);
    expect(JSON.stringify(exported)).not.toContain('rowId');
  });
  it('ignores an older file read after replacement and after account/board disposal', async () => {
    const f = setup();
    let release!: (value: ArrayBuffer) => void;
    const old = f.session.file({
      ...file(),
      arrayBuffer: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    await f.session.file(
      file(
        JSON.stringify({ ...context(), project: { ...context().project, name: 'New selection' } }),
      ),
    );
    release(new TextEncoder().encode(JSON.stringify(context())).buffer);
    await old;
    expect(f.session.snapshot().context?.project.name).toBe('New selection');
    const outstanding = f.session.file({
      ...file(),
      arrayBuffer: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    });
    f.guard.allowed = false;
    f.session.dispose();
    release(new TextEncoder().encode(JSON.stringify(context())).buffer);
    await outstanding;
    expect(f.session.snapshot()).toMatchObject({
      prompt: '',
      context: null,
      review: null,
      intent: null,
      filename: '',
    });
    expect(f.session.canGenerate()).toBe(false);
  });
  it('freezes one body/key across a lost response and explicit recovery; duplicate Generate is blocked', async () => {
    const f = setup();
    await f.prepared();
    f.transport.create.mockRejectedValueOnce(new ApiClientError('network', null, null, 'Offline'));
    await f.session.generate();
    const original = f.session.snapshot().intent;
    expect(f.session.snapshot().phase).toBe('uncertain');
    f.session.draft({ prompt: 'Never replace a possibly paid request' });
    f.session.newDraft();
    await f.session.generate();
    expect(f.transport.create).toHaveBeenCalledTimes(1);
    await f.session.recover();
    expect(f.transport.create).toHaveBeenCalledTimes(TWO);
    expect(f.transport.create.mock.calls[0]?.slice(0, TWO)).toEqual(
      f.transport.create.mock.calls[1]?.slice(0, TWO),
    );
    expect(f.session.snapshot().intent).toEqual(original);
    expect(f.key).toHaveBeenCalledTimes(1);
  });
  it('a rate rejection during uncertain recovery does not establish that the original intent failed', async () => {
    const f = setup();
    await f.prepared();
    f.transport.create.mockRejectedValueOnce(
      new ApiClientError('invalid-response', null, null, 'Invalid'),
    );
    await f.session.generate();
    f.transport.create.mockRejectedValueOnce(
      new ApiClientError(
        'http',
        HTTP_RATE_LIMITED,
        'RATE_LIMITED',
        'Too many requests',
        RETRY_SECONDS,
      ),
    );
    await f.session.recover();
    expect(f.session.snapshot()).toMatchObject({
      phase: 'uncertain',
      retryAfterSeconds: RETRY_SECONDS,
    });
    expect(f.key).toHaveBeenCalledTimes(1);
    f.guard.now += AI_RECEIPT_WINDOW_MS;
    await f.session.recover();
    expect(f.transport.create).toHaveBeenCalledTimes(TWO);
    expect(f.session.canRecover()).toBe(false);
    expect(f.session.snapshot().intent).not.toBeNull();
  });
  it('a definitive first rejection can start a new reviewed intent but never auto-generates', async () => {
    const f = setup();
    await f.prepared();
    f.transport.create.mockRejectedValueOnce(
      new ApiClientError('http', HTTP_BAD_REQUEST, 'VALIDATION_ERROR', 'Invalid'),
    );
    await f.session.generate();
    expect(f.session.snapshot().phase).toBe('rejected');
    f.session.newDraft();
    expect(f.session.snapshot().intent).toBeNull();
    expect(f.transport.create).toHaveBeenCalledTimes(1);
    expect(f.session.canGenerate()).toBe(false);
  });
  it('offline pause aborts submission, retains uncertainty and never queues a new call on reconnect', async () => {
    const f = setup();
    await f.prepared();
    let release!: (value: ReturnType<typeof run>) => void;
    f.transport.create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const sending = f.session.generate();
    const intent = f.session.snapshot().intent;
    await Promise.resolve();
    f.guard.online = false;
    f.session.pause();
    expect(f.transport.create.mock.calls[0]?.[TWO].aborted).toBe(true);
    release(run());
    await sending;
    expect(f.session.snapshot()).toMatchObject({ phase: 'uncertain', run: null, intent });
    f.guard.online = true;
    await f.session.availability();
    expect(f.transport.create).toHaveBeenCalledTimes(1);
    await f.session.recover();
    expect(f.transport.create.mock.calls[1]?.[0]).toBe(intent?.key);
  });
  it('account changes discard private drafts, frozen intent and late responses even if abort is ignored', async () => {
    const f = setup();
    await f.prepared();
    let release!: (value: ReturnType<typeof run>) => void;
    f.transport.create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const sending = f.session.generate();
    await Promise.resolve();
    f.guard.allowed = false;
    f.session.dispose();
    release(run());
    await sending;
    expect(f.session.snapshot()).toMatchObject({
      prompt: '',
      intent: null,
      run: null,
      review: null,
      context: null,
    });
    expect(f.session.snapshot().form).toEqual(emptyAiForm());
  });
  it('unknown outcome and expiry preserve intent and never generate on status/cancel/reconnect', async () => {
    const f = setup();
    await f.prepared();
    const unknown = run('unknown');
    f.transport.create.mockResolvedValueOnce(unknown);
    await f.session.generate();
    const intent = f.session.snapshot().intent;
    f.session.newDraft();
    expect(f.session.snapshot().intent).toEqual(intent);
    f.transport.read.mockResolvedValueOnce(unknown);
    await f.session.refresh();
    await f.session.cancel();
    expect(f.transport.create).toHaveBeenCalledTimes(1);
    expect(f.transport.cancel).not.toHaveBeenCalled();
    const expired = setup();
    await expired.prepared();
    await expired.session.generate();
    expired.guard.now += RETRY_SECONDS;
    expired.session.expire();
    expect(expired.session.snapshot().run?.content.status).toBe('expired');
    expect(expired.session.snapshot().intent).not.toBeNull();
    expect(expired.transport.create).toHaveBeenCalledTimes(1);
  });
  it('reconnect reads the existing run, accepts repeated snapshot IDs and ignores stale terminal regression', async () => {
    const f = setup();
    await f.prepared();
    const active = run('pending');
    f.transport.create.mockResolvedValueOnce(active);
    f.transport.read.mockResolvedValue(active);
    await f.session.generate();
    const receive = f.transport.events.mock.calls[0]![3];
    const terminal = { ...run(), id: active.id };
    f.transport.read.mockResolvedValueOnce(terminal);
    await receive({
      schemaVersion: 1,
      type: 'result-available',
      runId: active.id,
      sequence: '1',
      state: 'needs-input',
      expiresAt: new Date(now + RETRY_SECONDS).toISOString(),
    });
    expect(f.session.snapshot().run?.state).toBe('needs-input');
    f.transport.read.mockResolvedValueOnce(active);
    await f.session.refresh();
    expect(f.session.snapshot().run?.state).toBe('needs-input');
    expect(f.transport.create).toHaveBeenCalledTimes(1);
  });
  it('a server permission failure clears private content and blocks further generation', async () => {
    const f = setup();
    await f.prepared();
    await f.session.generate();
    f.transport.read.mockRejectedValueOnce(
      new ApiClientError('http', HTTP_FORBIDDEN, 'FORBIDDEN', 'No access'),
    );
    await f.session.refresh();
    expect(f.session.currentScope()).toBe(false);
    expect(f.session.snapshot()).toMatchObject({
      prompt: '',
      review: null,
      run: null,
      intent: null,
    });
    await f.session.availability();
    await f.session.generate();
    expect(f.transport.create).toHaveBeenCalledTimes(1);
  });
  it('disabled availability and offline mode prevent even an explicitly reviewed submission', async () => {
    const f = setup();
    f.transport.availability.mockResolvedValueOnce({
      schemaVersion: 1,
      available: false,
      reason: 'disabled',
      allowance: null,
    });
    await f.prepared();
    await f.session.generate();
    expect(f.transport.create).not.toHaveBeenCalled();
    f.guard.online = false;
    await f.session.availability();
    await f.session.generate();
    expect(f.transport.create).not.toHaveBeenCalled();
  });
  it('fresh actor authentication prevents sending reviewed context under a changed server account', async () => {
    const f = setup(async () => {
      throw new ApiClientError('unauthenticated', null, 'UNAUTHENTICATED', 'Account changed');
    });
    await f.prepared();
    await f.session.generate();
    expect(f.transport.create).not.toHaveBeenCalled();
    expect(f.session.currentScope()).toBe(false);
    expect(f.session.snapshot().intent).toBeNull();
    expect(f.session.snapshot().review).toBeNull();
  });
  it('an account change while fresh authentication is pending fences POST completely', async () => {
    let release!: () => void;
    const f = setup(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await f.prepared();
    const sending = f.session.generate();
    f.guard.allowed = false;
    f.session.dispose();
    release();
    await sending;
    expect(f.transport.create).not.toHaveBeenCalled();
    expect(f.session.snapshot().prompt).toBe('');
  });
});

describe('recorded AI Apply run recovery', () => {
  it('reads the recorded run without creating another provider intent', async () => {
    const h = setup();
    const original = run();
    h.transport.read.mockResolvedValue(original);
    await h.session.refresh(original.id);
    expect(h.transport.read).toHaveBeenCalledWith(original.id, expect.any(AbortSignal));
    expect(h.session.snapshot().run?.id).toBe(original.id);
    expect(h.transport.create).not.toHaveBeenCalled();
    expect(h.key).not.toHaveBeenCalled();
  });
  it('fences recovery when account or access changes while reading', async () => {
    const h = setup();
    let finish!: (value: ReturnType<typeof run>) => void;
    const original = run();
    h.transport.read.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = h.session.refresh(original.id);
    h.guard.allowed = false;
    finish(original);
    await pending;
    expect(h.session.snapshot().run).toBeNull();
    expect(h.transport.create).not.toHaveBeenCalled();
  });
});
