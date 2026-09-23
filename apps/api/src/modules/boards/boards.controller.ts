import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import {
  ERROR_CODES,
  apiErrorEnvelopeSchema,
  boardDetailResponseSchema,
  boardIdPathSchema,
  boardListQuerySchema,
  boardListResponseSchema,
  boardMemberResponseSchema,
  boardMembersResponseSchema,
  boardInviteListResponseSchema,
  boardInviteResponseSchema,
  boardVersionRequestSchema,
  changeMemberRoleSchema,
  createBoardSchema,
  createInviteSchema,
  duplicateBoardSchema,
  idempotencyKeySchema,
  inviteListQuerySchema,
  invitePathSchema,
  memberPathSchema,
  patchBoardSchema,
  type ErrorCode,
} from '@archboard/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpException,
  HttpCode,
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
import { InviteService } from './application/invite-service.js';
import { IdempotencyConflictError } from './infrastructure/idempotency.js';

function errorStatus(code: ErrorCode): number {
  switch (code) {
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
    case ERROR_CODES.RATE_LIMITED:
      return HttpStatus.TOO_MANY_REQUESTS;
    default:
      return HttpStatus.BAD_REQUEST;
  }
}

export function fail(code: ErrorCode, message: string, status: number): never {
  throw new HttpException(
    apiErrorEnvelopeSchema.parse({
      error: { code, message, requestId: randomUUID() },
    }),
    status,
  );
}

export function validate<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      fail(ERROR_CODES.VALIDATION_ERROR, 'Invalid board request.', HttpStatus.BAD_REQUEST);
    }
    throw error;
  }
}

export async function safe<T>(work: () => Promise<T>): Promise<T> {
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
    @Inject(InviteService) private readonly invites: InviteService,
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

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  public async archive(
    @Req() request: IncomingMessage,
    @Param() path: unknown,
    @Body() body: unknown,
  ) {
    const session = await this.actor.require(request.headers);
    return safe(async () => {
      const { id } = validate(boardIdPathSchema, path);
      const input = validate(boardVersionRequestSchema, body);
      return boardDetailResponseSchema.parse({
        data: await this.boards.archive(session.user.id, id, input),
      });
    });
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  public async restore(
    @Req() request: IncomingMessage,
    @Param() path: unknown,
    @Body() body: unknown,
  ) {
    const session = await this.actor.require(request.headers);
    return safe(async () => {
      const { id } = validate(boardIdPathSchema, path);
      const input = validate(boardVersionRequestSchema, body);
      return boardDetailResponseSchema.parse({
        data: await this.boards.restore(session.user.id, id, input),
      });
    });
  }

  @Post(':id/duplicate')
  public async duplicate(
    @Req() request: IncomingMessage,
    @Param() path: unknown,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    const session = await this.actor.require(request.headers);
    return safe(async () => {
      const { id } = validate(boardIdPathSchema, path);
      const parsedKey = validate(idempotencyKeySchema, key);
      const input = validate(duplicateBoardSchema, body);
      const result = await this.boards.duplicate(session.user.id, id, parsedKey, input);
      return boardDetailResponseSchema.parse({ data: result.board });
    });
  }

  @Get(':id/members')
  public async members(@Req() request: IncomingMessage, @Param() path: unknown) {
    const session = await this.actor.require(request.headers);
    return safe(async () => {
      const { id } = validate(boardIdPathSchema, path);
      return boardMembersResponseSchema.parse({
        data: await this.boards.members(session.user.id, id),
        nextCursor: null,
      });
    });
  }

  @Patch(':id/members/:userId')
  public async changeMemberRole(
    @Req() request: IncomingMessage,
    @Param() path: unknown,
    @Body() body: unknown,
  ) {
    const session = await this.actor.require(request.headers);
    return safe(async () => {
      const { id, userId } = validate(memberPathSchema, path);
      const input = validate(changeMemberRoleSchema, body);
      return boardMemberResponseSchema.parse({
        data: await this.boards.changeMemberRole(session.user.id, id, userId, input),
      });
    });
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async removeMember(@Req() request: IncomingMessage, @Param() path: unknown) {
    const session = await this.actor.require(request.headers);
    return safe(async () => {
      const { id, userId } = validate(memberPathSchema, path);
      await this.boards.removeMember(session.user.id, id, userId);
    });
  }

  @Get(':id/invites')
  public async listInvites(
    @Req() request: IncomingMessage,
    @Param() path: unknown,
    @Query() query: unknown,
  ) {
    const session = await this.actor.require(request.headers);
    return safe(async () => {
      const { id } = validate(boardIdPathSchema, path);
      const parsed = validate(inviteListQuerySchema, query);
      return boardInviteListResponseSchema.parse(
        await this.invites.list(session.user.id, id, parsed),
      );
    });
  }

  @Post(':id/invites')
  public async createInvite(
    @Req() request: IncomingMessage,
    @Param() path: unknown,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    const session = await this.actor.require(request.headers);
    return safe(async () => {
      const { id } = validate(boardIdPathSchema, path);
      const parsedKey = validate(idempotencyKeySchema, key);
      const input = validate(createInviteSchema, body);
      return boardInviteResponseSchema.parse({
        data: await this.invites.create(session.user.id, id, parsedKey, input),
      });
    });
  }

  @Delete(':id/invites/:inviteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async revokeInvite(@Req() request: IncomingMessage, @Param() path: unknown) {
    const session = await this.actor.require(request.headers);
    return safe(async () => {
      const { id, inviteId } = validate(invitePathSchema, path);
      await this.invites.revoke(session.user.id, id, inviteId);
    });
  }
}
