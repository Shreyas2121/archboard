import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import {
  localDevelopmentLogin,
  localLoginEnabled,
  localLoginRequestAllowed,
} from './local-development-login.js';

const local = {
  mode: 'development' as const,
  publicApiOrigin: 'http://localhost:10000',
  allowedWebOrigins: ['http://localhost:5173'],
};
it('creates a normal cookie session for one reserved account without returning a token or using caller identity', async () => {
  const auth = betterAuth({
    baseURL: local.publicApiOrigin,
    trustedOrigins: [...local.allowedWebOrigins],
    secret: 'synthetic-local-login-unit-secret-at-least-32-chars',
    database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
    plugins: [localDevelopmentLogin()],
  });
  const login = () =>
    auth.handler(
      new Request(`${local.publicApiOrigin}/api/auth/sign-in/local`, {
        method: 'POST',
        headers: { Origin: local.allowedWebOrigins[0]!, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'someone-else@example.test', userId: 'other-user' }),
      }),
    );
  const first = await login();
  expect(first.ok).toBe(true);
  expect(await first.json()).toEqual({ success: true });
  expect(first.headers.get('set-cookie')).toContain('HttpOnly');
  const session = async (response: Response) => {
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    const read = await auth.handler(
      new Request(`${local.publicApiOrigin}/api/auth/get-session`, { headers: { Cookie: cookie } }),
    );
    return read.json();
  };
  const firstSession = await session(first);
  expect(firstSession.user.email).toBe('local-agent@archboard.invalid');
  const secondSession = await session(await login());
  expect(secondSession.user.id).toBe(firstSession.user.id);
});
it.each(['production', 'test'] as const)('never enables local login in %s', (mode) => {
  expect(localLoginEnabled({ ...local, mode })).toBe(false);
  expect(
    localLoginRequestAllowed({ ...local, mode }, '127.0.0.1', local.allowedWebOrigins[0]),
  ).toBe(false);
});
it('refuses a development API configured on a public host', () => {
  expect(localLoginEnabled({ ...local, publicApiOrigin: 'https://api.example.test' })).toBe(false);
});
it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])(
  'accepts an actual loopback peer %s and an exact allowed local origin',
  (address) => {
    expect(localLoginRequestAllowed(local, address, 'http://localhost:5173')).toBe(true);
  },
);
it.each([
  ['192.168.1.2', 'http://localhost:5173'],
  ['localhost', 'http://localhost:5173'],
  [undefined, 'http://localhost:5173'],
  ['127.0.0.1', undefined],
  ['127.0.0.1', 'null'],
  ['127.0.0.1', 'https://attacker.example'],
  ['127.0.0.1', 'http://localhost:9999'],
])('refuses a foreign/missing peer or origin %#', (address, origin) => {
  expect(localLoginRequestAllowed(local, address, origin)).toBe(false);
});
