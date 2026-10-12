import { isIP } from 'node:net';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import type { ApiConfig } from '../../../platform/config/index.js';

export const LOCAL_LOGIN_PATH = '/api/auth/sign-in/local';
const LOCAL_EMAIL = 'local-agent@archboard.invalid';
const IPV4 = 4;

export function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    (isIP(hostname) === IPV4 && hostname.startsWith('127.'))
  );
}

export function localLoginEnabled(config: Pick<ApiConfig, 'mode' | 'publicApiOrigin'>): boolean {
  return (
    config.mode === 'development' && isLoopbackHostname(new URL(config.publicApiOrigin).hostname)
  );
}

export function localLoginRequestAllowed(
  config: Pick<ApiConfig, 'mode' | 'publicApiOrigin' | 'allowedWebOrigins'>,
  address: string | undefined,
  origin: string | undefined,
): boolean {
  if (!localLoginEnabled(config) || !address || !origin) return false;
  const peer = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  if (!isLoopbackHostname(peer) || peer === 'localhost') return false;
  try {
    return (
      isLoopbackHostname(new URL(origin).hostname) && config.allowedWebOrigins.includes(origin)
    );
  } catch {
    return false;
  }
}

/** Registered only for a loopback development API. No caller-selected identity. */
export function localDevelopmentLogin(): BetterAuthPlugin {
  return {
    id: 'archboard-local-development-login',
    endpoints: {
      signInLocal: createAuthEndpoint('/sign-in/local', { method: 'POST' }, async (ctx) => {
        const adapter = ctx.context.internalAdapter;
        const existing = await adapter.findUserByEmail(LOCAL_EMAIL);
        const user =
          existing?.user ??
          (await adapter.createUser(
            {
              email: LOCAL_EMAIL,
              name: 'Local AI Agent',
              emailVerified: false,
            },
            { method: 'local-development' },
          ));
        if (!user)
          throw new APIError('INTERNAL_SERVER_ERROR', { message: 'Local login unavailable.' });
        const session = await adapter.createSession(user.id);
        if (!session)
          throw new APIError('INTERNAL_SERVER_ERROR', { message: 'Local login unavailable.' });
        await setSessionCookie(ctx, { session, user });
        // Session tokens stay in HttpOnly cookies, never in the response body.
        return ctx.json({ success: true });
      }),
    },
  };
}
