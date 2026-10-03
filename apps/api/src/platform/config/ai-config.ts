import { createHash } from 'node:crypto';
import { z } from 'zod';
import { KIBIBYTE, MEBIBYTE, MAX_AI_RESULT_BYTES } from '@archboard/contracts';
import {
  AI_VERSIONS,
  type AiPolicy,
  type AiModelProfile,
} from '../../modules/ai/application/index.js';

const MAX_PROFILE_KIBIBYTES = 64;
const MAX_PROFILE_BYTES = MAX_PROFILE_KIBIBYTES * KIBIBYTE;
const MAX_IDENTIFIER_CHARACTERS = 128;
const MAX_PROFILES = 2;
const MAX_CACHE_WRITE_CLASSES = 16;
const MAX_KEY_CHARACTERS = 512;
const MIN_KEY_CHARACTERS = 32;
const MAX_BIGINT = 9_223_372_036_854_775_807n;
const MAX_DECIMAL_CHARACTERS = 19;
const MAX_LIMIT = 1_000_000;
const MAX_TOKEN_LIMIT = 10_000_000;
const MAX_DEADLINE_MS = 120_000;
const RESULT_TTL_MS = 900_000;
const RECEIPT_TTL_MS = 86_400_000;
const CACHE_ENTRIES = 128;
const ACTOR_CACHE_ENTRIES = 16;
const CACHE_MEBIBYTES = 16;
const ACTOR_CACHE_MEBIBYTES = 4;
const MAX_CACHE_MEBIBYTES = 64;
const MAX_CACHE_BYTES = MAX_CACHE_MEBIBYTES * MEBIBYTE;
const CREATE_PER_MINUTE = 10;
const CREATE_BURST = 3;
const FRESH_PER_MINUTE = 3;
const FRESH_PER_DAY = 20;
const GLOBAL_CONCURRENCY = 2;
const POLLS_PER_MINUTE = 30;
const SSE_CONNECTIONS = 2;
const DAILY_BUDGET_MICRO_USD = '1000000';
const MONTHLY_BUDGET_MICRO_USD = '5000000';
const GLOBAL_BUDGET_MICRO_USD = '10000000';
const PROVIDER_RPM = 2;
const PROVIDER_INPUT_TPM = 60_000;
const PROVIDER_OUTPUT_TPM = 10_000;

export class AiConfigurationError extends Error {
  public readonly variables: readonly string[];
  public constructor(variables: readonly string[]) {
    super(
      `Invalid AI configuration: ${[...new Set(variables)].join(', ')}. Check the operator settings.`,
    );
    this.name = 'AiConfigurationError';
    this.variables = Object.freeze([...new Set(variables)]);
  }
}

const identifier = z
  .string()
  .min(1)
  .max(MAX_IDENTIFIER_CHARACTERS)
  .regex(/^[A-Za-z0-9_.:-]+$/);
const microUsd = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .max(MAX_DECIMAL_CHARACTERS)
  .refine(
    (value) =>
      /^[0-9]+$/.test(value) &&
      value.length <= MAX_DECIMAL_CHARACTERS &&
      BigInt(value) <= MAX_BIGINT,
  );
const positiveMoney = microUsd.refine((value) => value !== '0');
const tokenLimit = z.number().int().positive().max(MAX_TOKEN_LIMIT);
export const aiModelProfileSchema = z
  .strictObject({
    quality: z.enum(['standard', 'higher']),
    model: identifier,
    pricingVersion: identifier,
    tokenCountingVersion: identifier,
    contextWindowTokens: tokenLimit,
    maximumInputTokens: tokenLimit,
    maximumOutputTokens: tokenLimit,
    structuredOutput: z.boolean(),
    prices: z.strictObject({
      uncachedInputMicroUsdPerMillion: positiveMoney,
      cacheReadMicroUsdPerMillion: microUsd,
      cacheWrites: z
        .array(z.strictObject({ writeClass: identifier, microUsdPerMillion: microUsd }))
        .max(MAX_CACHE_WRITE_CLASSES),
      outputMicroUsdPerMillion: positiveMoney,
      separateReasoningMicroUsdPerMillion: microUsd.nullable(),
    }),
  })
  .superRefine((profile, context) => {
    if (profile.maximumInputTokens > profile.contextWindowTokens - profile.maximumOutputTokens)
      context.addIssue({
        code: 'custom',
        path: ['maximumInputTokens'],
        message: 'Invalid token window.',
      });
    if (
      new Set(profile.prices.cacheWrites.map((entry) => entry.writeClass)).size !==
      profile.prices.cacheWrites.length
    )
      context.addIssue({
        code: 'custom',
        path: ['prices', 'cacheWrites'],
        message: 'Duplicate write classes.',
      });
  });

const profileListSchema = z
  .array(aiModelProfileSchema)
  .min(1)
  .max(MAX_PROFILES)
  .superRefine((profiles, context) => {
    if (
      new Set(profiles.map((profile) => profile.quality)).size !== profiles.length ||
      new Set(profiles.map((profile) => profile.model)).size !== profiles.length ||
      !profiles.some((profile) => profile.quality === 'standard')
    )
      context.addIssue({
        code: 'custom',
        message: 'Profiles require distinct models/qualities and a standard profile.',
      });
  });

function integer(defaultValue: number | undefined, maximum = MAX_LIMIT) {
  const schema = z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .transform(Number)
    .pipe(z.number().int().positive().max(maximum));
  return defaultValue === undefined ? schema : schema.default(defaultValue);
}
const optionalMoney = z.preprocess(
  (value) => (value === '' ? undefined : value),
  positiveMoney.optional(),
);
const activeEnvironmentSchema = z.strictObject({
  AI_PROVIDER: z.literal('openai'),
  AI_MODEL: identifier,
  AI_CONFIG_VERSION: identifier,
  AI_DEPLOYMENT_NAMESPACE: identifier,
  AI_CONTENT_KEY_VERSION: identifier,
  OPENAI_API_KEY: z
    .string()
    .min(MIN_KEY_CHARACTERS)
    .max(MAX_KEY_CHARACTERS)
    .regex(/^[!-~]+$/)
    .refine((key) => !key.startsWith('replace-with-')),
  AI_CACHE_KEY_SECRET: z.string().regex(/^[a-f0-9]{64}$/i),
  AI_CONTENT_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
  AI_DAILY_BUDGET_MICRO_USD: positiveMoney.default(DAILY_BUDGET_MICRO_USD),
  AI_MONTHLY_BUDGET_MICRO_USD: positiveMoney.default(MONTHLY_BUDGET_MICRO_USD),
  AI_GLOBAL_BUDGET_MICRO_USD: positiveMoney.default(GLOBAL_BUDGET_MICRO_USD),
  AI_ACTOR_DAILY_BUDGET_MICRO_USD: optionalMoney,
  AI_CREATE_PER_MINUTE: integer(CREATE_PER_MINUTE),
  AI_CREATE_BURST: integer(CREATE_BURST),
  AI_FRESH_PER_MINUTE: integer(FRESH_PER_MINUTE),
  AI_FRESH_PER_DAY: integer(FRESH_PER_DAY),
  AI_ACTOR_CONCURRENCY: integer(1),
  AI_GLOBAL_CONCURRENCY: integer(GLOBAL_CONCURRENCY),
  AI_PROVIDER_RPM: integer(PROVIDER_RPM),
  AI_PROVIDER_INPUT_TPM: integer(PROVIDER_INPUT_TPM, MAX_TOKEN_LIMIT),
  AI_PROVIDER_OUTPUT_TPM: integer(PROVIDER_OUTPUT_TPM, MAX_TOKEN_LIMIT),
  AI_DEADLINE_MS: integer(MAX_DEADLINE_MS, MAX_DEADLINE_MS),
  AI_REPAIRS: z.enum(['0', '1']).default('1').transform(Number),
  AI_REJECTION_RETRIES: z.enum(['0', '1']).default('1').transform(Number),
  AI_POLLS_PER_MINUTE: integer(POLLS_PER_MINUTE),
  AI_SSE_CONNECTIONS_PER_ACTOR: integer(SSE_CONNECTIONS),
  AI_CACHE_TTL_MS: integer(RESULT_TTL_MS, RECEIPT_TTL_MS),
  AI_CACHE_ENTRIES: integer(CACHE_ENTRIES),
  AI_CACHE_ACTOR_ENTRIES: integer(ACTOR_CACHE_ENTRIES),
  AI_CACHE_BYTES: integer(CACHE_MEBIBYTES * MEBIBYTE, MAX_CACHE_BYTES),
  AI_CACHE_ACTOR_BYTES: integer(ACTOR_CACHE_MEBIBYTES * MEBIBYTE, MAX_CACHE_BYTES),
});
export const AI_ENVIRONMENT_VARIABLES = Object.freeze([
  'AI_ENABLED',
  'AI_MODEL_PROFILES',
  ...Object.keys(activeEnvironmentSchema.shape),
]);

export type AiOperatorConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly policy: AiPolicy;
      readonly contentKeyVersion: string;
      readonly secrets: {
        readonly openaiApiKey: string;
        readonly cacheKeySecret: string;
        readonly contentEncryptionKey: string;
      };
    };

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export function loadAiConfig(environment: NodeJS.ProcessEnv): AiOperatorConfig {
  const publicNames = Object.keys(environment).filter(
    (name) => name.startsWith('VITE_') && /(^|_)(AI|OPENAI|ANTHROPIC)(_|$)/.test(name),
  );
  if (publicNames.length > 0) throw new AiConfigurationError(publicNames);
  const enabled = environment.AI_ENABLED;
  if (enabled === undefined || enabled === '' || enabled === 'false')
    return Object.freeze({ enabled: false });
  if (enabled !== 'true') throw new AiConfigurationError(['AI_ENABLED']);
  const parsed = activeEnvironmentSchema.safeParse(
    Object.fromEntries(
      Object.keys(activeEnvironmentSchema.shape).map((key) => [
        key,
        environment[key] === '' ? undefined : environment[key],
      ]),
    ),
  );
  if (!parsed.success)
    throw new AiConfigurationError(parsed.error.issues.map((issue) => String(issue.path[0])));
  const values = parsed.data;
  let profiles: AiModelProfile[];
  try {
    const text = environment.AI_MODEL_PROFILES;
    if (!text || new TextEncoder().encode(text).byteLength > MAX_PROFILE_BYTES) throw new Error();
    profiles = profileListSchema.parse(JSON.parse(text));
  } catch {
    throw new AiConfigurationError(['AI_MODEL_PROFILES']);
  }
  const errors: string[] = [];
  if (!profiles.some((profile) => profile.model === values.AI_MODEL)) errors.push('AI_MODEL');
  if (
    values.AI_CACHE_KEY_SECRET.toLowerCase() === values.AI_CONTENT_ENCRYPTION_KEY.toLowerCase() ||
    values.OPENAI_API_KEY === values.AI_CACHE_KEY_SECRET ||
    values.OPENAI_API_KEY === values.AI_CONTENT_ENCRYPTION_KEY
  )
    errors.push('AI_CACHE_KEY_SECRET', 'AI_CONTENT_ENCRYPTION_KEY');
  if (values.AI_ACTOR_CONCURRENCY > values.AI_GLOBAL_CONCURRENCY)
    errors.push('AI_ACTOR_CONCURRENCY');
  if (values.AI_CREATE_BURST > values.AI_CREATE_PER_MINUTE) errors.push('AI_CREATE_BURST');
  if (values.AI_FRESH_PER_MINUTE > values.AI_FRESH_PER_DAY) errors.push('AI_FRESH_PER_MINUTE');
  if (
    values.AI_CACHE_ACTOR_ENTRIES > values.AI_CACHE_ENTRIES ||
    values.AI_CACHE_ACTOR_BYTES > values.AI_CACHE_BYTES ||
    values.AI_CACHE_BYTES < MAX_AI_RESULT_BYTES ||
    values.AI_CACHE_ACTOR_BYTES < MAX_AI_RESULT_BYTES
  )
    errors.push(
      'AI_CACHE_ENTRIES',
      'AI_CACHE_ACTOR_ENTRIES',
      'AI_CACHE_BYTES',
      'AI_CACHE_ACTOR_BYTES',
    );
  if (
    profiles.some(
      (profile) =>
        profile.maximumInputTokens > values.AI_PROVIDER_INPUT_TPM ||
        profile.maximumOutputTokens > values.AI_PROVIDER_OUTPUT_TPM,
    )
  )
    errors.push('AI_PROVIDER_INPUT_TPM', 'AI_PROVIDER_OUTPUT_TPM');
  if (errors.length) throw new AiConfigurationError(errors);
  const unsignedPolicy = {
    deploymentNamespace: values.AI_DEPLOYMENT_NAMESPACE,
    configurationVersion: values.AI_CONFIG_VERSION,
    provider: values.AI_PROVIDER,
    defaultModel: values.AI_MODEL,
    profiles,
    versions: AI_VERSIONS,
    limits: {
      createPerMinute: values.AI_CREATE_PER_MINUTE,
      createBurst: values.AI_CREATE_BURST,
      freshPerMinute: values.AI_FRESH_PER_MINUTE,
      freshPerDay: values.AI_FRESH_PER_DAY,
      actorConcurrency: values.AI_ACTOR_CONCURRENCY,
      globalConcurrency: values.AI_GLOBAL_CONCURRENCY,
      providerRequestsPerMinute: values.AI_PROVIDER_RPM,
      providerInputTokensPerMinute: values.AI_PROVIDER_INPUT_TPM,
      providerOutputTokensPerMinute: values.AI_PROVIDER_OUTPUT_TPM,
      deadlineMs: values.AI_DEADLINE_MS,
      repairs: values.AI_REPAIRS,
      rejectionRetries: values.AI_REJECTION_RETRIES,
      pollsPerMinute: values.AI_POLLS_PER_MINUTE,
      sseConnectionsPerActor: values.AI_SSE_CONNECTIONS_PER_ACTOR,
    },
    budgets: {
      dailyMicroUsd: values.AI_DAILY_BUDGET_MICRO_USD,
      monthlyMicroUsd: values.AI_MONTHLY_BUDGET_MICRO_USD,
      globalMicroUsd: values.AI_GLOBAL_BUDGET_MICRO_USD,
      actorDailyMicroUsd: values.AI_ACTOR_DAILY_BUDGET_MICRO_USD ?? null,
    },
    cache: {
      ttlMs: values.AI_CACHE_TTL_MS,
      entries: values.AI_CACHE_ENTRIES,
      actorEntries: values.AI_CACHE_ACTOR_ENTRIES,
      bytes: values.AI_CACHE_BYTES,
      actorBytes: values.AI_CACHE_ACTOR_BYTES,
      payloadBytes: MAX_AI_RESULT_BYTES,
      receiptTtlMs: RECEIPT_TTL_MS,
      readsWhenDisabled: false as const,
      promptCaching: 'disabled' as const,
    },
  };
  const policy: AiPolicy = freezeDeep({
    ...unsignedPolicy,
    fingerprint: createHash('sha256').update(canonical(unsignedPolicy)).digest('hex'),
  });
  const config = {
    enabled: true as const,
    policy,
    contentKeyVersion: values.AI_CONTENT_KEY_VERSION,
  };
  // Avoid accidental JSON/inspect serialization of newly introduced AI secrets.
  Object.defineProperty(config, 'secrets', {
    enumerable: false,
    value: Object.freeze({
      openaiApiKey: values.OPENAI_API_KEY,
      cacheKeySecret: values.AI_CACHE_KEY_SECRET.toLowerCase(),
      contentEncryptionKey: values.AI_CONTENT_ENCRYPTION_KEY.toLowerCase(),
    }),
  });
  return Object.freeze(config) as AiOperatorConfig;
}
