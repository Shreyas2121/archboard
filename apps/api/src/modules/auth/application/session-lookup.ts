import type { CurrentUser } from '@archboard/contracts';

/** Public auth application boundary for other server features. */
export const AUTH_SESSION_LOOKUP = Symbol('AUTH_SESSION_LOOKUP');

export interface AuthenticatedSession {
  readonly userId: string;
  readonly user: CurrentUser;
}

export interface AuthSessionLookup {
  lookup(headers: Headers): Promise<AuthenticatedSession | null>;
}
