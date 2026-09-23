import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import {
  ERROR_CODES,
  apiErrorEnvelopeSchema,
  boardDetailResponseSchema,
  boardIdPathSchema,
  boardListQuerySchema,
  boardListResponseSchema,
  createBoardSchema,
  idempotencyKeySchema,
  patchBoardSchema,
  type ErrorCode,
} from '@archboard/contracts';
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ZodError } from 'zod';

import { AUTH_REQUEST_ACTOR, type RequestActor } from '../auth/application/index.js';
import { BoardService, BoardServiceError } from './application/board-service.js';
import { IdempotencyConflictError } from './infrastructure/idempotency.js';

function errorStatus(code: ErrorCode): number {
  switch (code) {
    case ERROR_CODES.NOT_FOUND:
      return HttpStatus.NOT_FOUND;
    case ERROR_CODES.FORBIDDEN:
      return HttpStatus.FORBIDDEN;
    case ERROR_CODES.VERSION_CONFLICT:
    case ERROR_CODES.IDEMPOTENCY_CONFLICT:
    case ERROR_CODES.BOARD_ARCHIVED:
      return HttpStatus.CONFLICT;
    case ERROR_CODES.RATE_LIMITED:
      return HttpStatus.TOO_MANY_REQUESTS;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

function fail(code: ErrorCode, message: string, status: number): never {
  throw new HttpException(
    apiErrorEnvelopeSchema.parse({
      error: { code, message, requestId: randomUUID() },
    }),
    status,
  );
}

function validate<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      fail(ERROR_CODES.VALIDATION_ERROR, 'Invalid board request.', HttpStatus.BAD_REQUEST);
    }
    throw error;
  }
}

async function safe<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HttpException) throw error;
    if (error instanceof BoardServiceError)
      fail(error.code, error.message, errorStatus(error.code));
    if (error instanceof IdempotencyConflictError) {
      fail(ERROR_CODES.IDEMPOTENCY_CONFLICT, error.message, HttpStatus.CONFLICT);
    }
    fail(
      ERROR_CODES.TEMPORARILY_UNAVAILABLE,
      'Board service is temporarily unavailable.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

@Controller('api/v1/boards')
export class BoardsController {
  public constructor(
    @Inject(AUTH_REQUEST_ACTOR) private readonly actor: RequestActor,
    @Inject(BoardService) private readonly boards: BoardService,
  ) {}

  @Post()
  public async create(
    @Req() request: IncomingMessage,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    const session = await this.actor.require(request.headers);
    return safe(async () => {
      const parsedKey = validate(idempotencyKeySchema, key);
      const input = validate(createBoardSchema, body);
      const result = await this.boards.create(session.user.id, parsedKey, input);
      return boardDetailResponseSchema.parse({ data: result.board });
    });
  }

  @Get()
  public async list(@Req() request: IncomingMessage, @Query() query: unknown) {
    const session = await this.actor.require(request.headers);
    return safe(async () =>
      boardListResponseSchema.parse({
        ...(await this.boards.list(session.user.id, validate(boardListQuerySchema, query))),
      }),
    );
  }

  @Get(':id')
  public async read(@Req() request: IncomingMessage, @Param() path: unknown) {
    const session = await this.actor.require(request.headers);
    return safe(async () => {
      const { id } = validate(boardIdPathSchema, path);
      return boardDetailResponseSchema.parse({ data: await this.boards.read(session.user.id, id) });
    });
  }

  @Patch(':id')
  public async update(
    @Req() request: IncomingMessage,
    @Param() path: unknown,
    @Body() body: unknown,
  ) {
    const session = await this.actor.require(request.headers);
    return safe(async () => {
      const { id } = validate(boardIdPathSchema, path);
      const input = validate(patchBoardSchema, body);
      return boardDetailResponseSchema.parse({
        data: await this.boards.update(session.user.id, id, input),
      });
    });
  }
}
