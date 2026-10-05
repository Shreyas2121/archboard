import { describe, expect, it } from '@jest/globals';
import type { ResponseUsage } from 'openai/resources/responses/responses';
import {
  AiProviderError,
  type NormalizedProviderRequest,
  type ProviderEvent,
} from '../../../application/provider.js';
import { AI_VERSIONS, type AiModelProfile } from '../../../application/operator-policy.js';
import { priceAiUsage, estimateAiReservation } from '../../../application/pricing.js';
import { snapshotAiConfiguration } from '../../../application/persistence.js';
import { fixtureAiPolicy } from '../../testing/fixture-config.js';
import {
  providerContractSuite,
  type ProviderScenario,
} from '../../testing/provider-contract-suite.js';
import {
  MAX_OPENAI_TRANSPORT_BYTES,
  normalizeOpenAiUsage,
  OpenAiProvider,
} from './openai-provider.js';

const HTTP = {
  badRequest: 400,
  authentication: 401,
  forbidden: 403,
  rateLimited: 429,
  overloaded: 503,
  timeout: 408,
};
const DEADLINE_MS = 2000;
const SHORT_DEADLINE_MS = 30;
const CANCEL_DELAY_MS = 20;
const STREAM_DEADLINE_MS = 40;
const RETRY_DELAY_MS = 2000;
const LARGE_TEXT_REPEATS = 2100;
const PARTITION_CHARACTERS = 64;
const ORDINARY_INPUT_TOKENS = 50;
const READ_INPUT_TOKENS = 20;
const MAXIMUM_ATTEMPTS = 3n;
const key = 'fixture-not-a-real-key-000000000000';
const FIXTURE_MODEL_PROFILE = fixtureAiPolicy().profiles[0]!;
const nativeUsage = {
  input_tokens: 100,
  input_tokens_details: { cached_tokens: 20, cache_write_tokens: 0 },
  output_tokens: 30,
  output_tokens_details: { reasoning_tokens: 10 },
  total_tokens: 130,
};
const knownUsage = {
  status: 'known',
  uncachedInputTokens: 80,
  cacheReadInputTokens: 20,
  cacheWriteInputTokens: [],
  outputTokens: 30,
  separatelyBilledReasoningTokens: 0,
  reasoningTokens: 10,
};
const request = (): NormalizedProviderRequest => ({
  model: FIXTURE_MODEL_PROFILE.model,
  task: 'diagram-described',
  instructions: 'server instruction authority',
  messages: [{ role: 'user', text: 'untrusted task data' }],
  structuredOutput: {
    name: 'fixture_result',
    version: AI_VERSIONS.schema,
    schema: {
      type: 'object',
      properties: { result: { type: 'string' } },
      required: ['result'],
      additionalProperties: false,
    },
  },
  maximumOutputTokens: 100,
  maximumResponseBytes: 1000,
  deadlineAtUnixMs: Date.now() + DEADLINE_MS,
  promptCache: 'disabled',
});
const delta = (text = 'hello') => ({ type: 'response.output_text.delta', delta: text });
function terminal(
  scenario: 'completed' | 'refused' | 'incomplete' = 'completed',
  overrides: Record<string, unknown> = {},
) {
  return {
    type: scenario === 'incomplete' ? 'response.incomplete' : 'response.completed',
    response: {
      status: scenario === 'incomplete' ? 'incomplete' : 'completed',
      output: [
        {
          type: 'message',
          status: 'completed',
          content:
            scenario === 'refused'
              ? [{ type: 'refusal', refusal: 'private refusal body' }]
              : [{ type: 'output_text', text: 'hello', annotations: [] }],
        },
      ],
      usage: nativeUsage,
      incomplete_details: { reason: 'max_output_tokens' },
      ...overrides,
    },
  };
}
function sse(events: unknown[]) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req_fixture' },
  });
}
function fixture(events: unknown[], profile: AiModelProfile = FIXTURE_MODEL_PROFILE) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return sse(events);
  };
  return { adapter: new OpenAiProvider(key, [profile], fetch), calls };
}
async function collect(
  adapter: OpenAiProvider,
  input = request(),
  signal = new AbortController().signal,
) {
  const events: ProviderEvent[] = [];
  for await (const event of adapter.stream(input, signal)) events.push(event);
  return events;
}

providerContractSuite(
  'OpenAI SDK fixture transport / shared neutral contract',
  (scenario: ProviderScenario) =>
    fixture(
      scenario === 'partial'
        ? [delta()]
        : scenario === 'unknown-usage'
          ? [delta(), terminal('completed', { usage: null })]
          : [delta(), terminal(scenario)],
    ).adapter,
  request,
);

describe('OpenAI Responses request and usage', () => {
  const explicitProfile: AiModelProfile = {
    ...FIXTURE_MODEL_PROFILE,
    promptCaching: 'openai-explicit-30m',
    prices: {
      ...FIXTURE_MODEL_PROFILE.prices,
      uncachedInputMicroUsdPerMillion: '1000000',
      cacheReadMicroUsdPerMillion: '100000',
      cacheWrites: [{ writeClass: 'openai-30m', microUsdPerMillion: '1250000' }],
      outputMicroUsdPerMillion: '2000000',
    },
  };
  const optimized = () => ({
    ...request(),
    promptCache: 'stable-prefix' as const,
    cachePartition: 'a'.repeat(PARTITION_CHARACTERS),
  });
  it('places exactly one static developer breakpoint before all private data and binds routing to schema/model/partition', async () => {
    const f = fixture([terminal()], explicitProfile);
    const input = optimized();
    await collect(f.adapter, input);
    await collect(f.adapter, {
      ...input,
      messages: [{ role: 'user', text: 'different private graph/history/evidence' }],
    });
    const bodies = f.calls.map((call) => JSON.parse(call.init.body as string));
    expect(bodies[0].prompt_cache_options).toEqual({ mode: 'explicit', ttl: '30m' });
    expect(bodies[0].instructions).toBeUndefined();
    expect(bodies[0].input[0]).toEqual({
      role: 'developer',
      content: [
        {
          type: 'input_text',
          text: input.instructions,
          prompt_cache_breakpoint: { mode: 'explicit' },
        },
      ],
    });
    expect(bodies[0].input[1]).toEqual({ role: 'user', content: input.messages[0]!.text });
    expect(bodies[1].input[0]).toEqual(bodies[0].input[0]);
    expect(bodies[1].prompt_cache_key).toBe(bodies[0].prompt_cache_key);
    expect(bodies[0].prompt_cache_key).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(bodies[0].prompt_cache_options)).not.toContain('prewarm');
    expect(bodies[0].prompt_cache_retention).toBeUndefined();
    for (const changed of [
      { ...input, instructions: input.instructions + ' revised' },
      { ...input, cachePartition: 'b'.repeat(PARTITION_CHARACTERS) },
      { ...input, structuredOutput: { ...input.structuredOutput!, name: 'new_schema' } },
      { ...input, structuredOutput: { ...input.structuredOutput!, schema: { type: 'object' } } },
    ]) {
      await collect(f.adapter, changed);
      expect(JSON.parse(f.calls.at(-1)!.init.body as string).prompt_cache_key).not.toBe(
        bodies[0].prompt_cache_key,
      );
    }
    const other = fixture([terminal()], { ...explicitProfile, model: 'other-fixture-model' });
    await collect(other.adapter, { ...input, model: 'other-fixture-model' });
    expect(JSON.parse(other.calls[0]!.init.body as string).prompt_cache_key).not.toBe(
      bodies[0].prompt_cache_key,
    );
  });
  it('omits optimization controls when disabled and emits only in-memory controls for a legacy profile', async () => {
    const f = fixture([terminal()], {
      ...FIXTURE_MODEL_PROFILE,
      promptCaching: 'openai-in-memory',
    });
    await collect(f.adapter, optimized());
    const body = JSON.parse(f.calls[0]!.init.body as string);
    expect(body.prompt_cache_retention).toBe('in_memory');
    expect(body.prompt_cache_options).toBeUndefined();
    expect(body.input).toEqual([{ role: 'user', content: request().messages[0]!.text }]);
    await collect(f.adapter);
    const disabled = JSON.parse(f.calls[1]!.init.body as string);
    for (const field of ['prompt_cache_key', 'prompt_cache_retention', 'prompt_cache_options'])
      expect(disabled[field]).toBeUndefined();
    expect(disabled.instructions).toBe(request().instructions);
  });
  it('conserves read/write/ordinary input, prices write premiums and reserves a full miss for every attempt', async () => {
    const mixed = {
      ...nativeUsage,
      input_tokens_details: { cached_tokens: 20, cache_write_tokens: 30 },
    };
    const f = fixture([terminal('completed', { usage: mixed })], explicitProfile);
    const result = (await collect(f.adapter, optimized())).at(-1)!;
    if (result.type !== 'completed' || result.usage.status !== 'known')
      throw new Error('Known fixture usage required');
    expect(result.usage.uncachedInputTokens).toBe(ORDINARY_INPUT_TOKENS);
    expect(result.usage.cacheReadInputTokens).toBe(READ_INPUT_TOKENS);
    expect(result.usage.cacheWriteInputTokens).toEqual([{ writeClass: 'openai-30m', tokens: 30 }]);
    expect(
      result.usage.uncachedInputTokens +
        result.usage.cacheReadInputTokens +
        result.usage.cacheWriteInputTokens[0]!.tokens,
    ).toBe(mixed.input_tokens);
    const policy = fixtureAiPolicy();
    const snapshot = snapshotAiConfiguration({
      provider: 'openai',
      profile: explicitProfile,
      policy,
    });
    expect(priceAiUsage(snapshot, result.usage)).toBe('150');
    const maximum = estimateAiReservation(snapshot, { repairs: 1, rejectionRetries: 1 });
    expect(BigInt(maximum.maximumMicroUsd)).toBeGreaterThanOrEqual(
      MAXIMUM_ATTEMPTS * BigInt(priceAiUsage(snapshot, result.usage)),
    );
    const allWrites = normalizeOpenAiUsage(
      { ...nativeUsage, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 100 } },
      explicitProfile,
    );
    expect(priceAiUsage(snapshot, allWrites)).toBe('185');
    expect(
      priceAiUsage(
        snapshot,
        normalizeOpenAiUsage(
          { ...nativeUsage, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } },
          explicitProfile,
        ),
      ),
    ).toBe('160');
  });
  it.each([
    { cached_tokens: 20 },
    { cached_tokens: 20, cache_write_tokens: -1 },
    { cached_tokens: 80, cache_write_tokens: 30 },
    { cached_tokens: 20, cache_write_tokens: 0.5 },
  ])('keeps incomplete or inconsistent explicit usage unknown', (details) => {
    expect(
      normalizeOpenAiUsage(
        { ...nativeUsage, input_tokens_details: details } as ResponseUsage,
        explicitProfile,
      ),
    ).toEqual({ status: 'unknown' });
  });
  it('rejects missing private partitions and unpriced explicit writes before dispatch', async () => {
    for (const [profile, input] of [
      [explicitProfile, { ...request(), promptCache: 'stable-prefix' as const }],
      [{ ...explicitProfile, prices: FIXTURE_MODEL_PROFILE.prices }, optimized()],
    ] as const) {
      const f = fixture([terminal()], profile);
      await expect(collect(f.adapter, input)).rejects.toBeInstanceOf(AiProviderError);
      expect(f.calls).toHaveLength(0);
    }
    expect(
      normalizeOpenAiUsage(nativeUsage, {
        ...explicitProfile,
        prices: FIXTURE_MODEL_PROFILE.prices,
      }),
    ).toEqual({ status: 'unknown' });
  });
  it('sends only bounded server-owned Responses fields and never retries', async () => {
    const { adapter, calls } = fixture([delta(), terminal()]);
    const events = await collect(adapter);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/responses');
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toEqual({
      model: request().model,
      instructions: request().instructions,
      input: [{ role: 'user', content: 'untrusted task data' }],
      stream: true,
      store: false,
      background: false,
      max_output_tokens: 100,
      tools: [],
      tool_choice: 'none',
      text: {
        format: {
          type: 'json_schema',
          name: 'fixture_result',
          strict: true,
          schema: request().structuredOutput!.schema,
        },
      },
    });
    expect(events.at(-1)).toEqual({
      type: 'completed',
      text: 'hello',
      usage: knownUsage,
      requestId: 'req_fixture',
    });
    expect(adapter.capabilities(request().model)).toMatchObject({
      streaming: true,
      structuredOutput: true,
      promptCaching: false,
    });
  });
  it('splits cached input and includes reasoning once inside output', () => {
    expect(normalizeOpenAiUsage(nativeUsage)).toEqual(knownUsage);
    expect(normalizeOpenAiUsage(undefined)).toEqual({ status: 'unknown' });
    expect(
      normalizeOpenAiUsage({
        ...nativeUsage,
        output_tokens_details: undefined,
      } as unknown as ResponseUsage),
    ).toMatchObject({ status: 'known', reasoningTokens: null });
  });
  it.each([
    { ...nativeUsage, input_tokens_details: undefined },
    { ...nativeUsage, input_tokens_details: { cached_tokens: 101 } },
    { ...nativeUsage, input_tokens_details: { cached_tokens: 20, cache_write_tokens: 1 } },
    { ...nativeUsage, input_tokens_details: { cached_tokens: 20, cache_write_tokens: null } },
    { ...nativeUsage, output_tokens: -1 },
    { ...nativeUsage, output_tokens_details: { reasoning_tokens: 31 } },
    { ...nativeUsage, total_tokens: 999 },
  ])('keeps missing, inconsistent and unpriced usage unknown', (usage) => {
    expect(normalizeOpenAiUsage(usage as ResponseUsage)).toEqual({ status: 'unknown' });
  });
  it.each([
    { model: 'unconfigured-model' },
    { promptCache: 'stable-prefix' },
    { maximumOutputTokens: 101 },
    { structuredOutput: { ...request().structuredOutput!, version: 'unsupported-v2' } },
    { store: true },
  ])('rejects unsupported or native requests before fetching', async (overrides) => {
    const { adapter, calls } = fixture([terminal()]);
    await expect(
      collect(adapter, { ...request(), ...overrides } as NormalizedProviderRequest),
    ).rejects.toBeInstanceOf(AiProviderError);
    expect(calls).toHaveLength(0);
  });
  it('rejects native structured output for a profile that does not support it', async () => {
    const adapter = new OpenAiProvider(
      key,
      [{ ...FIXTURE_MODEL_PROFILE, structuredOutput: false }],
      async () => {
        throw new Error('must not fetch');
      },
    );
    await expect(collect(adapter)).rejects.toMatchObject({
      failure: { code: 'capability-unsupported', execution: 'definitely-unsent' },
    });
  });
});

describe('terminal-only bounded output and safe failures', () => {
  it('bounds raw transport bytes before the SDK can buffer an oversized frame', async () => {
    const adapter = new OpenAiProvider(
      key,
      [FIXTURE_MODEL_PROFILE],
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(MAX_OPENAI_TRANSPORT_BYTES + 1));
              controller.close();
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    await expect(collect(adapter)).rejects.toMatchObject({
      failure: { code: 'output-too-large', usage: { status: 'unknown' } },
    });
  });
  it('assembles multiple deltas and bounds neutral chunks without breaking Unicode', async () => {
    const text = '\u{1F600}'.repeat(LARGE_TEXT_REPEATS);
    const { adapter } = fixture([
      delta(text),
      terminal('completed', {
        output: [
          { type: 'message', status: 'completed', content: [{ type: 'output_text', text }] },
        ],
      }),
    ]);
    const events = await collect(adapter, { ...request(), maximumResponseBytes: 9000 });
    expect(
      events
        .filter((event) => event.type === 'text-delta')
        .map((event) => event.text)
        .join(''),
    ).toBe(text);
    expect(events.at(-1)).toMatchObject({ type: 'completed', text });
  });
  it.each([[delta('hello'), terminal()], [terminal()]].map((events) => ({ events })))(
    'accepts authoritative completed output with or without deltas',
    async ({ events }) => {
      expect((await collect(fixture(events).adapter)).at(-1)?.type).toBe('completed');
    },
  );
  it.each(
    [
      [delta('different'), terminal()],
      [terminal('completed', { status: 'in_progress' })],
      [terminal('completed', { output: [{ type: 'function_call', arguments: 'private' }] })],
      [terminal('completed', { output: [] })],
      [{ type: 'response.output_text.done', text: 'hello' }],
      [{ type: 'error', code: 'unknown_private_code', message: 'private response body' }],
    ].map((events) => ({ events })),
  )('fails closed on inconsistent or nonterminal output', async ({ events }) => {
    await expect(collect(fixture(events).adapter)).rejects.toMatchObject({
      failure: { code: 'transport', execution: 'may-have-started' },
    });
  });
  it.each([[delta('\u{1F600}')], [terminal()]].map((events) => ({ events })))(
    'caps UTF-8 output on deltas and terminal payloads',
    async ({ events }) => {
      await expect(
        collect(fixture(events).adapter, { ...request(), maximumResponseBytes: 3 }),
      ).rejects.toMatchObject({ failure: { code: 'output-too-large' } });
    },
  );
  it('does not expose refusal text and preserves terminal usage', async () => {
    const events = await collect(
      fixture([
        { type: 'response.refusal.delta', delta: 'private refusal body' },
        terminal('refused'),
      ]).adapter,
    );
    expect(events).toEqual([{ type: 'refused', usage: knownUsage, requestId: 'req_fixture' }]);
  });
  it.each(['max_output_tokens', 'content_filter'])(
    'maps incomplete output without reporting success (%s)',
    async (reason) => {
      const events = await collect(
        fixture([delta(), terminal('incomplete', { incomplete_details: { reason }, usage: null })])
          .adapter,
      );
      expect(events.at(-1)).toMatchObject({
        type: 'incomplete',
        reason: reason === 'max_output_tokens' ? 'output-limit' : 'other',
        usage: { status: 'unknown' },
      });
    },
  );
  it.each([
    'insufficient_quota',
    'rate_limit_exceeded',
    'server_error',
    'invalid_api_key',
    'invalid_request_error',
  ])('sanitizes failure events (%s)', async (code) => {
    await expect(
      collect(
        fixture([
          {
            type: 'response.failed',
            response: { usage: nativeUsage, error: { code, message: 'private body' } },
          },
        ]).adapter,
      ),
    ).rejects.toMatchObject({ failure: { execution: 'may-have-started', usage: knownUsage } });
  });
  it.each([
    [HTTP.badRequest, 'invalid-request', 'definite-rejection'],
    [HTTP.authentication, 'authentication', 'definite-rejection'],
    [HTTP.forbidden, 'authentication', 'definite-rejection'],
    [HTTP.rateLimited, 'rate-limited', 'definite-rejection'],
    [HTTP.overloaded, 'overloaded', 'may-have-started'],
    [HTTP.timeout, 'transport', 'may-have-started'],
  ])(
    'sanitizes HTTP %i, keeps execution conservative, and disables SDK retries',
    async (status, code, execution) => {
      let calls = 0;
      const adapter = new OpenAiProvider(key, [FIXTURE_MODEL_PROFILE], async () => {
        calls++;
        return new Response(
          JSON.stringify({
            error: { message: 'private provider body', code: 'insufficient_quota' },
          }),
          { status: status as number, headers: { 'x-request-id': 'req_http', 'retry-after': '2' } },
        );
      });
      try {
        await collect(adapter);
        throw new Error('expected failure');
      } catch (error) {
        expect(error).toBeInstanceOf(AiProviderError);
        expect((error as AiProviderError).failure).toMatchObject({
          code,
          execution,
          usage: { status: 'unknown' },
          requestId: 'req_http',
        });
        expect(String(error) + JSON.stringify(error)).not.toContain('private');
        expect((error as AiProviderError).failure.retryAfterMs).toBe(
          status === HTTP.rateLimited || status === HTTP.overloaded ? RETRY_DELAY_MS : null,
        );
      }
      expect(calls).toBe(1);
    },
  );
  it('sanitizes connection errors, untrusted request IDs and malformed retry headers', async () => {
    let calls = 0;
    const adapter = new OpenAiProvider(key, [FIXTURE_MODEL_PROFILE], async () => {
      calls++;
      throw new Error('private network content');
    });
    await expect(collect(adapter)).rejects.toMatchObject({
      failure: { code: 'transport', execution: 'may-have-started', usage: { status: 'unknown' } },
    });
    expect(calls).toBe(1);
    const http = new OpenAiProvider(
      key,
      [FIXTURE_MODEL_PROFILE],
      async () =>
        new Response('{}', {
          status: 429,
          headers: { 'x-request-id': 'private request content', 'retry-after': 'private-header' },
        }),
    );
    await expect(collect(http)).rejects.toMatchObject({
      failure: { requestId: null, retryAfterMs: null },
    });
  });
});

describe('abort and total deadline propagation', () => {
  it('rejects elapsed deadlines without sending', async () => {
    const { adapter, calls } = fixture([terminal()]);
    await expect(
      collect(adapter, { ...request(), deadlineAtUnixMs: Date.now() - 1 }),
    ).rejects.toMatchObject({ failure: { code: 'deadline', execution: 'definitely-unsent' } });
    expect(calls).toHaveLength(0);
  });
  it.each(['cancelled', 'deadline'] as const)(
    'aborts an active pending transport for %s with unknown usage',
    async (code) => {
      let observed: AbortSignal | undefined;
      const adapter = new OpenAiProvider(key, [FIXTURE_MODEL_PROFILE], async (_url, init) => {
        observed = init!.signal!;
        return new Promise((_resolve, reject) => {
          observed!.addEventListener('abort', () => reject(new Error('private abort content')), {
            once: true,
          });
        });
      });
      const controller = new AbortController();
      const pending = collect(
        adapter,
        {
          ...request(),
          deadlineAtUnixMs: Date.now() + (code === 'deadline' ? SHORT_DEADLINE_MS : DEADLINE_MS),
        },
        controller.signal,
      );
      if (code === 'cancelled') setTimeout(() => controller.abort(), CANCEL_DELAY_MS);
      await expect(pending).rejects.toMatchObject({
        failure: { code, execution: 'may-have-started', usage: { status: 'unknown' } },
      });
      expect(observed?.aborted).toBe(true);
    },
  );
  it('propagates cancellation after a partial delta', async () => {
    const controller = new AbortController();
    const { adapter } = fixture([delta(), terminal()]);
    const iterator = adapter.stream(request(), controller.signal)[Symbol.asyncIterator]();
    expect((await iterator.next()).value.type).toBe('text-delta');
    controller.abort('private cancellation reason');
    await expect(iterator.next()).rejects.toMatchObject({
      failure: { code: 'cancelled', execution: 'may-have-started', usage: { status: 'unknown' } },
    });
  });
  it('aborts a pending SSE reader at the total deadline after headers arrive', async () => {
    let observed: AbortSignal | undefined;
    const adapter = new OpenAiProvider(key, [FIXTURE_MODEL_PROFILE], async (_url, init) => {
      observed = init!.signal!;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(delta())}\n\n`));
            init!.signal!.addEventListener(
              'abort',
              () => controller.error(new Error('private stream abort')),
              { once: true },
            );
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    });
    await expect(
      collect(adapter, { ...request(), deadlineAtUnixMs: Date.now() + STREAM_DEADLINE_MS }),
    ).rejects.toMatchObject({ failure: { code: 'deadline', execution: 'may-have-started' } });
    expect(observed?.aborted).toBe(true);
  });
});
