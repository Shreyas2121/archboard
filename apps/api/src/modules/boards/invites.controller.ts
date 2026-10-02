import {
  ERROR_CODES,
  inviteAcceptanceResponseSchema,
  invitePreviewResponseSchema,
  inviteTokenRequestSchema,
} from '@archboard/contracts';
import { Body, Controller, HttpCode, HttpStatus, Inject, Post, UseGuards } from '@nestjs/common';

import type { AuthenticatedSession } from '../auth/application/index.js';
import { AuthenticatedSessionGuard, CurrentSession } from '../auth/application/index.js';
import { fail, validate } from '../../platform/http/api-boundary.js';
import { InviteService } from './application/invite-service.js';

function tokenRequest(body: unknown): { token: string } {
  const result = inviteTokenRequestSchema.safeParse(body);
  if (result.success) return result.data;
  const tokenOnly =
    typeof body === 'object' &&
    body !== null &&
    !Array.isArray(body) &&
    Object.keys(body).every((key) => key === 'token');
  if (body === undefined || body === null || tokenOnly) {
    fail(ERROR_CODES.INVITE_UNAVAILABLE, 'Invitation unavailable.', HttpStatus.NOT_FOUND);
  }
  return validate(inviteTokenRequestSchema, body);
}

@UseGuards(AuthenticatedSessionGuard)
@Controller('api/v1/invites')
export class InvitesController {
  public constructor(@Inject(InviteService) private readonly invites: InviteService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  public async preview(@Body() body: unknown) {
    const { token } = tokenRequest(body);
    return invitePreviewResponseSchema.parse({ data: await this.invites.preview(token) });
  }

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  public async accept(@CurrentSession() session: AuthenticatedSession, @Body() body: unknown) {
    const { token } = tokenRequest(body);
    return inviteAcceptanceResponseSchema.parse({
      data: await this.invites.accept(session.user.id, token),
    });
  }
}
