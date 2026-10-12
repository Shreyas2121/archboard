import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { aiRunSchema, aiRunEventSchema, type AiRun } from '@archboard/contracts';
import { AiEvents, aiSnapshotEvent } from './ai-events.js';

const INTERVAL_MS = 5_000;
const DEADLINE_MS = 120_000;
const TWO = 2;
function pending(): AiRun {
  return aiRunSchema.parse({
    schemaVersion: 1,
    id: randomUUID(),
    task: 'diagram-described',
    state: 'generating',
    createdAt: '2026-10-04T10:00:00.000Z',
    updatedAt: '2026-10-04T10:00:00.000Z',
    content: { status: 'pending' },
    failure: null,
    source: 'generation',
  });
}
function response(writable = true) {
  const emitter = new EventEmitter();
  const result = Object.assign(emitter, {
    headersSent: false,
    writableEnded: false,
    setHeader: jest.fn(),
    write: jest.fn((text: string) => {
      expect(text.length).toBeGreaterThan(0);
      result.headersSent = true;
      return writable;
    }),
    end: jest.fn(() => {
      result.writableEnded = true;
    }),
  });
  return result;
}
describe('bounded authorized snapshot SSE', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it('reauthorizes heartbeats and stops immediately on revocation with no queued private content', async () => {
    const run = pending();
    let authorized = true;
    const subscription = {
      close: jest.fn(),
      next: jest.fn(async (requireSession?: () => Promise<void>) => {
        await requireSession?.();
        if (!authorized) throw new Error('Revoked');
        return run;
      }),
    };
    const session = jest.fn(async () => undefined);
    const target = response();
    const transport = new AiEvents();
    await transport.serve(target as unknown as ServerResponse, subscription, session);
    expect(target.write.mock.calls[0]?.[0]).toContain('event: status');
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(target.write.mock.calls[1]?.[0]).toBe(': heartbeat\n\n');
    expect(session).toHaveBeenCalledTimes(TWO);
    authorized = false;
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(target.write).toHaveBeenCalledTimes(TWO);
    expect(subscription.close).toHaveBeenCalledTimes(1);
    expect(target.end).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
  it('rechecks cookies on delivery and closes on session expiry', async () => {
    let signedIn = true;
    const read = jest.fn(() => pending());
    const subscription = {
      close: jest.fn(),
      next: jest.fn(async (requireSession?: () => Promise<void>) => {
        await requireSession?.();
        return read();
      }),
    };
    const target = response();
    await new AiEvents().serve(target as unknown as ServerResponse, subscription, async () => {
      if (!signedIn) throw new Error('Expired session');
    });
    signedIn = false;
    await jest.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(subscription.next).toHaveBeenCalledTimes(TWO);
    expect(read).toHaveBeenCalledTimes(1);
    expect(target.write).toHaveBeenCalledTimes(1);
    expect(target.end).toHaveBeenCalledTimes(1);
  });
  it('disconnects slow consumers after one bounded write without canceling the run', async () => {
    const target = response(false);
    const subscription = { close: jest.fn(), next: jest.fn(async () => pending()) };
    await new AiEvents().serve(
      target as unknown as ServerResponse,
      subscription,
      async () => undefined,
    );
    await jest.advanceTimersByTimeAsync(DEADLINE_MS);
    expect(target.write).toHaveBeenCalledTimes(1);
    expect(subscription.close).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
  it('bounds connection duration and releases transport timers on shutdown', async () => {
    const transport = new AiEvents();
    const target = response();
    const run = pending();
    const subscription = { close: jest.fn(), next: jest.fn(async () => run) };
    await transport.serve(target as unknown as ServerResponse, subscription, async () => undefined);
    await jest.advanceTimersByTimeAsync(DEADLINE_MS);
    expect(target.writableEnded).toBe(true);
    expect(subscription.close).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    const another = response();
    await transport.serve(
      another as unknown as ServerResponse,
      subscription,
      async () => undefined,
    );
    transport.onModuleDestroy();
    expect(another.writableEnded).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
  it('drops an in-flight snapshot after client disconnect', async () => {
    let resolve!: (run: AiRun) => void;
    const next = new Promise<AiRun>((r) => {
      resolve = r;
    });
    const target = response();
    const subscription = { close: jest.fn(), next: () => next };
    const task = new AiEvents().serve(
      target as unknown as ServerResponse,
      subscription,
      async () => undefined,
    );
    target.emit('close');
    resolve(pending());
    await task;
    expect(target.write).not.toHaveBeenCalled();
    expect(subscription.close).toHaveBeenCalledTimes(1);
  });
  it.each([
    { state: 'cancelled', content: { status: 'unavailable' }, failure: null, event: 'cancelled' },
    {
      state: 'failed',
      content: { status: 'unavailable' },
      failure: { code: 'AI_REFUSED' },
      event: 'failed',
    },
    {
      state: 'outcome-unknown',
      content: { status: 'unavailable' },
      failure: { code: 'AI_OUTCOME_UNKNOWN' },
      event: 'failed',
    },
    {
      state: 'ready-for-review',
      content: { status: 'expired', expiredAt: '2026-10-04T10:01:00.000Z' },
      failure: null,
      event: 'content-expired',
    },
  ])('documents terminal $event and closes the connection', async ({ event, ...terminal }) => {
    const run = aiRunSchema.parse({ ...pending(), ...terminal });
    expect(aiRunEventSchema.parse(aiSnapshotEvent(run)).type).toBe(event);
    const target = response();
    const subscription = { close: jest.fn(), next: async () => run };
    await new AiEvents().serve(
      target as unknown as ServerResponse,
      subscription,
      async () => undefined,
    );
    expect(target.writableEnded).toBe(true);
    expect(target.write.mock.calls[0]?.[0]).toContain(`event: ${event}`);
    expect(jest.getTimerCount()).toBe(0);
  });
});
