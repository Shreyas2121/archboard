import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  aiAvailabilityQuerySchema,
  aiAvailabilityResponseSchema,
  aiCancelRunSchema,
  aiCreateRunSchema,
  aiEmptyQuerySchema,
  aiEventHeadersSchema,
  aiRunPathSchema,
  aiRunResponseSchema,
  idempotencyKeySchema,
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
  Res,
  HttpCode,
} from '@nestjs/common';
import { AUTH_REQUEST_ACTOR, type RequestActor } from '../auth/application/index.js';
import { validate } from '../../platform/http/api-boundary.js';
import { AiHttpService } from './application/http-service.js';
import { AiEvents } from './ai-events.js';

const HTTP_ACCEPTED = 202;
const HTTP_OK = 200;
@Controller('api/v1/ai')
export class AiController {
  public constructor(
    @Inject(AUTH_REQUEST_ACTOR) private readonly actor: RequestActor,
    @Inject(AiHttpService) private readonly ai: AiHttpService,
    @Inject(AiEvents) private readonly events: AiEvents,
  ) {}
  @Post('runs')
  @HttpCode(HTTP_ACCEPTED)
  public async create(
    @Req() request: IncomingMessage,
    @Headers('idempotency-key') key: unknown,
    @Body() body: unknown,
    @Query() query: unknown,
  ) {
    const session = await this.actor.require(request.headers);
    validate(aiEmptyQuerySchema, query);
    return aiRunResponseSchema.parse({
      data: await this.ai.create(
        session.user.id,
        validate(idempotencyKeySchema, key),
        validate(aiCreateRunSchema, body),
      ),
    });
  }
  @Get('availability')
  public async availability(@Req() request: IncomingMessage, @Query() query: unknown) {
    const session = await this.actor.require(request.headers);
    const input = validate(aiAvailabilityQuerySchema, query);
    return aiAvailabilityResponseSchema.parse({
      data: await this.ai.availability(session.user.id, input.boardId ?? null),
    });
  }
  @Get('runs/:runId')
  public async read(
    @Req() request: IncomingMessage,
    @Param() path: unknown,
    @Query() query: unknown,
  ) {
    const session = await this.actor.require(request.headers);
    validate(aiEmptyQuerySchema, query);
    return aiRunResponseSchema.parse({
      data: await this.ai.read(session.user.id, validate(aiRunPathSchema, path).runId),
    });
  }
  @Post('runs/:runId/cancel')
  @HttpCode(HTTP_OK)
  public async cancel(
    @Req() request: IncomingMessage,
    @Param() path: unknown,
    @Body() body: unknown,
    @Query() query: unknown,
  ) {
    const session = await this.actor.require(request.headers);
    validate(aiEmptyQuerySchema, query);
    validate(aiCancelRunSchema, body);
    return aiRunResponseSchema.parse({
      data: await this.ai.cancel(session.user.id, validate(aiRunPathSchema, path).runId),
    });
  }
  @Get('runs/:runId/events')
  public async stream(
    @Req() request: IncomingMessage,
    @Param() path: unknown,
    @Query() query: unknown,
    @Res() response: ServerResponse,
  ) {
    const session = await this.actor.require(request.headers);
    validate(aiEmptyQuerySchema, query);
    validate(aiEventHeadersSchema, { lastEventId: request.headers['last-event-id'] });
    const id = validate(aiRunPathSchema, path).runId;
    await this.events.serve(response, this.ai.open(session.user.id, id), async () => {
      const current = await this.actor.require(request.headers);
      if (current.user.id !== session.user.id) throw new Error('Session changed.');
    });
  }
}
