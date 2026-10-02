import {
  ERROR_CODES,
  boardIdPathSchema,
  checkpointPathSchema,
  checkpointListQuerySchema,
  checkpointListResponseSchema,
  checkpointDetailResponseSchema,
  checkpointSummaryResponseSchema,
  createCheckpointSchema,
  restoreCheckpointSchema,
  restoreCheckpointResponseSchema,
  idempotencyKeySchema,
} from '@archboard/contracts';
import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import {
  AUTH_REQUEST_ACTOR,
  AuthenticatedSessionGuard,
  CurrentSession,
  type AuthenticatedSession,
  type RequestActor,
} from '../auth/application/index.js';
import { validate } from '../../platform/http/api-boundary.js';
import { CheckpointService, type CheckpointActor } from './application/checkpoint-service.js';
import { BoardServiceError, boardSummaryFromDetail } from './application/board-service.js';

@UseGuards(AuthenticatedSessionGuard)
@Controller('api/v1/boards')
export class CheckpointsController {
  public constructor(
    @Inject(CheckpointService) private readonly checkpoints: CheckpointService,
    @Inject(AUTH_REQUEST_ACTOR) private readonly sessions: RequestActor,
  ) {}

  @Get(':id/checkpoints')
  @Header('Cache-Control', 'no-store')
  public async list(
    @Req() request: IncomingMessage,
    @CurrentSession() session: AuthenticatedSession,
    @Param() path: unknown,
    @Query() query: unknown,
  ) {
    const { id } = validate(boardIdPathSchema, path);
    return checkpointListResponseSchema.parse(
      await this.checkpoints.list(
        this.actor(session, request),
        id,
        validate(checkpointListQuerySchema, query),
      ),
    );
  }
  @Get(':id/checkpoints/:checkpointId')
  @Header('Cache-Control', 'no-store')
  public async detail(
    @Req() request: IncomingMessage,
    @CurrentSession() session: AuthenticatedSession,
    @Param() path: unknown,
  ) {
    const { id, checkpointId } = validate(checkpointPathSchema, path);
    return checkpointDetailResponseSchema.parse({
      data: await this.checkpoints.detail(this.actor(session, request), id, checkpointId),
    });
  }
  @Post(':id/checkpoints')
  @Header('Cache-Control', 'no-store')
  public async create(
    @Req() request: IncomingMessage,
    @CurrentSession() session: AuthenticatedSession,
    @Param() path: unknown,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    const { id } = validate(boardIdPathSchema, path);
    const result = await this.checkpoints.create(
      this.actor(session, request),
      id,
      validate(idempotencyKeySchema, key),
      validate(createCheckpointSchema, body),
    );
    return checkpointSummaryResponseSchema.parse({ data: result.checkpoint });
  }
  @Post(':id/checkpoints/:checkpointId/duplicate')
  @Header('Cache-Control', 'no-store')
  public async restore(
    @Req() request: IncomingMessage,
    @CurrentSession() session: AuthenticatedSession,
    @Param() path: unknown,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    const { id, checkpointId } = validate(checkpointPathSchema, path);
    const result = await this.checkpoints.restore(
      this.actor(session, request),
      id,
      checkpointId,
      validate(idempotencyKeySchema, key),
      validate(restoreCheckpointSchema, body),
    );
    return restoreCheckpointResponseSchema.parse({ data: boardSummaryFromDetail(result.board) });
  }
  private actor(session: AuthenticatedSession, request: IncomingMessage): CheckpointActor {
    return {
      userId: session.user.id,
      requireCurrentSession: async () => {
        const current = await this.sessions.require(request.headers);
        if (current.user.id !== session.user.id)
          throw new BoardServiceError(ERROR_CODES.UNAUTHENTICATED, 'Sign in to continue.');
      },
    };
  }
}
