import { randomUUID } from 'node:crypto';
import { type AiResult } from '@archboard/contracts';
import {
  snapshotAiConfiguration,
  type AiIntent,
  type AiRunRecord,
  type AiSettlement,
} from '../../application/persistence.js';
import { fixtureAiPolicy } from './fixture-config.js';
import { estimateAiReservation } from '../../application/pricing.js';
export const fixturePersistencePolicy = (overrides: NodeJS.ProcessEnv = {}) =>
  fixtureAiPolicy({
    AI_CREATE_BURST: '1000',
    AI_CREATE_PER_MINUTE: '1000',
    AI_FRESH_PER_MINUTE: '1000',
    AI_FRESH_PER_DAY: '1000',
    AI_ACTOR_CONCURRENCY: '100',
    AI_GLOBAL_CONCURRENCY: '100',
    AI_PROVIDER_RPM: '1000',
    AI_PROVIDER_INPUT_TPM: '1000000',
    AI_PROVIDER_OUTPUT_TPM: '1000000',
    AI_DAILY_BUDGET_MICRO_USD: '10000',
    AI_MONTHLY_BUDGET_MICRO_USD: '10000',
    AI_GLOBAL_BUDGET_MICRO_USD: '10000',
    ...overrides,
  });
export const TEST_NAMESPACE = 'fixture-deployment';
export const TEST_ACTOR = 'fixture-actor';
export const KEY_LENGTH = 64;
export const TEST_KEY = 'b'.repeat(KEY_LENGTH);
export const TEST_KEY_VERSION = 'fixture-key-v1';
export function fixtureAiIntent(overrides: Partial<AiIntent> = {}): AiIntent {
  const policy = fixturePersistencePolicy();
  const snapshot = snapshotAiConfiguration({
    provider: 'openai',
    profile: policy.profiles[0]!,
    policy,
  });
  return {
    deploymentNamespace: TEST_NAMESPACE,
    actorUserId: TEST_ACTOR,
    boardId: null,
    key: randomUUID(),
    requestHash: 'a'.repeat(KEY_LENGTH),
    fingerprint: 'c'.repeat(KEY_LENGTH),
    task: 'diagram-described',
    snapshot,
    reservation: estimateAiReservation(snapshot, policy.limits),
    ...overrides,
  };
}
export const fixtureAiResult: AiResult = {
  kind: 'clarification',
  schemaVersion: 1,
  explanation: 'Private result: \u{1F600}',
  questions: ['Which architecture?'],
};
export function fixtureSettlement(
  run: AiRunRecord,
  overrides: Partial<AiSettlement> = {},
): AiSettlement {
  return {
    runId: run.id,
    dispatchToken: run.dispatchToken,
    mode: 'known',
    phase: 'completed',
    actualMicroUsd: '2',
    usage: {
      status: 'known',
      uncachedInputTokens: 1,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: [],
      outputTokens: 1,
      separatelyBilledReasoningTokens: 0,
      reasoningTokens: null,
    },
    failureCode: null,
    ...overrides,
  };
}
