import { currentUserSchema } from '@archboard/contracts';

import type { AuthSessionLookup, AuthenticatedSession } from '../application/index.js';
import type { BetterAuthRuntime } from './better-auth.runtime.js';

export class BetterAuthSessionLookup implements AuthSessionLookup {
  public constructor(private readonly runtime: BetterAuthRuntime) {}

  public async lookup(headers: Headers): Promise<AuthenticatedSession | null> {
    const session = await this.runtime.auth.api.getSession({ headers });
    if (session === null) return null;
    const image = currentUserSchema.shape.image.safeParse(session.user.image ?? null);
    const user = currentUserSchema.parse({
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: image.success ? image.data : null,
    });
    return { userId: user.id, user };
  }
}
