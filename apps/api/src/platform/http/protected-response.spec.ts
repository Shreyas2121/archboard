import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureProtectedResponses } from './protected-response.js';

it.each([
  '/api/v1/me',
  '/api/auth/callback/github',
  '/api/missing',
  '/api',
  '/health/ready',
  '/ws',
  '/API/v1/me',
])('excludes protected response %s from generic caching before downstream work', (path) => {
  const headers: Record<string, string> = {};
  let middleware!: (
    request: { path: string },
    response: { setHeader(name: string, value: string): void },
    next: () => void,
  ) => void;
  configureProtectedResponses({
    use: (handler: typeof middleware) => {
      middleware = handler;
    },
  } as unknown as NestExpressApplication);
  let continued = false;
  middleware(
    { path },
    {
      setHeader: (name, value) => {
        headers[name] = value;
      },
    },
    () => {
      expect(headers).toEqual({
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        'x-content-type-options': 'nosniff',
      });
      continued = true;
    },
  );
  expect(continued).toBe(true);
});
