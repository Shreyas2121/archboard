import type { IncomingHttpHeaders } from 'node:http';

import type { AuthenticatedSession } from './session-lookup.js';

/** Trusted session actor for HTTP controllers. Implementations own cookie parsing and safe errors. */
export const AUTH_REQUEST_ACTOR = Symbol('AUTH_REQUEST_ACTOR');

export interface RequestActor {
  require(headers: IncomingHttpHeaders): Promise<AuthenticatedSession>;
}
