import type { NestExpressApplication } from '@nestjs/platform-express';

export const PROTECTED_RESPONSE_HEADERS = Object.freeze({
  'cache-control': 'no-store',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
});

/** Install before CORS, auth and parsers so errors and redirects share the policy. */
export function configureProtectedResponses(application: NestExpressApplication): void {
  application.use(
    (
      request: { path: string },
      response: { setHeader(name: string, value: string): void },
      next: () => void,
    ) => {
      if (/^\/(?:api|auth|ws|health)(?:\/|$)/i.test(request.path)) {
        for (const [name, value] of Object.entries(PROTECTED_RESPONSE_HEADERS))
          response.setHeader(name, value);
      }
      next();
    },
  );
}
