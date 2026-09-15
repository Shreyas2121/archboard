import type { AuthSessionLookup, AuthenticatedSession } from '../application/index.js';
import type { BetterAuthRuntime } from './better-auth.runtime.js';

export class BetterAuthSessionLookup implements AuthSessionLookup {
  public constructor(private readonly runtime: BetterAuthRuntime) {}

  public async lookup(headers: Headers): Promise<AuthenticatedSession | null> {
    const session = await this.runtime.auth.api.getSession({ headers });
    return session === null ? null : { userId: session.user.id };
  }
}
