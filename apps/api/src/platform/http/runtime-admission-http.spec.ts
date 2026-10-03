import type { NestExpressApplication } from '@nestjs/platform-express';
import { apiErrorEnvelopeSchema } from '@archboard/contracts';
import { RuntimeAdmission } from '../lifecycle/runtime-admission.js';
import { configureRuntimeAdmission } from './runtime-admission-http.js';

const HTTP_UNAVAILABLE = 503;
function harness() {
  const admission = new RuntimeAdmission();
  let middleware!: (
    request: { path: string },
    response: { status(code: number): { json(body: unknown): void } },
    next: () => void,
  ) => void;
  configureRuntimeAdmission(
    {
      use: (handler: typeof middleware) => {
        middleware = handler;
      },
    } as unknown as NestExpressApplication,
    admission,
  );
  function request(path: string) {
    let status: number | undefined,
      body: unknown,
      continued = false;
    middleware(
      { path },
      {
        status: (code) => {
          status = code;
          return {
            json: (value) => {
              body = value;
            },
          };
        },
      },
      () => {
        continued = true;
      },
    );
    return { status, body, continued };
  }
  return { admission, request };
}
it.each([
  '/api',
  '/api/v1/boards',
  '/api/auth/callback/github',
  '/auth/unknown',
  '/ws',
  '/API/missing',
])('refuses %s before downstream work until ready and after shutdown', (path) => {
  const { admission, request } = harness();
  const refused = request(path);
  expect(refused.continued).toBe(false);
  expect(refused.status).toBe(HTTP_UNAVAILABLE);
  expect(apiErrorEnvelopeSchema.parse(refused.body).error).toMatchObject({
    code: 'TEMPORARILY_UNAVAILABLE',
    message: 'Service temporarily unavailable.',
  });
  admission.setOwnership(true);
  admission.setSchemaCompatible(true);
  expect(request(path).continued).toBe(true);
  admission.stop();
  expect(request(path).continued).toBe(false);
});
it.each(['/health/live', '/health/ready', '/', '/api-other'])(
  'allows %s to reach its owner during startup/drain',
  (path) => {
    expect(harness().request(path)).toEqual({
      status: undefined,
      body: undefined,
      continued: true,
    });
  },
);
