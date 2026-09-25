import type { IncomingMessage } from 'node:http';

import { currentUserResponseSchema } from '@archboard/contracts';
import { Controller, Get, Inject, Req } from '@nestjs/common';

import { AUTH_REQUEST_ACTOR, type RequestActor } from './application/index.js';

@Controller('api/v1')
export class MeController {
  public constructor(@Inject(AUTH_REQUEST_ACTOR) private readonly actor: RequestActor) {}

  @Get('me')
  public async currentUser(@Req() request: IncomingMessage) {
    const session = await this.actor.require(request.headers);
    return currentUserResponseSchema.parse({ data: session.user });
  }
}
