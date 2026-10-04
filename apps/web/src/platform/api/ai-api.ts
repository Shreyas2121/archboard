import {
  aiAvailabilityResponseSchema,
  aiCreateRunSchema,
  aiRunResponseSchema,
  aiRunPathSchema,
  aiCancelRunSchema,
  aiEventHeadersSchema,
  aiAvailabilityQuerySchema,
  idempotencyKeySchema,
  apiErrorEnvelopeSchema,
  MAX_AI_RESULT_BYTES,
  type AiCreateRun,
  type AiRun,
  type AiAvailability,
  type AiRunEvent,
} from '@archboard/contracts';
import {
  apiRequest,
  fetchApiResponse,
  readApiResponse,
  ApiClientError,
  type ApiRequestOptions,
} from './api-client';
import type { z } from 'zod';
import { AiEventParser, MAX_AI_STREAM_BYTES } from './ai-events';

const MAX_RESPONSE_BYTES = MAX_AI_RESULT_BYTES + MAX_AI_STREAM_BYTES;
const STREAM_DEADLINE_MS = 125_000;
const REQUEST_DEADLINE_MS = 15_000;
/** A timeout never retries POST. Even an adapter ignoring AbortSignal loses its reply. */
export async function withAiDeadline<T>(
  signal: AbortSignal,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const abort = new AbortController();
  let reject!: (error: Error) => void;
  const interrupted = new Promise<never>((_resolve, fail) => {
    reject = fail;
  });
  const stop = () => {
    abort.abort();
    reject(
      new ApiClientError(
        'network',
        null,
        null,
        'The AI request was interrupted. Check its original intent.',
      ),
    );
  };
  signal.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, REQUEST_DEADLINE_MS);
  try {
    if (signal.aborted) stop();
    return await Promise.race([
      abort.signal.aborted ? interrupted : work(abort.signal),
      interrupted,
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
  }
}
function aiRequest<T>(
  path: `/${string}`,
  schema: z.ZodType<T>,
  options: ApiRequestOptions & { signal: AbortSignal },
) {
  return withAiDeadline(options.signal, (signal) =>
    apiRequest(path, schema, { ...options, signal }),
  );
}
export interface AiTransport {
  availability(boardId: string, signal: AbortSignal): Promise<AiAvailability>;
  create(key: string, body: AiCreateRun, signal: AbortSignal): Promise<AiRun>;
  read(id: string, signal: AbortSignal): Promise<AiRun>;
  cancel(id: string, signal: AbortSignal): Promise<AiRun>;
  events(
    id: string,
    lastId: string | undefined,
    signal: AbortSignal,
    receive: (event: AiRunEvent) => Promise<void>,
  ): Promise<void>;
}
const runPath = (id: string): `/ai/runs/${string}` =>
  `/ai/runs/${aiRunPathSchema.parse({ runId: id }).runId}`;
export const aiTransport: AiTransport = {
  availability: async (boardId, signal) => {
    const query = aiAvailabilityQuerySchema.parse({ boardId });
    return (
      await aiRequest(`/ai/availability?boardId=${query.boardId}`, aiAvailabilityResponseSchema, {
        signal,
        maxResponseBytes: MAX_AI_STREAM_BYTES,
      })
    ).data;
  },
  create: async (key, body, signal) => {
    const run = (
      await aiRequest('/ai/runs', aiRunResponseSchema, {
        method: 'POST',
        signal,
        body: aiCreateRunSchema.parse(body),
        headers: { 'Idempotency-Key': idempotencyKeySchema.parse(key) },
        maxResponseBytes: MAX_RESPONSE_BYTES,
      })
    ).data;
    if (run.task !== body.task)
      throw new ApiClientError('invalid-response', null, null, 'AI task binding did not match.');
    return run;
  },
  read: async (id, signal) => {
    const run = (
      await aiRequest(runPath(id), aiRunResponseSchema, {
        signal,
        maxResponseBytes: MAX_RESPONSE_BYTES,
      })
    ).data;
    if (run.id !== id)
      throw new ApiClientError('invalid-response', null, null, 'AI run binding did not match.');
    return run;
  },
  cancel: async (id, signal) => {
    const run = (
      await aiRequest(`${runPath(id)}/cancel`, aiRunResponseSchema, {
        method: 'POST',
        body: aiCancelRunSchema.parse({ schemaVersion: 1 }),
        signal,
        maxResponseBytes: MAX_RESPONSE_BYTES,
      })
    ).data;
    if (run.id !== id)
      throw new ApiClientError('invalid-response', null, null, 'AI run binding did not match.');
    return run;
  },
  events: async (id, lastId, signal, receive) => {
    aiEventHeadersSchema.parse({ lastEventId: lastId });
    const abort = new AbortController();
    const stop = () => abort.abort();
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    const timer = setTimeout(stop, STREAM_DEADLINE_MS);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetchApiResponse(
        `${runPath(id)}/events`,
        { signal: abort.signal, headers: lastId ? { 'Last-Event-ID': lastId } : {} },
        'text/event-stream',
      );
      if (!response.ok)
        await readApiResponse(response, apiErrorEnvelopeSchema, {
          signal: abort.signal,
          maxResponseBytes: MAX_AI_STREAM_BYTES,
        });
      if (
        response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !==
          'text/event-stream' ||
        !response.body
      ) {
        await response.body?.cancel();
        throw new ApiClientError(
          'invalid-response',
          response.status,
          null,
          'Invalid AI event response.',
        );
      }
      reader = response.body.getReader();
      const parser = new AiEventParser(id);
      for (;;) {
        const chunk = await reader.read();
        const events = chunk.done ? parser.finish() : parser.push(chunk.value);
        for (const event of events) {
          if (abort.signal.aborted) return;
          await receive(event);
        }
        if (chunk.done) break;
      }
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      await reader?.cancel().catch(() => undefined);
      reader?.releaseLock();
    }
  },
};
