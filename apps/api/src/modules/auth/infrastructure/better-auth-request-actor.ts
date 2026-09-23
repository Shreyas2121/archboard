import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

import { apiErrorEnvelopeSchema, ERROR_CODES } from '@archboard/contracts';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';

import {
  AUTH_SESSION_LOOKUP,
  type AuthenticatedSession,
  type AuthSessionLookup,
  type RequestActor,
} from '../application/index.js';

function safeError(code: 'UNAUTHENTICATED' | 'TEMPORARILY_UNAVAILABLE', message: string) {
  return apiErrorEnvelopeSchema.parse({
    error: { code, message, requestId: randomUUID() },
  });
}

@Injectable()
export class BetterAuthRequestActor implements RequestActor {
  public constructor(@Inject(AUTH_SESSION_LOOKUP) private readonly lookup: AuthSessionLookup) {}

  public async require(headers: IncomingHttpHeaders): Promise<AuthenticatedSession> {
    let session: AuthenticatedSession | null;
    try {
      session = await this.lookup.lookup(fromNodeHeaders(headers));
    } catch {
      throw new HttpException(
        safeError(
          ERROR_CODES.TEMPORARILY_UNAVAILABLE,
          'Authentication is temporarily unavailable.',
        ),
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (session === null) {
      throw new HttpException(
        safeError(ERROR_CODES.UNAUTHENTICATED, 'Sign in to continue.'),
        HttpStatus.UNAUTHORIZED,
      );
    }
    return session;
  }
}
