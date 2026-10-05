import { createHmac } from 'node:crypto';
import { aiCreateRunSchema, type AiCreateRun } from '@archboard/contracts';
import { AiPersistenceError, snapshotAiConfiguration, type AiIntent } from './persistence.js';
import type { AiResolvedConfiguration } from './operator-policy.js';
import { estimateAiReservation } from './pricing.js';
import { renderAiPrompt } from './prompt-renderer.js';
import type { NormalizedProviderRequest } from './provider.js';

const KEY_HEX_CHARACTERS = 64;
export const AI_ACCESS_POLICY_VERSION = 'ai-edit-authority-v1';
/** Exact JSON encoding: object order is immaterial; array/text order is preserved. */
export function canonicalAiJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalAiJson).join(',') + ']';
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(
          (key) =>
            JSON.stringify(key) + ':' + canonicalAiJson((value as Record<string, unknown>)[key]),
        )
        .join(',') +
      '}'
    );
  throw new AiPersistenceError('AI_INPUT_TOO_LARGE');
}

export class AiPrivateIdentity {
  readonly #secret: Buffer;
  public constructor(secretHex: string) {
    if (!new RegExp(`^[a-f0-9]{${KEY_HEX_CHARACTERS}}$`, 'i').test(secretHex))
      throw new AiPersistenceError('TEMPORARILY_UNAVAILABLE');
    this.#secret = Buffer.from(secretHex, 'hex');
  }
  private digest(domain: string, value: unknown): string {
    return createHmac('sha256', this.#secret)
      .update(canonicalAiJson([domain, value]))
      .digest('hex');
  }
  public prepare(
    actor: string,
    key: string,
    body: AiCreateRun,
    config: AiResolvedConfiguration,
  ): {
    intent: AiIntent;
    request: NormalizedProviderRequest;
  } {
    const reviewed = aiCreateRunSchema.parse(body);
    const snapshot = snapshotAiConfiguration(config);
    const prompt = renderAiPrompt(reviewed);
    // Rendered context JSON is canonical too, so equivalent object order never
    // changes either provider input or exact reuse. No text normalization occurs.
    prompt.messages = [{ role: 'user', text: canonicalAiJson(reviewed) }];
    const generation = {
      ...prompt,
      model: snapshot.model,
      maximumOutputTokens: snapshot.maximumOutputTokens,
      maximumResponseBytes: config.policy.cache.payloadBytes,
      promptCache:
        config.profile.promptCaching && config.profile.promptCaching !== 'disabled'
          ? ('stable-prefix' as const)
          : ('disabled' as const),
      ...(config.profile.promptCaching && config.profile.promptCaching !== 'disabled'
        ? {
            cachePartition: this.digest('archboard-ai-provider-partition-v1', {
              deployment: config.policy.deploymentNamespace,
              actor,
              target: reviewed.target,
            }),
          }
        : {}),
    };
    const scope = {
      deployment: config.policy.deploymentNamespace,
      actor,
      target: reviewed.target,
      accessPolicy: AI_ACCESS_POLICY_VERSION,
    };
    return {
      intent: {
        deploymentNamespace: config.policy.deploymentNamespace,
        actorUserId: actor,
        boardId: reviewed.target.kind === 'board' ? reviewed.target.boardId : null,
        key,
        task: reviewed.task,
        snapshot,
        reservation: estimateAiReservation(snapshot, config.policy.limits),
        requestHash: this.digest('archboard-ai-receipt-v1', { scope, reviewed }),
        fingerprint: this.digest('archboard-ai-exact-v1', {
          scope,
          reviewed,
          generation,
          snapshot,
          policy: config.policy,
        }),
      },
      // Coordinator replaces this placeholder with the DB-owned admitted deadline.
      request: { ...generation, deadlineAtUnixMs: 1 },
    };
  }
}
