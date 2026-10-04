import { describe, expect, it } from '@jest/globals';
import {
  providerEventSchema,
  providerFailureSchema,
  AiProviderError,
  type AiProvider,
  type NormalizedProviderRequest,
  type ProviderEvent,
} from '../../application/provider.js';
import { AiProviderRegistry } from '../../application/provider-registry.js';
import { fixtureAiPolicy } from './fixture-config.js';

export type ProviderScenario = 'completed' | 'refused' | 'incomplete' | 'partial' | 'unknown-usage';

// SDK-free suite: adapter fixtures translate these scenarios within their own directory.
export function providerContractSuite(
  label: string,
  create: (scenario: ProviderScenario) => AiProvider,
  request: () => NormalizedProviderRequest,
) {
  async function collect(
    adapter: AiProvider,
    signal = new AbortController().signal,
    input = request(),
  ) {
    const resolved = new AiProviderRegistry('test', fixtureAiPolicy(), [adapter]).resolve();
    const events: ProviderEvent[] = [];
    for await (const event of resolved.adapter.stream(input, signal)) {
      events.push(providerEventSchema.parse(event));
    }
    return events;
  }
  describe(label, () => {
    it.each(['completed', 'refused', 'incomplete'] as const)(
      'emits one validated %s terminal event',
      async (scenario) => {
        const events = await collect(create(scenario));
        expect(events.at(-1)?.type).toBe(scenario);
        expect(events.filter((event) => event.type !== 'text-delta')).toHaveLength(1);
      },
    );
    it('does not turn partial output into success or assume zero usage', async () => {
      await expect(collect(create('partial'))).rejects.toMatchObject({
        failure: { code: 'transport', execution: 'may-have-started', usage: { status: 'unknown' } },
      });
    });
    it('preserves explicitly unknown usage on a completed result', async () => {
      const events = await collect(create('unknown-usage'));
      expect(events.at(-1)).toMatchObject({ type: 'completed', usage: { status: 'unknown' } });
    });
    it('rejects cancellation before sending without exposing its reason', async () => {
      const controller = new AbortController();
      controller.abort('private cancellation content');
      await expect(collect(create('completed'), controller.signal)).rejects.toMatchObject({
        failure: { code: 'cancelled', execution: 'definitely-unsent' },
      });
    });
    it('retains uncertain execution when cancelled after a partial delta', async () => {
      const controller = new AbortController();
      const iterator = create('partial')
        .stream(request(), controller.signal)
        [Symbol.asyncIterator]();
      expect((await iterator.next()).value?.type).toBe('text-delta');
      controller.abort('private cancellation content');
      try {
        await iterator.next();
        throw new Error('Expected cancellation.');
      } catch (error) {
        expect(error).toBeInstanceOf(AiProviderError);
        expect(providerFailureSchema.parse((error as AiProviderError).failure)).toMatchObject({
          code: 'cancelled',
          execution: 'may-have-started',
          usage: { status: 'unknown' },
        });
        expect(String(error) + JSON.stringify(error)).not.toContain('private');
      }
    });
    it.each(['model', 'schema'] as const)(
      'fails closed for unsupported %s without a fallback',
      async (kind) => {
        const input = request();
        const unsupported =
          kind === 'model'
            ? { ...input, model: 'unconfigured-model' }
            : {
                ...input,
                structuredOutput: {
                  name: 'unsupported',
                  schema: { type: 'object' },
                  version: 'unsupported-schema-v99',
                },
              };
        await expect(collect(create('completed'), undefined, unsupported)).rejects.toMatchObject({
          failure: {
            code: 'capability-unsupported',
            execution: 'definitely-unsent',
            usage: { status: 'unknown' },
          },
        });
      },
    );
    it('rejects native request extras through the neutral request contract', async () => {
      await expect(
        collect(create('completed'), undefined, {
          ...request(),
          nativeRequest: true,
        } as NormalizedProviderRequest),
      ).rejects.toMatchObject({
        failure: { code: 'invalid-request', execution: 'definitely-unsent' },
      });
    });
    it('rejects elapsed deadlines before execution', async () => {
      await expect(
        collect(create('completed'), undefined, { ...request(), deadlineAtUnixMs: Date.now() - 1 }),
      ).rejects.toMatchObject({
        failure: { code: 'deadline', execution: 'definitely-unsent' },
      });
    });
    it('enforces the neutral response byte ceiling', async () => {
      await expect(
        collect(create('completed'), undefined, { ...request(), maximumResponseBytes: 1 }),
      ).rejects.toMatchObject({
        failure: { code: 'output-too-large', execution: 'may-have-started' },
      });
    });
  });
}
