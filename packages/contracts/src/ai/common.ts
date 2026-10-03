import { z } from 'zod';

import { applicationIdSchema } from '../graph/index.js';
import { MAX_AI_SEMANTIC_KEY_CHARACTERS, MAX_AI_TEXT_CHARACTERS } from '../limits/index.js';

export const AI_SCHEMA_VERSION = 1 as const;
const MAX_UNSIGNED_DECIMAL_DIGITS = 20;
// Logical keys are deliberately disjoint from application UUIDs.
export const aiSemanticKeySchema = z
  .string()
  .max(MAX_AI_SEMANTIC_KEY_CHARACTERS)
  .regex(/^[A-Za-z][A-Za-z0-9_-]*$/)
  .refine(
    (key) => !applicationIdSchema.safeParse(key).success,
    'Semantic keys must not be graph UUIDs.',
  );
export const aiTextSchema = z.string().max(MAX_AI_TEXT_CHARACTERS);
export const aiNonblankTextSchema = aiTextSchema.refine((text) => text.trim().length > 0);
export const aiUnsignedDecimalSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .max(MAX_UNSIGNED_DECIMAL_DIGITS);

export function aiJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function aiByteLimit<T extends z.ZodType>(schema: T, maximum: number) {
  return schema.refine((value) => aiJsonBytes(value) <= maximum, {
    message: `Encoded JSON must not exceed ${maximum} UTF-8 bytes.`,
  });
}

export function aiUniqueKeys(
  items: readonly { key: string }[],
  path: string[],
  context: z.RefinementCtx,
): Set<string> {
  const keys = new Set<string>();
  items.forEach(({ key }, index) => {
    if (keys.has(key))
      context.addIssue({
        code: 'custom',
        path: [...path, index, 'key'],
        message: 'Keys must be unique.',
      });
    keys.add(key);
  });
  return keys;
}

export function aiReferences(
  references: readonly string[],
  targets: ReadonlySet<string>,
  path: (string | number)[],
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  references.forEach((key, index) => {
    if (!targets.has(key) || seen.has(key))
      context.addIssue({
        code: 'custom',
        path: [...path, index],
        message: 'Reference must resolve to a unique target of the correct kind.',
      });
    seen.add(key);
  });
}

// A server token counter must count rendered instructions/schema/history and overhead.
// These facts are never accepted as authority from the public create request.
export const aiTokenPreflightSchema = z
  .strictObject({
    inputTokensUpperBound: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    maximumInputTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    maximumOutputTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    contextWindowTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    countingVersion: z.string().min(1).max(MAX_AI_SEMANTIC_KEY_CHARACTERS),
  })
  .refine(
    (value) =>
      value.inputTokensUpperBound <= value.maximumInputTokens &&
      value.inputTokensUpperBound <= value.contextWindowTokens - value.maximumOutputTokens,
    { message: 'Rendered input and reserved output exceed the configured token budget.' },
  );

export type AiSemanticKey = z.infer<typeof aiSemanticKeySchema>;
export type AiTokenPreflight = z.infer<typeof aiTokenPreflightSchema>;
