import { randomUUID } from 'node:crypto';

import { ERROR_CODES, apiErrorEnvelopeSchema, type ErrorCode } from '@archboard/contracts';
import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';

import { contextSnapshot, errorEnvelope, errorStatus } from './api-boundary.js';
import { BoardServiceError } from '../../modules/boards/application/board-service.js';
import { IdempotencyConflictError } from '../../modules/boards/infrastructure/idempotency.js';

interface ApiResponse {
  locals: Record<string, unknown>;
  status(code: number): ApiResponse;
  json(body: unknown): void;
}

const statusCode: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: ERROR_CODES.VALIDATION_ERROR,
  [HttpStatus.UNAUTHORIZED]: ERROR_CODES.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
  [HttpStatus.CONFLICT]: ERROR_CODES.VERSION_CONFLICT,
  [HttpStatus.GONE]: ERROR_CODES.INVITE_EXPIRED,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ERROR_CODES.PAYLOAD_TOO_LARGE,
  [HttpStatus.TOO_MANY_REQUESTS]: ERROR_CODES.RATE_LIMITED,
  [HttpStatus.SERVICE_UNAVAILABLE]: ERROR_CODES.TEMPORARILY_UNAVAILABLE,
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ApiResponse>();
    // Only documented feature errors expose their safe messages. Unknown exceptions
    // (including response-schema failures) keep the standard unavailable envelope.
    const featureCode =
      exception instanceof BoardServiceError
        ? exception.code
        : exception instanceof IdempotencyConflictError
          ? ERROR_CODES.IDEMPOTENCY_CONFLICT
          : undefined;
    if (featureCode !== undefined && exception instanceof Error) {
      response.locals.errorCode = featureCode;
      response.status(errorStatus(featureCode)).json(errorEnvelope(featureCode, exception.message));
      return;
    }
    const parserStatus =
      typeof exception === 'object' && exception !== null && 'status' in exception
        ? exception.status
        : undefined;
    const rawStatus =
      exception instanceof HttpException
        ? exception.getStatus()
        : parserStatus === HttpStatus.BAD_REQUEST || parserStatus === HttpStatus.PAYLOAD_TOO_LARGE
          ? parserStatus
          : HttpStatus.SERVICE_UNAVAILABLE;
    const parsed =
      exception instanceof HttpException
        ? apiErrorEnvelopeSchema.safeParse(exception.getResponse())
        : null;
    const status =
      parsed?.success || Object.hasOwn(statusCode, rawStatus)
        ? rawStatus
        : HttpStatus.SERVICE_UNAVAILABLE;
    const code = parsed?.success
      ? parsed.data.error.code
      : (statusCode[status] ?? ERROR_CODES.TEMPORARILY_UNAVAILABLE);
    const message = parsed?.success
      ? parsed.data.error.message
      : status === HttpStatus.SERVICE_UNAVAILABLE
        ? 'Service temporarily unavailable.'
        : status === HttpStatus.NOT_FOUND
          ? 'Resource not found.'
          : status === HttpStatus.PAYLOAD_TOO_LARGE
            ? 'Request is too large.'
            : 'Invalid request.';
    response.locals.errorCode = code;
    response
      .status(status)
      .json(errorEnvelope(code, message, contextSnapshot()?.requestId ?? randomUUID()));
  }
}
