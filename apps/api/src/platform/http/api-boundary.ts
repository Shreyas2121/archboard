import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import { ERROR_CODES, apiErrorEnvelopeSchema, type ErrorCode } from '@archboard/contracts';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ZodError } from 'zod';

interface RequestContext {
  requestId: string;
  actorId?: string;
  boardId?: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function recordActor(actorId: string): void {
  const context = requestContext.getStore();
  if (context) context.actorId = actorId;
}

export function contextSnapshot(): RequestContext | undefined {
  return requestContext.getStore();
}

export function errorStatus(code: ErrorCode): number {
  switch (code) {
    case ERROR_CODES.UNAUTHENTICATED:
      return HttpStatus.UNAUTHORIZED;
    case ERROR_CODES.NOT_FOUND:
    case ERROR_CODES.INVITE_UNAVAILABLE:
      return HttpStatus.NOT_FOUND;
    case ERROR_CODES.FORBIDDEN:
      return HttpStatus.FORBIDDEN;
    case ERROR_CODES.VERSION_CONFLICT:
    case ERROR_CODES.IDEMPOTENCY_CONFLICT:
    case ERROR_CODES.BOARD_ARCHIVED:
    case ERROR_CODES.INVITE_EXHAUSTED:
      return HttpStatus.CONFLICT;
    case ERROR_CODES.INVITE_EXPIRED:
      return HttpStatus.GONE;
    case ERROR_CODES.PAYLOAD_TOO_LARGE:
      return HttpStatus.PAYLOAD_TOO_LARGE;
    case ERROR_CODES.RATE_LIMITED:
      return HttpStatus.TOO_MANY_REQUESTS;
    case ERROR_CODES.TEMPORARILY_UNAVAILABLE:
      return HttpStatus.SERVICE_UNAVAILABLE;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

export function errorEnvelope(code: ErrorCode, message: string, requestId?: string) {
  return apiErrorEnvelopeSchema.parse({
    error: { code, message, requestId: requestId ?? contextSnapshot()?.requestId ?? randomUUID() },
  });
}

export function fail(code: ErrorCode, message: string, status = errorStatus(code)): never {
  throw new HttpException(errorEnvelope(code, message), status);
}

export function validate<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try {
    const result = schema.parse(value);
    if (result && typeof result === 'object' && 'id' in result && typeof result.id === 'string') {
      const context = requestContext.getStore();
      if (context) context.boardId = result.id;
    }
    return result;
  } catch (error) {
    if (error instanceof ZodError) {
      fail(ERROR_CODES.VALIDATION_ERROR, 'Invalid request.');
    }
    throw error;
  }
}
