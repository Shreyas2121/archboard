import { z } from 'zod';

import { errorCodeSchema } from '../errors/index.js';

export const idempotencyKeySchema = z.uuid();
export const utcTimestampSchema = z.iso.datetime({ offset: false });

export const apiErrorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: errorCodeSchema,
    message: z.string().min(1),
    fieldErrors: z.record(z.string(), z.array(z.string().min(1)).min(1)).optional(),
    requestId: z.string().min(1),
  }),
});

export function objectEnvelopeSchema<T extends z.ZodType>(data: T) {
  return z.strictObject({ data });
}

export function collectionEnvelopeSchema<T extends z.ZodType, C extends z.ZodType>(
  data: T,
  cursor: C,
) {
  return z.strictObject({ data: z.array(data), nextCursor: cursor.nullable() });
}

export type ApiErrorEnvelope = z.infer<typeof apiErrorEnvelopeSchema>;
export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;
