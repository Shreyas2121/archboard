import { describe, expect, it } from '@jest/globals';
import {
  AiProviderError,
  providerEventSchema,
  type NormalizedProviderRequest,
  type NormalizedUsage,
  type ProviderCapabilities,
  type ProviderEvent,
} from './provider.js';
import { AiProviderRegistry } from './provider-registry.js';
import { AI_VERSIONS } from './operator-policy.js';
import { fixtureAiPolicy } from '../infrastructure/testing/fixture-config.js';
import { FixtureAiProvider } from '../infrastructure/testing/fixture-provider.js';
import {
  providerContractSuite,
  type ProviderScenario,
} from '../infrastructure/testing/provider-contract-suite.js';

const DEADLINE_MS = 2000;
const policy = fixtureAiPolicy();
const profile = policy.profiles[0]!;
const capabilities: ProviderCapabilities = {
  streaming: true,
  structuredOutput: true,
  promptCaching: false,
  schemaVersions: [AI_VERSIONS.schema],
  contextWindowTokens: profile.contextWindowTokens,
  maximumOutputTokens: profile.maximumOutputTokens,
};
const request = (): NormalizedProviderRequest => ({
  model: profile.model,
  task: 'diagram-described',
  instructions: 'Server instructions.',
  messages: [{ role: 'user', text: 'Untrusted supplied data.' }],
  maximumOutputTokens: profile.maximumOutputTokens,
  maximumResponseBytes: 1000,
  deadlineAtUnixMs: Date.now() + DEADLINE_MS,
  promptCache: 'disabled',
  structuredOutput: {
    name: 'fixture_result',
    version: AI_VERSIONS.schema,
    schema: { type: 'object' },
  },
});
const unknownUsage = { status: 'unknown' } as const;
const knownUsage: NormalizedUsage = {
  status: 'known',
  uncachedInputTokens: 7,
  cacheReadInputTokens: 3,
  cacheWriteInputTokens: [{ writeClass: 'short', tokens: 2 }],
  outputTokens: 5,
  separatelyBilledReasoningTokens: 0,
  reasoningTokens: 1,
};

function fixture(scenario: ProviderScenario) {
  const terminal: ProviderEvent =
    scenario === 'refused'
      ? { type: 'refused', usage: unknownUsage, requestId: null }
      : scenario === 'incomplete'
        ? { type: 'incomplete', reason: 'output-limit', usage: unknownUsage, requestId: null }
        : {
            type: 'completed',
            text: 'hello',
            usage: scenario === 'unknown-usage' ? unknownUsage : knownUsage,
            requestId: null,
          };
  return new FixtureAiProvider(
    { [profile.model]: capabilities },
    scenario === 'partial'
      ? [{ type: 'text-delta', text: 'hello' }]
      : [{ type: 'text-delta', text: 'hello' }, terminal],
  );
}

providerContractSuite(
  'SDK-free implementation / shared neutral provider contract',
  fixture,
  request,
);

// Test-only consumer of the real application registry/port. Run orchestration is
// implemented in C07; this harness proves the dependency contract without inventing it.
async function consume(registry: AiProviderRegistry) {
  const { adapter } = registry.resolve();
  try {
    for await (const input of adapter.stream(request(), new AbortController().signal)) {
      const event = providerEventSchema.parse(input);
      if (event.type !== 'text-delta') return event;
    }
  } catch (error) {
    if (error instanceof AiProviderError) return error.failure;
    throw error;
  }
  throw new Error('Missing terminal event.');
}

describe('provider-neutral application consumption', () => {
  it.each(['completed', 'refused', 'incomplete', 'unknown-usage'] as const)(
    'consumes %s through the application registry using only neutral events',
    async (scenario) => {
      const adapter = fixture(scenario);
      const result = await consume(new AiProviderRegistry('test', policy, [adapter]));
      expect(result).toMatchObject({
        type: scenario === 'unknown-usage' ? 'completed' : scenario,
        usage: scenario === 'completed' ? knownUsage : unknownUsage,
      });
      expect(adapter.calls).toBe(1);
    },
  );
  it('consumes uncertain failures without retrying or treating unknown usage as free', async () => {
    const adapter = fixture('partial');
    expect(await consume(new AiProviderRegistry('test', policy, [adapter]))).toMatchObject({
      code: 'transport',
      execution: 'may-have-started',
      usage: unknownUsage,
    });
    expect(adapter.calls).toBe(1);
  });
  it('retains disjoint usage categories without relying on any SDK billing fields', async () => {
    const usage = knownUsage;
    const adapter = new FixtureAiProvider({ [profile.model]: capabilities }, [
      {
        type: 'completed',
        text: 'hello',
        usage,
        requestId: 'fixture_request',
      },
    ]);
    expect(await consume(new AiProviderRegistry('test', policy, [adapter]))).toEqual({
      type: 'completed',
      text: 'hello',
      usage,
      requestId: 'fixture_request',
    });
  });
  it('does not accept native payload extras as neutral terminal data', () => {
    expect(
      providerEventSchema.safeParse({
        type: 'completed',
        text: 'hello',
        usage: unknownUsage,
        requestId: null,
        nativeResponse: { privateCredential: 'private' },
      }).success,
    ).toBe(false);
  });
});
