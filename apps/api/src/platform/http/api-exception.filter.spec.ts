import { ERROR_CODES, apiErrorEnvelopeSchema } from '@archboard/contracts';
import { HttpException, HttpStatus, type ArgumentsHost } from '@nestjs/common';
import { jest } from '@jest/globals';
import { z } from 'zod';
import { BoardServiceError } from '../../modules/boards/application/board-service.js';
import { IdempotencyConflictError } from '../../modules/boards/infrastructure/idempotency.js';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { requestContext } from './api-boundary.js';
import { AiAdmissionError, AiPersistenceError } from '../../modules/ai/application/index.js';

const REQUEST_ID = 'test-request-id';
describe('global HTTP error classification', () => {
  it.each([
    [
      new AiAdmissionError('RATE_LIMITED', 1),
      HttpStatus.TOO_MANY_REQUESTS,
      'Too many AI requests.',
      '1',
    ],
    [
      new AiAdmissionError('RATE_LIMITED'),
      HttpStatus.TOO_MANY_REQUESTS,
      'Too many AI requests.',
      undefined,
    ],
    [
      new AiAdmissionError('AI_ALLOWANCE_REACHED'),
      HttpStatus.TOO_MANY_REQUESTS,
      'AI allowance reached.',
      undefined,
    ],
    [
      new AiAdmissionError('AI_ALLOWANCE_REACHED', 1),
      HttpStatus.TOO_MANY_REQUESTS,
      'AI allowance reached.',
      '1',
    ],
    [
      new AiAdmissionError('AI_DISABLED'),
      HttpStatus.SERVICE_UNAVAILABLE,
      'AI is disabled.',
      undefined,
    ],
  ])(
    'maps safe AI quota errors with only authoritative Retry-After %#',
    (error, status, message, retry) => {
      const exception = error as AiAdmissionError;
      exception.message = 'private provider/SQL content';
      const response = {
        locals: {},
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        setHeader: jest.fn(),
      };
      const host = {
        switchToHttp: () => ({ getResponse: () => response }),
      } as unknown as ArgumentsHost;
      new ApiExceptionFilter().catch(exception, host);
      expect(response.status).toHaveBeenCalledWith(status);
      expect(apiErrorEnvelopeSchema.parse(response.json.mock.calls[0]![0]).error).toMatchObject({
        code: exception.code,
        message,
      });
      if (retry) expect(response.setHeader).toHaveBeenCalledWith('Retry-After', retry);
      else expect(response.setHeader).not.toHaveBeenCalled();
    },
  );
  it.each([
    [
      new AiPersistenceError('AI_RESULT_EXPIRED'),
      HttpStatus.GONE,
      ERROR_CODES.AI_RESULT_EXPIRED,
      'This AI result has expired. Start a new reviewed request.',
    ],
    [
      new AiPersistenceError('AI_INPUT_TOO_LARGE'),
      HttpStatus.PAYLOAD_TOO_LARGE,
      ERROR_CODES.AI_INPUT_TOO_LARGE,
      'The reviewed request exceeds the configured AI model input limit. Reduce context or evidence excerpts, or ask the operator to review the model input limit.',
    ],
    [
      new AiPersistenceError('AI_CAPABILITY_UNSUPPORTED'),
      HttpStatus.BAD_REQUEST,
      ERROR_CODES.AI_CAPABILITY_UNSUPPORTED,
      'The configured AI model cannot support this request. Ask the operator to review the model capabilities and pricing configuration.',
    ],
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
