import {
  AiProviderError,
  normalizedProviderRequestSchema,
  providerEventSchema,
  type AiProvider,
  type NormalizedProviderRequest,
  type ProviderCapabilities,
  type ProviderEvent,
  type ProviderFailure,
} from '../../application/index.js';

/** Deterministic test-only transport. Registry rejects it outside NODE_ENV=test. */
export class FixtureAiProvider implements AiProvider {
  public readonly id = 'openai' as const;
  public readonly implementation = 'test-fixture' as const;
  public calls = 0;
  public constructor(
    private readonly models: Readonly<Record<string, ProviderCapabilities>>,
    private readonly events: readonly ProviderEvent[],
    private readonly failure: ProviderFailure | null = null,
    private readonly now: () => number = Date.now,
  ) {}
  public capabilities(model: string): ProviderCapabilities {
    const capabilities = this.models[model];
    if (!capabilities)
      throw new AiProviderError({
        code: 'capability-unsupported',
        execution: 'definitely-unsent',
        usage: { status: 'unknown' },
        retryAfterMs: null,
        requestId: null,
      });
    return capabilities;
  }
  public async *stream(
    input: NormalizedProviderRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    const parsed = normalizedProviderRequestSchema.safeParse(input);
    if (!parsed.success)
      throw new AiProviderError({
        code: 'invalid-request',
        execution: 'definitely-unsent',
        usage: { status: 'unknown' },
        retryAfterMs: null,
        requestId: null,
      });
    const request = parsed.data;
    const capabilities = this.capabilities(request.model);
    if (
      !capabilities.streaming ||
      request.maximumOutputTokens > capabilities.maximumOutputTokens ||
      (request.structuredOutput &&
        (!capabilities.structuredOutput ||
          !capabilities.schemaVersions.includes(request.structuredOutput.version))) ||
      (request.promptCache !== 'disabled' && !capabilities.promptCaching)
    )
      throw new AiProviderError({
        code: 'capability-unsupported',
        execution: 'definitely-unsent',
        usage: { status: 'unknown' },
        retryAfterMs: null,
        requestId: null,
      });
    const check = (started: boolean) => {
      if (signal.aborted || this.now() >= request.deadlineAtUnixMs)
        throw new AiProviderError({
          code: signal.aborted ? 'cancelled' : 'deadline',
          execution: started ? 'may-have-started' : 'definitely-unsent',
          usage: { status: 'unknown' },
          retryAfterMs: null,
          requestId: null,
        });
    };
    check(false);
    this.calls++;
    let bytes = 0;
    for (const inputEvent of this.events) {
      check(true);
      const event = providerEventSchema.parse(inputEvent);
      if ('text' in event) {
        const textBytes = new TextEncoder().encode(event.text).byteLength;
        bytes = event.type === 'completed' ? Math.max(bytes, textBytes) : bytes + textBytes;
        if (bytes > request.maximumResponseBytes)
          throw new AiProviderError({
            code: 'output-too-large',
            execution: 'may-have-started',
            usage: { status: 'unknown' },
            retryAfterMs: null,
            requestId: null,
          });
      }
      yield event;
      if (event.type !== 'text-delta') return;
    }
    check(true);
    if (this.failure) throw new AiProviderError(this.failure);
    throw new AiProviderError({
      code: 'transport',
      execution: 'may-have-started',
      usage: { status: 'unknown' },
      retryAfterMs: null,
      requestId: null,
    });
  }
}
