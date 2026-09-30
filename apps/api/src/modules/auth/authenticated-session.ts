import {
  createParamDecorator,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { AUTH_REQUEST_ACTOR, type RequestActor } from './application/request-actor.js';
import type { AuthenticatedSession } from './application/session-lookup.js';

const REQUEST_SESSION = Symbol('authenticated-request-session');
type SessionRequest = IncomingMessage & { [REQUEST_SESSION]?: AuthenticatedSession };

@Injectable()
export class AuthenticatedSessionGuard implements CanActivate {
  public constructor(@Inject(AUTH_REQUEST_ACTOR) private readonly actor: RequestActor) {}
  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SessionRequest>();
    request[REQUEST_SESSION] = await this.actor.require(request.headers);
    return true;
  }
}

export const CurrentSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedSession => {
    const session = context.switchToHttp().getRequest<SessionRequest>()[REQUEST_SESSION];
    if (!session) throw new Error('Authenticated session guard is required.');
    return session;
  },
);
