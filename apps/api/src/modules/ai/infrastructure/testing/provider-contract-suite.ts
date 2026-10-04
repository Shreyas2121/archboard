import { describe, expect, it } from '@jest/globals';
import {
  providerEventSchema,
  type AiProvider,
  type NormalizedProviderRequest,
  type ProviderEvent,
} from '../../application/provider.js';

export type ProviderScenario = 'completed' | 'refused' | 'incomplete' | 'partial';

// SDK-free suite: adapter fixtures translate these scenarios within their own directory.
export function providerContractSuite(
  label: string,
  create: (scenario: ProviderScenario) => AiProvider,
  request: () => NormalizedProviderRequest,
) {
  async function collect(adapter: AiProvider, signal = new AbortController().signal) {
    const events: ProviderEvent[] = [];
    for await (const event of adapter.stream(request(), signal)) {
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
    it('rejects cancellation before sending without exposing its reason', async () => {
      const controller = new AbortController();
      controller.abort('private cancellation content');
      await expect(collect(create('completed'), controller.signal)).rejects.toMatchObject({
        failure: { code: 'cancelled', execution: 'definitely-unsent' },
      });
    });
  });
}
