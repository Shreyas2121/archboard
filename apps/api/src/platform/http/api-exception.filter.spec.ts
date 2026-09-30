import { ERROR_CODES, apiErrorEnvelopeSchema } from '@archboard/contracts';
import { HttpException, HttpStatus, type ArgumentsHost } from '@nestjs/common';
import { jest } from '@jest/globals';
import { z } from 'zod';
import { BoardServiceError } from '../../modules/boards/application/board-service.js';
import { IdempotencyConflictError } from '../../modules/boards/infrastructure/idempotency.js';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { requestContext } from './api-boundary.js';

const REQUEST_ID = 'test-request-id';
describe('global HTTP error classification', () => {
  it.each([
    [
      new BoardServiceError(ERROR_CODES.NOT_FOUND, 'Board unavailable.'),
      HttpStatus.NOT_FOUND,
      ERROR_CODES.NOT_FOUND,
      'Board unavailable.',
    ],
    [
      new BoardServiceError(ERROR_CODES.BOARD_ARCHIVED, 'Board archived.'),
      HttpStatus.CONFLICT,
      ERROR_CODES.BOARD_ARCHIVED,
      'Board archived.',
    ],
    [
      new BoardServiceError(ERROR_CODES.INVITE_EXPIRED, 'Invitation expired.'),
      HttpStatus.GONE,
      ERROR_CODES.INVITE_EXPIRED,
      'Invitation expired.',
    ],
    [
      new IdempotencyConflictError(),
      HttpStatus.CONFLICT,
      ERROR_CODES.IDEMPOTENCY_CONFLICT,
      'This idempotency key was already used for a different request.',
    ],
    [
      new Error('secret SQL token'),
      HttpStatus.SERVICE_UNAVAILABLE,
      ERROR_CODES.TEMPORARILY_UNAVAILABLE,
      'Service temporarily unavailable.',
    ],
    [
      z.string().safeParse(0).error!,
      HttpStatus.SERVICE_UNAVAILABLE,
      ERROR_CODES.TEMPORARILY_UNAVAILABLE,
      'Service temporarily unavailable.',
    ],
    [
      { status: HttpStatus.PAYLOAD_TOO_LARGE, message: 'private body' },
      HttpStatus.PAYLOAD_TOO_LARGE,
      ERROR_CODES.PAYLOAD_TOO_LARGE,
      'Request is too large.',
    ],
    [
      new HttpException(
        {
          error: {
            code: ERROR_CODES.UNAUTHENTICATED,
            message: 'Sign in to continue.',
            requestId: 'stale-id',
          },
        },
        HttpStatus.UNAUTHORIZED,
      ),
      HttpStatus.UNAUTHORIZED,
      ERROR_CODES.UNAUTHENTICATED,
      'Sign in to continue.',
    ],
  ])('maps error %# once with the active request ID', (exception, status, code, message) => {
    const json = jest.fn();
    const response = { locals: {}, status: jest.fn().mockReturnThis(), json };
    const host = {
      switchToHttp: () => ({ getResponse: () => response }),
    } as unknown as ArgumentsHost;
    requestContext.run({ requestId: REQUEST_ID }, () =>
      new ApiExceptionFilter().catch(exception, host),
    );
    expect(response.status).toHaveBeenCalledWith(status);
    expect(json).toHaveBeenCalledTimes(1);
    expect(apiErrorEnvelopeSchema.parse(json.mock.calls[0]![0])).toEqual({
      error: { code, message, requestId: REQUEST_ID },
    });
    expect(response.locals).toEqual({ errorCode: code });
  });
});
