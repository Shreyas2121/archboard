import { apiErrorEnvelopeSchema, ERROR_CODES } from '@archboard/contracts';
import { HttpException, HttpStatus } from '@nestjs/common';

import type { AuthSessionLookup } from '../application/index.js';
import { BetterAuthRequestActor } from './better-auth-request-actor.js';

describe('request actor boundary', () => {
  it('maps missing sessions to a safe 401 and lookup failures to a safe 503', async () => {
    const missing = new BetterAuthRequestActor({ lookup: async () => null });
    const unavailable = new BetterAuthRequestActor({
      lookup: async () => {
        throw new Error('database connection with sensitive details');
      },
    });

    for (const [service, expectedStatus, expectedCode] of [
      [missing, HttpStatus.UNAUTHORIZED, ERROR_CODES.UNAUTHENTICATED],
      [unavailable, HttpStatus.SERVICE_UNAVAILABLE, ERROR_CODES.TEMPORARILY_UNAVAILABLE],
    ] as const) {
      try {
        await service.require({ 'x-user-id': 'forged-user' });
        throw new Error('Expected actor resolution to fail.');
      } catch (error) {
        expect(error).toBeInstanceOf(HttpException);
        const exception = error as HttpException;
        expect(exception.getStatus()).toBe(expectedStatus);
        const envelope = apiErrorEnvelopeSchema.parse(exception.getResponse());
        expect(envelope.error.code).toBe(expectedCode);
        expect(envelope.error.requestId).toBeTruthy();
        expect(JSON.stringify(envelope)).not.toContain('sensitive details');
      }
    }
  });

  it('returns the trusted session without using an actor header', async () => {
    const actor = {
      userId: 'trusted-user',
      user: { id: 'trusted-user', name: 'User', email: 'user@example.test', image: null },
    };
    const lookup: AuthSessionLookup = { lookup: async () => actor };
    const service = new BetterAuthRequestActor(lookup);
    await expect(service.require({ 'x-user-id': 'forged-user' })).resolves.toBe(actor);
  });
});
