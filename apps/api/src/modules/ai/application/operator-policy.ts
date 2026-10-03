import type { AiProviderId } from './provider.js';

export const AI_VERSIONS = Object.freeze({
  prompt: 'ai-prompt-v1',
  schema: 'ai-schema-v1',
  adapter: 'ai-adapter-v1',
  policy: 'ai-policy-v1',
});
export interface AiModelProfile {
  readonly quality: 'standard' | 'higher';
  readonly model: string;
  readonly pricingVersion: string;
  readonly tokenCountingVersion: string;
  readonly contextWindowTokens: number;
  readonly maximumInputTokens: number;
  readonly maximumOutputTokens: number;
  readonly structuredOutput: boolean;
  readonly prices: {
    readonly uncachedInputMicroUsdPerMillion: string;
    readonly cacheReadMicroUsdPerMillion: string;
    readonly cacheWrites: readonly {
      readonly writeClass: string;
      readonly microUsdPerMillion: string;
    }[];
    readonly outputMicroUsdPerMillion: string;
    readonly separateReasoningMicroUsdPerMillion: string | null;
  };
}
export interface AiPolicy {
  readonly deploymentNamespace: string;
  readonly configurationVersion: string;
  readonly fingerprint: string;
  readonly provider: AiProviderId;
  readonly defaultModel: string;
  readonly profiles: readonly AiModelProfile[];
  readonly versions: typeof AI_VERSIONS;
  readonly limits: {
    readonly createPerMinute: number;
    readonly createBurst: number;
    readonly freshPerMinute: number;
    readonly freshPerDay: number;
    readonly actorConcurrency: number;
    readonly globalConcurrency: number;
    readonly providerRequestsPerMinute: number;
    readonly providerInputTokensPerMinute: number;
    readonly providerOutputTokensPerMinute: number;
    readonly deadlineMs: number;
    readonly repairs: number;
    readonly rejectionRetries: number;
    readonly pollsPerMinute: number;
    readonly sseConnectionsPerActor: number;
  };
  readonly budgets: {
    readonly dailyMicroUsd: string;
    readonly monthlyMicroUsd: string;
    readonly globalMicroUsd: string;
    readonly actorDailyMicroUsd: string | null;
  };
  readonly cache: {
    readonly ttlMs: number;
    readonly entries: number;
    readonly actorEntries: number;
    readonly bytes: number;
    readonly actorBytes: number;
    readonly payloadBytes: number;
    readonly receiptTtlMs: number;
    readonly readsWhenDisabled: false;
    readonly promptCaching: 'disabled';
  };
}
export interface AiResolvedConfiguration {
  readonly provider: AiProviderId;
  readonly profile: AiModelProfile;
  readonly policy: AiPolicy;
}
