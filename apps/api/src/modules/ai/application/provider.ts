import { z } from 'zod';
import {
  aiByteLimit,
  aiTaskSchema,
  MAX_AI_REQUEST_BYTES,
  MAX_AI_RESULT_BYTES,
  MAX_AI_TEXT_CHARACTERS,
} from '@archboard/contracts';

export type AiProviderId = 'openai';
export const AI_PROVIDER_ADAPTERS = Symbol('AI_PROVIDER_ADAPTERS');
export const AI_PROVIDER_REGISTRY = Symbol('AI_PROVIDER_REGISTRY');
export const AI_POLICY = Symbol('AI_POLICY');
const MAX_IDENTIFIER_CHARACTERS = 128;
const MAX_CACHE_WRITE_CLASSES = 16;
const MAX_PROVIDER_MESSAGES = 32;

const safeCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const safeIdentifier = z
  .string()
  .min(1)
  .max(MAX_IDENTIFIER_CHARACTERS)
  .regex(/^[A-Za-z0-9_.:-]+$/);
export const normalizedUsageSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('unknown') }),
  z
    .strictObject({
      status: z.literal('known'),
      uncachedInputTokens: safeCount,
      cacheReadInputTokens: safeCount,
      cacheWriteInputTokens: z
        .array(z.strictObject({ writeClass: safeIdentifier, tokens: safeCount }))
        .max(MAX_CACHE_WRITE_CLASSES),
      outputTokens: safeCount,
      // Separate reasoning is charged here only when it is NOT included in output.
      separatelyBilledReasoningTokens: safeCount,
      reasoningTokens: safeCount.nullable(),
    })
    .superRefine((usage, context) => {
      if (
        new Set(usage.cacheWriteInputTokens.map((entry) => entry.writeClass)).size !==
        usage.cacheWriteInputTokens.length
      )
        context.addIssue({
          code: 'custom',
          path: ['cacheWriteInputTokens'],
          message: 'Cache write classes must be disjoint.',
        });
      if (
        usage.reasoningTokens !== null &&
        usage.separatelyBilledReasoningTokens > usage.reasoningTokens
      )
        context.addIssue({
          code: 'custom',
          path: ['separatelyBilledReasoningTokens'],
          message: 'Separately billed reasoning cannot exceed total reasoning.',
        });
    }),
]);
export type NormalizedUsage = z.infer<typeof normalizedUsageSchema>;

export interface ProviderCapabilities {
  readonly streaming: boolean;
  readonly structuredOutput: boolean;
  readonly schemaVersions: readonly string[];
  readonly promptCaching: boolean;
  readonly contextWindowTokens: number;
  readonly maximumOutputTokens: number;
}
export const providerCapabilitiesSchema = z
  .strictObject({
    streaming: z.boolean(),
    structuredOutput: z.boolean(),
    promptCaching: z.boolean(),
    schemaVersions: z.array(safeIdentifier).max(MAX_CACHE_WRITE_CLASSES),
    contextWindowTokens: safeCount.refine((count) => count > 0),
    maximumOutputTokens: safeCount.refine((count) => count > 0),
  })
  .refine((capabilities) => capabilities.maximumOutputTokens <= capabilities.contextWindowTokens);

export const normalizedProviderRequestSchema = aiByteLimit(
  z.strictObject({
    model: safeIdentifier,
    task: aiTaskSchema,
    instructions: z.string().min(1).max(MAX_AI_REQUEST_BYTES),
    messages: z
      .array(
        z.strictObject({
          role: z.enum(['user', 'assistant']),
          text: z.string().max(MAX_AI_REQUEST_BYTES),
        }),
      )
      .min(1)
      .max(MAX_PROVIDER_MESSAGES),
    structuredOutput: z
      .strictObject({
        name: safeIdentifier,
        version: safeIdentifier,
        schema: z.record(z.string(), z.unknown()),
      })
      .optional(),
    maximumOutputTokens: safeCount.refine((count) => count > 0),
    maximumResponseBytes: safeCount.refine((count) => count > 0 && count <= MAX_AI_RESULT_BYTES),
    deadlineAtUnixMs: safeCount.refine((count) => count > 0),
    promptCache: z.enum(['disabled', 'stable-prefix']),
    // Opaque server-generated actor/target partition; never a native provider field.
    cachePartition: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  }),
  MAX_AI_REQUEST_BYTES,
);
export type NormalizedProviderRequest = z.infer<typeof normalizedProviderRequestSchema>;

export type ProviderFailureCode =
  | 'rate-limited'
  | 'invalid-request'
  | 'authentication'
  | 'overloaded'
  | 'transport'
  | 'cancelled'
  | 'deadline'
  | 'capability-unsupported'
  | 'output-too-large'
  | 'adapter-unavailable';
export interface ProviderFailure {
  readonly code: ProviderFailureCode;
  readonly execution: 'definitely-unsent' | 'definite-rejection' | 'may-have-started';
  readonly usage: NormalizedUsage;
  readonly retryAfterMs: number | null;
  readonly requestId: string | null;
}
export const providerFailureSchema = z.strictObject({
  code: z.enum([
    'rate-limited',
    'invalid-request',
    'authentication',
    'overloaded',
    'transport',
    'cancelled',
    'deadline',
    'capability-unsupported',
    'output-too-large',
    'adapter-unavailable',
  ]),
  execution: z.enum(['definitely-unsent', 'definite-rejection', 'may-have-started']),
  usage: normalizedUsageSchema,
  retryAfterMs: safeCount.nullable(),
  requestId: safeIdentifier.nullable(),
});
// No raw provider exception/cause/body is exposed to orchestration or logs.
export class AiProviderError extends Error {
  public readonly failure: ProviderFailure;
  public constructor(failure: ProviderFailure) {
    const parsed = providerFailureSchema.safeParse(failure);
    const safeFailure: ProviderFailure = parsed.success
      ? parsed.data
      : {
          code: 'transport',
          execution: 'may-have-started',
          usage: { status: 'unknown' },
          retryAfterMs: null,
          requestId: null,
        };
    super(`AI provider failure: ${safeFailure.code}`);
    this.failure = Object.freeze(safeFailure);
    this.name = 'AiProviderError';
  }
}

export const providerEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text-delta'), text: z.string().max(MAX_AI_TEXT_CHARACTERS) }),
  z.strictObject({
    type: z.literal('completed'),
    text: z
      .string()
      .refine((text) => new TextEncoder().encode(text).byteLength <= MAX_AI_RESULT_BYTES),
    usage: normalizedUsageSchema,
    requestId: safeIdentifier.nullable(),
  }),
  z.strictObject({
    type: z.literal('refused'),
    usage: normalizedUsageSchema,
    requestId: safeIdentifier.nullable(),
  }),
  z.strictObject({
    type: z.literal('incomplete'),
    reason: z.enum(['output-limit', 'interrupted', 'other']),
    usage: normalizedUsageSchema,
    requestId: safeIdentifier.nullable(),
  }),
]);
export type ProviderEvent = z.infer<typeof providerEventSchema>;

export interface AiProvider {
  readonly id: AiProviderId;
  readonly implementation: 'production' | 'test-fixture';
  capabilities(model: string): ProviderCapabilities;
  stream(request: NormalizedProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
}
