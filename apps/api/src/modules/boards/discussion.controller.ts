import {
  ERROR_CODES,
  boardIdPathSchema,
  commentListQuerySchema,
  commentListResponseSchema,
  commentResponseSchema,
  createCommentSchema,
  createThreadSchema,
  idempotencyKeySchema,
  threadCreateResponseSchema,
  threadListQuerySchema,
  threadListResponseSchema,
  threadPathSchema,
} from '@archboard/contracts';
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import {
  AUTH_REQUEST_ACTOR,
  AuthenticatedSessionGuard,
  CurrentSession,
  type AuthenticatedSession,
  type RequestActor,
} from '../auth/application/index.js';
import type { IncomingMessage } from 'node:http';
import { validate } from '../../platform/http/api-boundary.js';
import { DiscussionService, type DiscussionActor } from './application/discussion-service.js';
import { BoardServiceError } from './application/board-service.js';

@UseGuards(AuthenticatedSessionGuard)
@Controller('api/v1/boards')
export class DiscussionController {
  public constructor(
    @Inject(DiscussionService) private readonly discussion: DiscussionService,
    @Inject(AUTH_REQUEST_ACTOR) private readonly sessions: RequestActor,
  ) {}

  @Get(':id/threads')
  public async listThreads(
    @Req() request: IncomingMessage,
    @CurrentSession() session: AuthenticatedSession,
    @Param() path: unknown,
    @Query() query: unknown,
  ) {
    const { id } = validate(boardIdPathSchema, path);
    return threadListResponseSchema.parse(
      await this.discussion.listThreads(
        this.actor(session, request),
        id,
        validate(threadListQuerySchema, query),
      ),
    );
  }

  @Get(':id/threads/:threadId/comments')
  public async listComments(
    @Req() request: IncomingMessage,
    @CurrentSession() session: AuthenticatedSession,
    @Param() path: unknown,
    @Query() query: unknown,
  ) {
    const { id, threadId } = validate(threadPathSchema, path);
    return commentListResponseSchema.parse(
      await this.discussion.listComments(
        this.actor(session, request),
        id,
        threadId,
        validate(commentListQuerySchema, query),
      ),
    );
  }

  @Post(':id/threads')
  public async createThread(
    @Req() request: IncomingMessage,
    @CurrentSession() session: AuthenticatedSession,
    @Param() path: unknown,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    const { id } = validate(boardIdPathSchema, path);
    const result = await this.discussion.createThread(
      this.actor(session, request),
      id,
      validate(idempotencyKeySchema, key),
      validate(createThreadSchema, body),
    );
    return threadCreateResponseSchema.parse({ data: result.body });
  }

  @Post(':id/threads/:threadId/comments')
  public async createComment(
    @Req() request: IncomingMessage,
    @CurrentSession() session: AuthenticatedSession,
    @Param() path: unknown,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    const { id, threadId } = validate(threadPathSchema, path);
    const result = await this.discussion.createComment(
      this.actor(session, request),
      id,
      threadId,
      validate(idempotencyKeySchema, key),
      validate(createCommentSchema, body),
    );
    return commentResponseSchema.parse({ data: result.body });
  }

  private actor(session: AuthenticatedSession, request: IncomingMessage): DiscussionActor {
    return {
      userId: session.user.id,
      requireCurrentSession: async () => {
        const current = await this.sessions.require(request.headers);
        if (current.user.id !== session.user.id) {
          throw new BoardServiceError(ERROR_CODES.UNAUTHENTICATED, 'Sign in to continue.');
        }
      },
    };
  }
}
