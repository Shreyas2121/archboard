import { describe, expect, it } from 'vitest';

import { currentUserResponseSchema, userSummarySchema } from '../auth/index.js';
import { apiErrorEnvelopeSchema, idempotencyKeySchema, objectEnvelopeSchema } from './index.js';

describe('Phase 3 HTTP and identity boundaries', () => {
  it('keeps session data out of safe identity responses', () => {
    const data = { id: 'opaque', name: 'Example', image: null, email: 'user@example.test' };
    expect(currentUserResponseSchema.parse({ data }).data.id).toBe('opaque');
    expect(
      currentUserResponseSchema.safeParse({ data: { ...data, sessionToken: 'secret' } }).success,
    ).toBe(false);
    expect(userSummarySchema.safeParse(data).success).toBe(false);
    expect(
      objectEnvelopeSchema(userSummarySchema).safeParse({
        data: { id: 'opaque', name: 'Example', image: null },
        status: 200,
      }).success,
    ).toBe(false);
  });

  it('requires UUID idempotency keys and safe strict error envelopes', () => {
    expect(idempotencyKeySchema.safeParse('123e4567-e89b-42d3-a456-426614174000').success).toBe(
      true,
    );
    expect(idempotencyKeySchema.safeParse('not-a-uuid').success).toBe(false);
    const error = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        requestId: 'request-1',
        fieldErrors: { title: ['Required'] },
      },
    };
    expect(apiErrorEnvelopeSchema.parse(error)).toEqual(error);
    expect(
      apiErrorEnvelopeSchema.safeParse({ error: { ...error.error, stack: 'SQL internals' } })
        .success,
    ).toBe(false);
    expect(
      apiErrorEnvelopeSchema.safeParse({ error: { ...error.error, code: 'SECRET_LEAK' } }).success,
    ).toBe(false);
    expect(
      apiErrorEnvelopeSchema.safeParse({ error: { ...error.error, requestId: '' } }).success,
    ).toBe(false);
  });
});
