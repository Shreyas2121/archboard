import {
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
  createTemplateBoardSchema,
  createInviteSchema,
  duplicateBoardSchema,
  idempotencyKeySchema,
  inviteListQuerySchema,
  invitePathSchema,
  memberPathSchema,
  patchBoardSchema,
} from '@archboard/contracts';
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedSession } from '../auth/application/index.js';
import { AuthenticatedSessionGuard, CurrentSession } from '../auth/authenticated-session.js';
import { validate } from '../../platform/http/api-boundary.js';
import { BoardService } from './application/board-service.js';
import { InviteService } from './application/invite-service.js';

@UseGuards(AuthenticatedSessionGuard)
@Controller('api/v1/boards')
export class BoardsController {
  public constructor(
    @Inject(BoardService) private readonly boards: BoardService,
    @Inject(InviteService) private readonly invites: InviteService,
  ) {}

  @Post()
  public async create(
    @CurrentSession() session: AuthenticatedSession,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    const parsedKey = validate(idempotencyKeySchema, key);
    const input = validate(createTemplateBoardSchema, body);
    const result = await this.boards.create(session.user.id, parsedKey, input);
    return boardDetailResponseSchema.parse({ data: result.board });
  }

  @Get()
  public async list(@CurrentSession() session: AuthenticatedSession, @Query() query: unknown) {
    return boardListResponseSchema.parse({
      ...(await this.boards.list(session.user.id, validate(boardListQuerySchema, query))),
    });
  }

  @Get(':id')
  public async read(@CurrentSession() session: AuthenticatedSession, @Param() path: unknown) {
    const { id } = validate(boardIdPathSchema, path);
    return boardDetailResponseSchema.parse({ data: await this.boards.read(session.user.id, id) });
  }

  @Patch(':id')
  public async update(
    @CurrentSession() session: AuthenticatedSession,
    @Param() path: unknown,
    @Body() body: unknown,
  ) {
    const { id } = validate(boardIdPathSchema, path);
    const input = validate(patchBoardSchema, body);
    return boardDetailResponseSchema.parse({
      data: await this.boards.update(session.user.id, id, input),
    });
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  public async archive(
    @CurrentSession() session: AuthenticatedSession,
    @Param() path: unknown,
    @Body() body: unknown,
  ) {
    const { id } = validate(boardIdPathSchema, path);
    const input = validate(boardVersionRequestSchema, body);
    return boardDetailResponseSchema.parse({
      data: await this.boards.archive(session.user.id, id, input),
    });
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  public async restore(
    @CurrentSession() session: AuthenticatedSession,
    @Param() path: unknown,
    @Body() body: unknown,
  ) {
    const { id } = validate(boardIdPathSchema, path);
    const input = validate(boardVersionRequestSchema, body);
    return boardDetailResponseSchema.parse({
      data: await this.boards.restore(session.user.id, id, input),
    });
  }

  @Post(':id/duplicate')
  public async duplicate(
    @CurrentSession() session: AuthenticatedSession,
    @Param() path: unknown,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    const { id } = validate(boardIdPathSchema, path);
    const parsedKey = validate(idempotencyKeySchema, key);
    const input = validate(duplicateBoardSchema, body);
    const result = await this.boards.duplicate(session.user.id, id, parsedKey, input);
    return boardDetailResponseSchema.parse({ data: result.board });
  }

  @Get(':id/members')
  public async members(@CurrentSession() session: AuthenticatedSession, @Param() path: unknown) {
    const { id } = validate(boardIdPathSchema, path);
    return boardMembersResponseSchema.parse({
      data: await this.boards.members(session.user.id, id),
      nextCursor: null,
    });
  }

  @Patch(':id/members/:userId')
  public async changeMemberRole(
    @CurrentSession() session: AuthenticatedSession,
    @Param() path: unknown,
    @Body() body: unknown,
  ) {
    const { id, userId } = validate(memberPathSchema, path);
    const input = validate(changeMemberRoleSchema, body);
    return boardMemberResponseSchema.parse({
      data: await this.boards.changeMemberRole(session.user.id, id, userId, input),
    });
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async removeMember(
    @CurrentSession() session: AuthenticatedSession,
    @Param() path: unknown,
  ) {
    const { id, userId } = validate(memberPathSchema, path);
    await this.boards.removeMember(session.user.id, id, userId);
  }

  @Get(':id/invites')
  public async listInvites(
    @CurrentSession() session: AuthenticatedSession,
    @Param() path: unknown,
    @Query() query: unknown,
  ) {
    const { id } = validate(boardIdPathSchema, path);
    const parsed = validate(inviteListQuerySchema, query);
    return boardInviteListResponseSchema.parse(
      await this.invites.list(session.user.id, id, parsed),
    );
  }

  @Post(':id/invites')
  public async createInvite(
    @CurrentSession() session: AuthenticatedSession,
    @Param() path: unknown,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    const { id } = validate(boardIdPathSchema, path);
    const parsedKey = validate(idempotencyKeySchema, key);
    const input = validate(createInviteSchema, body);
    return boardInviteResponseSchema.parse({
      data: await this.invites.create(session.user.id, id, parsedKey, input),
    });
  }

  @Delete(':id/invites/:inviteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async revokeInvite(
    @CurrentSession() session: AuthenticatedSession,
    @Param() path: unknown,
  ) {
    const { id, inviteId } = validate(invitePathSchema, path);
    await this.invites.revoke(session.user.id, id, inviteId);
  }
}
