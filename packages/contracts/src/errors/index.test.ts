import { describe, expect, it } from 'vitest';

import { ERROR_CODES, errorCodeSchema } from './index.js';

describe('canonical collaboration errors', () => {
  it('defines the complete Phase 1 set including retryable persistence failure', () => {
    expect(Object.values(ERROR_CODES)).toEqual([
      'VALIDATION_ERROR',
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'BOARD_ARCHIVED',
      'VERSION_CONFLICT',
      'IDEMPOTENCY_CONFLICT',
      'INVITE_UNAVAILABLE',
      'INVITE_EXPIRED',
      'INVITE_EXHAUSTED',
      'RATE_LIMITED',
      'TEMPORARILY_UNAVAILABLE',
      'ROOM_FULL',
      'SERVER_BUSY',
      'PAYLOAD_TOO_LARGE',
      'DOCUMENT_INVALID',
      'DOCUMENT_LIMIT',
      'SCHEMA_UNSUPPORTED',
      'UPDATE_ID_REUSED',
      'CAUSAL_GAP',
      'PERSISTENCE_FAILED',
    ]);

    for (const code of Object.values(ERROR_CODES)) {
      expect(errorCodeSchema.parse(code)).toBe(code);
    }
  });
});
