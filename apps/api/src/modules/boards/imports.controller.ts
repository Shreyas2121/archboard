import {
  idempotencyKeySchema,
  importBoardSchema,
  importBoardResponseSchema,
} from '@archboard/contracts';
import { Body, Controller, Headers, Inject, Post, UseGuards } from '@nestjs/common';
import {
  AuthenticatedSessionGuard,
  CurrentSession,
  type AuthenticatedSession,
} from '../auth/application/index.js';
import { validate } from '../../platform/http/api-boundary.js';
import { BoardService, boardSummaryFromDetail } from './application/board-service.js';

@UseGuards(AuthenticatedSessionGuard)
@Controller('api/v1/imports')
export class ImportsController {
  public constructor(@Inject(BoardService) private readonly boards: BoardService) {}

  @Post()
  public async create(
    @CurrentSession() session: AuthenticatedSession,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
  ) {
    const result = await this.boards.import(
      session.user.id,
      validate(idempotencyKeySchema, key),
      validate(importBoardSchema, body),
    );
    return importBoardResponseSchema.parse({ data: boardSummaryFromDetail(result.board) });
  }
}
