import OpenAI from 'openai';
import type {
  Response as OpenAIResponse,
  ResponseCreateParamsStreaming,
  ResponseUsage,
} from 'openai/resources/responses/responses';
import { MAX_AI_TEXT_CHARACTERS } from '@archboard/contracts';
import {
  AiProviderError,
  normalizedProviderRequestSchema,
  normalizedUsageSchema,
  providerEventSchema,
  type AiProvider,
  type NormalizedProviderRequest,
  type NormalizedUsage,
  type ProviderCapabilities,
  type ProviderEvent,
  type ProviderFailureCode,
} from '../../../application/provider.js';
import { AI_VERSIONS, type AiModelProfile } from '../../../application/operator-policy.js';

const unknownUsage = { status: 'unknown' } as const;
export const MAX_OPENAI_TRANSPORT_BYTES = 16_777_216;
const MILLISECONDS_PER_SECOND = 1000;
const MAX_RETRY_DELAY_MS = 86_400_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const HTTP_STATUS = Object.freeze({
  badRequest: 400,
  authentication: 401,
  forbidden: 403,
  notFound: 404,
  unprocessable: 422,
  rateLimited: 429,
  serverError: 500,
});
class OpenAiOutputLimitError extends Error {}

// Bound SSE framing, ignored reasoning/events and HTTP error bodies as well as
// visible output. The SDK otherwise buffers individual frames without a byte cap.
function boundedFetch(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (url, init) => {
    const response = await fetch(url, init);
    if (!response.body) return response;
    let bytes = 0;
    const body = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          if (bytes > MAX_OPENAI_TRANSPORT_BYTES) throw new OpenAiOutputLimitError();
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
const safeIdentifier = (value: unknown): string | null =>
  typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value) ? value : null;
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function normalizeOpenAiUsage(usage: ResponseUsage | null | undefined): NormalizedUsage {
  if (!usage) return unknownUsage;
  const cached = usage.input_tokens_details?.cached_tokens;
  const writes = usage.input_tokens_details?.cache_write_tokens;
  const reasoning = usage.output_tokens_details?.reasoning_tokens;
  // A new/unpriced write category cannot silently become free work. Older Responses
  // payloads omit cache_write_tokens; nonzero writes need an explicitly priced adapter.
  if (
    !count(usage.input_tokens) ||
    !count(cached) ||
    cached > usage.input_tokens ||
    !count(usage.output_tokens) ||
    !count(usage.total_tokens) ||
    usage.total_tokens !== usage.input_tokens + usage.output_tokens ||
    (writes !== undefined && writes !== 0) ||
    (reasoning !== undefined && (!count(reasoning) || reasoning > usage.output_tokens))
  )
    return unknownUsage;
  const result = normalizedUsageSchema.safeParse({
    status: 'known',
    uncachedInputTokens: usage.input_tokens - cached,
    cacheReadInputTokens: cached,
    cacheWriteInputTokens: [],
    outputTokens: usage.output_tokens,
    separatelyBilledReasoningTokens: 0,
    reasoningTokens: reasoning ?? null,
  });
  return result.success ? result.data : unknownUsage;
}

function retryDelay(headers: Headers | undefined): number | null {
  const milliseconds = headers?.get('retry-after-ms');
  const seconds = headers?.get('retry-after');
  const raw = milliseconds ?? seconds;
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return null;
  const delay = Math.ceil(
    Number(raw) *
      (milliseconds === null || milliseconds === undefined ? MILLISECONDS_PER_SECOND : 1),
  );
  return count(delay) && delay <= MAX_RETRY_DELAY_MS ? delay : null;
}

/** SDK imports/types are confined to this directory. Fetch injection is for fixture
 * transports; production composition never accepts a caller-controlled endpoint. */
export class OpenAiProvider implements AiProvider {
  public readonly id = 'openai' as const;
  public readonly implementation = 'production' as const;
  private readonly client: OpenAI;
  private readonly profiles: ReadonlyMap<string, AiModelProfile>;

  public constructor(
    apiKey: string,
    profiles: readonly AiModelProfile[],
    fetch?: typeof globalThis.fetch,
  ) {
    this.profiles = new Map(profiles.map((profile) => [profile.model, profile]));
    this.client = new OpenAI({
      apiKey,
      baseURL: 'https://api.openai.com/v1',
      organization: null,
      project: null,
      maxRetries: 0,
      logLevel: 'off',
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      fetch: boundedFetch(fetch ?? globalThis.fetch),
    });
  }

  public capabilities(model: string): ProviderCapabilities {
    const profile = this.profiles.get(model);
    if (!profile) throw this.failure('capability-unsupported', false);
    return Object.freeze({
      streaming: true,
      structuredOutput: profile.structuredOutput,
      schemaVersions: Object.freeze([AI_VERSIONS.schema]),
      promptCaching: false,
      contextWindowTokens: profile.contextWindowTokens,
      maximumOutputTokens: profile.maximumOutputTokens,
    });
  }

  private failure(
    code: ProviderFailureCode,
    started: boolean,
    usage: NormalizedUsage = unknownUsage,
    requestId: string | null = null,
  ): AiProviderError {
    return new AiProviderError({
      code,
      execution: started ? 'may-have-started' : 'definitely-unsent',
      usage,
      requestId,
      retryAfterMs: null,
    });
  }

  public async *stream(
    input: NormalizedProviderRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    const parsed = normalizedProviderRequestSchema.safeParse(input);
    if (!parsed.success) throw this.failure('invalid-request', false);
    const request = parsed.data;
    const capabilities = this.capabilities(request.model);
    if (
      request.maximumOutputTokens > capabilities.maximumOutputTokens ||
      request.promptCache !== 'disabled' ||
      (request.structuredOutput &&
        (!capabilities.structuredOutput || request.structuredOutput.version !== AI_VERSIONS.schema))
    )
      throw this.failure('capability-unsupported', false);
    if (signal.aborted) throw this.failure('cancelled', false);
    const remaining = request.deadlineAtUnixMs - Date.now();
    if (remaining <= 0) throw this.failure('deadline', false);
    // Node timers cannot represent a larger delay; reject instead of overflowing it.
    if (remaining > MAX_TIMER_DELAY_MS) throw this.failure('invalid-request', false);

    const body: ResponseCreateParamsStreaming = {
      model: request.model,
      instructions: request.instructions,
      input: request.messages.map(({ role, text }) => ({ role, content: text })),
      stream: true,
      store: false,
      background: false,
      max_output_tokens: request.maximumOutputTokens,
      tools: [],
      tool_choice: 'none',
      ...(request.structuredOutput
        ? {
            text: {
              format: {
                type: 'json_schema',
                name: request.structuredOutput.name,
                schema: request.structuredOutput.schema,
                strict: true,
              },
            },
          }
        : {}),
    };
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, remaining);
    let requestId: string | null = null;
    let bytes = 0;
    let assembled = '';
    let refused = false;
    let usage: NormalizedUsage = unknownUsage;
    const check = () => {
      if (signal.aborted) throw this.failure('cancelled', true, usage, requestId);
      if (controller.signal.aborted || Date.now() >= request.deadlineAtUnixMs)
        throw this.failure('deadline', true, usage, requestId);
    };
    try {
      check();
      const response = await this.client.responses
        .create(body, { signal: controller.signal, timeout: remaining, maxRetries: 0 })
        .withResponse();
      requestId = safeIdentifier(response.request_id);
      for await (const event of response.data) {
        check();
        if (event.type === 'response.output_text.delta') {
          bytes += Buffer.byteLength(event.delta, 'utf8');
          if (bytes > request.maximumResponseBytes)
            throw this.failure('output-too-large', true, usage, requestId);
          assembled += event.delta;
          // Bound each neutral delta independently without splitting surrogate pairs.
          let chunk = '';
          for (const character of event.delta) {
            if (chunk.length + character.length > MAX_AI_TEXT_CHARACTERS) {
              check();
              yield { type: 'text-delta', text: chunk };
              chunk = '';
            }
            chunk += character;
          }
          if (chunk) {
            check();
            yield { type: 'text-delta', text: chunk };
          }
        } else if (
          event.type === 'response.refusal.delta' ||
          event.type === 'response.refusal.done'
        ) {
          refused = true;
          // Refusal content is never emitted or retained.
        } else if (
          event.type === 'response.completed' ||
          event.type === 'response.incomplete' ||
          event.type === 'response.failed'
        ) {
          usage = normalizeOpenAiUsage(event.response.usage);
          if (event.type === 'response.failed')
            throw this.failure(mapCode(event.response.error?.code), true, usage, requestId);
          const expected = event.type === 'response.completed' ? 'completed' : 'incomplete';
          if (event.response.status !== expected)
            throw this.failure('transport', true, usage, requestId);
          const output = terminalText(event.response, request.maximumResponseBytes);
          check();
          if (event.type === 'response.incomplete') {
            yield providerEventSchema.parse({
              type: 'incomplete',
              reason:
                event.response.incomplete_details?.reason === 'max_output_tokens'
                  ? 'output-limit'
                  : 'other',
              usage,
              requestId,
            });
          } else if (refused || output.refused) {
            yield { type: 'refused', usage, requestId };
          } else {
            // Terminal output is authoritative, but conflicting deltas fail closed.
            if (!output.text || (assembled && assembled !== output.text))
              throw this.failure('transport', true, usage, requestId);
            yield providerEventSchema.parse({
              type: 'completed',
              text: output.text,
              usage,
              requestId,
            });
          }
          return;
        } else if (event.type === 'error') {
          throw this.failure(mapCode(event.code), true, usage, requestId);
        }
      }
      check();
      throw this.failure('transport', true, usage, requestId);
    } catch (error) {
      check();
      if (error instanceof AiProviderError) throw error;
      if (error instanceof OpenAiOutputLimitError)
        throw this.failure('output-too-large', true, usage, requestId);
      if (error instanceof OpenAI.APIError) {
        const status = error.status;
        const rejection =
          status !== undefined &&
          [
            HTTP_STATUS.badRequest,
            HTTP_STATUS.authentication,
            HTTP_STATUS.forbidden,
            HTTP_STATUS.notFound,
            HTTP_STATUS.unprocessable,
            HTTP_STATUS.rateLimited,
          ].includes(status);
        throw new AiProviderError({
          code:
            status === HTTP_STATUS.rateLimited
              ? 'rate-limited'
              : status === HTTP_STATUS.authentication || status === HTTP_STATUS.forbidden
                ? 'authentication'
                : status !== undefined && status >= HTTP_STATUS.serverError
                  ? 'overloaded'
                  : rejection
                    ? 'invalid-request'
                    : 'transport',
          execution: rejection ? 'definite-rejection' : 'may-have-started',
          usage,
          requestId: safeIdentifier(error.requestID) ?? requestId,
          retryAfterMs:
            status === HTTP_STATUS.rateLimited ||
            (status !== undefined && status >= HTTP_STATUS.serverError)
              ? retryDelay(error.headers)
              : null,
        });
      }
      throw this.failure('transport', true, usage, requestId);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      controller.abort();
    }
  }
}

function mapCode(code: string | null | undefined): ProviderFailureCode {
  if (code === 'rate_limit_exceeded' || code === 'insufficient_quota') return 'rate-limited';
  if (code === 'invalid_api_key') return 'authentication';
  if (code === 'invalid_request_error') return 'invalid-request';
  if (code === 'server_error' || code === 'overloaded') return 'overloaded';
  return 'transport';
}

function terminalText(
  response: OpenAIResponse,
  maximumBytes: number,
): { text: string; refused: boolean } {
  let text = '';
  let bytes = 0;
  let refused = false;
  for (const item of response.output) {
    if (item.type === 'reasoning') continue;
    if (item.type !== 'message') throw new Error('Unexpected output kind');
    if (response.status === 'completed' && item.status !== 'completed')
      throw new Error('Unexpected message status');
    for (const part of item.content) {
      if (part.type === 'output_text') {
        bytes += Buffer.byteLength(part.text, 'utf8');
        if (bytes > maximumBytes) throw new OpenAiOutputLimitError();
        text += part.text;
      } else if (part.type === 'refusal') refused = true;
      else throw new Error('Unexpected content kind');
    }
  }
  return { text, refused };
}
