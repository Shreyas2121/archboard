import type { AiPolicy, AiResolvedConfiguration } from './operator-policy.js';
import { AiProviderError, providerCapabilitiesSchema, type AiProvider } from './provider.js';

export class AiProviderRegistry {
  private readonly providers: ReadonlyMap<string, AiProvider>;
  public constructor(
    private readonly mode: 'development' | 'test' | 'production',
    private readonly policy: AiPolicy | null,
    adapters: readonly AiProvider[],
  ) {
    const providers = new Map<string, AiProvider>();
    for (const adapter of adapters) {
      if (
        adapter.id !== 'openai' ||
        (adapter.implementation !== 'production' && adapter.implementation !== 'test-fixture') ||
        providers.has(adapter.id) ||
        (adapter.implementation !== 'production' && mode !== 'test')
      )
        this.unavailable();
      providers.set(adapter.id, adapter);
    }
    this.providers = providers;
  }
  private unavailable(): never {
    throw new AiProviderError({
      code: 'adapter-unavailable',
      execution: 'definitely-unsent',
      usage: { status: 'unknown' },
      retryAfterMs: null,
      requestId: null,
    });
  }
  public resolve(quality?: 'standard' | 'higher'): {
    readonly adapter: AiProvider;
    readonly configuration: AiResolvedConfiguration;
  } {
    if (!this.policy) return this.unavailable();
    const adapter = this.providers.get(this.policy.provider);
    const profile = this.policy.profiles.find((candidate) =>
      quality ? candidate.quality === quality : candidate.model === this.policy?.defaultModel,
    );
    if (!adapter || !profile || (adapter.implementation !== 'production' && this.mode !== 'test'))
      return this.unavailable();
    let capabilities;
    try {
      capabilities = providerCapabilitiesSchema.parse(adapter.capabilities(profile.model));
    } catch {
      throw new AiProviderError({
        code: 'capability-unsupported',
        execution: 'definitely-unsent',
        usage: { status: 'unknown' },
        retryAfterMs: null,
        requestId: null,
      });
    }
    if (
      !capabilities.streaming ||
      !capabilities.schemaVersions.includes(this.policy.versions.schema) ||
      !profile.structuredOutput ||
      !capabilities.structuredOutput ||
      (profile.promptCaching &&
        profile.promptCaching !== 'disabled' &&
        !capabilities.promptCaching) ||
      profile.maximumOutputTokens > capabilities.maximumOutputTokens ||
      profile.maximumInputTokens > capabilities.contextWindowTokens - profile.maximumOutputTokens
    )
      throw new AiProviderError({
        code: 'capability-unsupported',
        execution: 'definitely-unsent',
        usage: { status: 'unknown' },
        retryAfterMs: null,
        requestId: null,
      });
    return Object.freeze({
      adapter,
      configuration: Object.freeze({
        provider: this.policy.provider,
        profile,
        policy: this.policy,
      }),
    });
  }
}
