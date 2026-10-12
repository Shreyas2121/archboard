import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aiRunSchema,
  MAX_AI_EVENT_BYTES,
  MAX_AI_RESULT_BYTES,
  type AiRunEvent,
} from '@archboard/contracts';
import { AiEventParser, MAX_AI_STREAM_BYTES } from '@/platform/api/ai-events';
import { aiTransport, withAiDeadline } from '@/platform/api/ai-api';
import { setUnauthorizedListener } from '@/platform/api/api-client';
vi.mock('@/platform/config', () => ({
  loadWebConfig: () => ({ apiOrigin: 'https://api.example.test' }),
}));
const HTTP_UNAUTHORIZED = 401;
const HTTP_RATE_LIMITED = 429;
const TWO = 2;
const RETRY_SECONDS = 30;
const INVALID_UTF8 = 255;
const RUN_ID = randomUUID();
const frame = (event: AiRunEvent, ending = '\n') =>
  `id: ${event.sequence}${ending}event: ${event.type}${ending}data: ${JSON.stringify(event)}${ending}${ending}`;
const event: AiRunEvent = {
  schemaVersion: 1,
  runId: RUN_ID,
  sequence: '1',
  type: 'status',
  state: 'generating',
};
const encode = (text: string) => new TextEncoder().encode(text);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setUnauthorizedListener(null);
});
describe('bounded AI SSE parsing', () => {
  it('decodes split UTF-8 and CRLF, accepts repeated IDs and never treats text deltas as success', () => {
    const parser = new AiEventParser(RUN_ID);
    const delta: AiRunEvent = {
      schemaVersion: 1,
      runId: RUN_ID,
      sequence: '1',
      type: 'text-delta',
      text: 'Private 🧠',
    };
    const bytes = encode(
      ': heartbeat\r\n\r\n' + frame(delta, '\r\n') + frame(event, '\r\n') + frame(event),
    );
    const received: AiRunEvent[] = [];
    for (const byte of bytes) received.push(...parser.push(new Uint8Array([byte])));
    received.push(...parser.finish());
    expect(received).toEqual([event, event]);
  });
  it('rejects forged run IDs, unsupported fields, mismatched types/IDs and incomplete streams', () => {
    for (const source of [
      frame({ ...event, runId: randomUUID() }),
      frame(event).replace('id: 1', 'id: 2'),
      frame(event).replace('event: status', 'event: failed'),
      'retry: 1\n\n',
      'data: {\n\n',
    ]) {
      expect(() => new AiEventParser(RUN_ID).push(encode(source))).toThrow();
    }
    const incomplete = new AiEventParser(RUN_ID);
    incomplete.push(encode('data: {'));
    expect(() => incomplete.finish()).toThrow();
    expect(() => new AiEventParser(RUN_ID).push(new Uint8Array([INVALID_UTF8]))).toThrow();
  });
  it('bounds frames, individual events and total bytes even without data or delimiters', () => {
    expect(() => new AiEventParser(RUN_ID).push(new Uint8Array(MAX_AI_STREAM_BYTES + 1))).toThrow();
    expect(() =>
      new AiEventParser(RUN_ID).push(encode('x'.repeat(MAX_AI_EVENT_BYTES + 1))),
    ).toThrow();
    const overFrames = 65;
    expect(() =>
      new AiEventParser(RUN_ID).push(encode(': heartbeat\n\n'.repeat(overFrames))),
    ).toThrow();
  });
});
describe('typed AI HTTP adapter', () => {
  it('bounds an unresponsive request without retrying or accepting a late reply', async () => {
    vi.useFakeTimers();
    let release!: (value: string) => void;
    let signal!: AbortSignal;
    const work = vi.fn((active: AbortSignal) => {
      signal = active;
      return new Promise<string>((resolve) => {
        release = resolve;
      });
    });
    const promise = withAiDeadline(new AbortController().signal, work).catch(
      (error: unknown) => error,
    );
    const deadline = 15_000;
    await vi.advanceTimersByTimeAsync(deadline);
    expect(await promise).toMatchObject({ kind: 'network', name: 'ApiRequestTimeoutError' });
    expect(signal.aborted).toBe(true);
    expect(work).toHaveBeenCalledTimes(1);
    release('Late private result');
    expect(await promise).toMatchObject({ kind: 'network' });
    expect(vi.getTimerCount()).toBe(0);
  });
  const body = {
    schemaVersion: 1 as const,
    task: 'diagram-described' as const,
    target: { kind: 'new-board' as const },
    prompt: 'Reviewed input',
    history: [],
  };
  const run = aiRunSchema.parse({
    schemaVersion: 1,
    id: RUN_ID,
    task: 'diagram-described',
    state: 'generating',
    createdAt: '2026-10-04T10:00:00Z',
    updatedAt: '2026-10-04T10:00:00Z',
    content: { status: 'pending' },
    failure: null,
    source: 'generation',
  });
  it('allows slow creation beyond 15 seconds and times out once at its longer deadline', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(() => new Promise(() => undefined));
    vi.stubGlobal('fetch', fetch);
    const promise = aiTransport
      .create(randomUUID(), body, new AbortController().signal)
      .catch((error: unknown) => error);
    const shortDeadline = 15_000;
    const createDeadline = 125_000;
    await vi.advanceTimersByTimeAsync(shortDeadline);
    const signal = fetch.mock.calls[0]![1]!.signal!;
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(createDeadline - shortDeadline);
    expect(await promise).toMatchObject({
      name: 'ApiRequestTimeoutError',
      message: 'The API did not respond within 125 seconds.',
    });
    expect(signal.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('uses cookies/no-store, strict schemas and the original key/body without retrying POST', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: run })));
    vi.stubGlobal('fetch', fetch);
    const key = randomUUID();
    await aiTransport.create(key, body, new AbortController().signal);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('https://api.example.test/api/v1/ai/runs');
    expect(options).toMatchObject({
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      body: JSON.stringify(body),
      headers: { 'Idempotency-Key': key },
    });
    await expect(
      aiTransport.create('forged', body, new AbortController().signal),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('a reconnect sends Last-Event-ID to GET only and receives validated snapshots', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(
        async () =>
          new Response(frame(event), { headers: { 'content-type': 'text/event-stream' } }),
      );
    vi.stubGlobal('fetch', fetch);
    const receive = vi.fn(async () => undefined);
    for (const lastId of [undefined, '1'])
      await aiTransport.events(RUN_ID, lastId, new AbortController().signal, receive);
    expect(receive).toHaveBeenCalledTimes(TWO);
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Last-Event-ID': '1' },
    });
    for (const [url, options] of fetch.mock.calls) {
      expect(String(url)).toBe(`https://api.example.test/api/v1/ai/runs/${RUN_ID}/events`);
      expect(options?.body).toBeUndefined();
    }
  });
  it('rejects successful HTML, invalid DTOs, mismatched result IDs and oversized response bodies', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);
    fetch.mockResolvedValueOnce(new Response('html', { headers: { 'content-type': 'text/html' } }));
    await expect(
      aiTransport.events(RUN_ID, undefined, new AbortController().signal, async () => undefined),
    ).rejects.toMatchObject({ kind: 'invalid-response' });
    fetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { ...run, id: randomUUID() } })),
    );
    await expect(aiTransport.read(RUN_ID, new AbortController().signal)).rejects.toMatchObject({
      kind: 'invalid-response',
    });
    fetch.mockResolvedValueOnce(
      new Response('x'.repeat(MAX_AI_RESULT_BYTES + MAX_AI_STREAM_BYTES + 1)),
    );
    await expect(aiTransport.read(RUN_ID, new AbortController().signal)).rejects.toMatchObject({
      kind: 'invalid-response',
    });
  });
  it('notifies the existing authentication boundary and preserves safe Retry-After', async () => {
    const notify = vi.fn();
    setUnauthorizedListener(notify);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('Sign in', { status: HTTP_UNAUTHORIZED }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      aiTransport.events(RUN_ID, undefined, new AbortController().signal, async () => undefined),
    ).rejects.toMatchObject({ kind: 'unauthenticated' });
    expect(notify).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: 'RATE_LIMITED', message: 'Too many requests.', requestId: 'safe-id' },
        }),
        { status: HTTP_RATE_LIMITED, headers: { 'retry-after': String(RETRY_SECONDS) } },
      ),
    );
    await expect(aiTransport.read(RUN_ID, new AbortController().signal)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: RETRY_SECONDS,
    });
  });
});
