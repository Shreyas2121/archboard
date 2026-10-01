import { authClient } from './auth-client';
import { safeReturnPath } from './return-path';

export async function startSocialSignIn(returnTo: unknown): Promise<boolean> {
  const path = safeReturnPath(returnTo);
  if (path === null) return false;
  // Use Better Auth's existing same-app continuation. No browser token store or diagnostics.
  const result = await authClient.signIn.social({
    provider: 'github',
    callbackURL: new URL(path, window.location.origin).toString(),
  });
  return !result.error;
}
