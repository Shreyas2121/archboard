import { ERROR_CODES } from '@archboard/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { RuntimeAdmission } from '../lifecycle/runtime-admission.js';
import { errorEnvelope } from './api-boundary.js';

const HTTP_UNAVAILABLE = 503;

/** Runs after protected headers, before CORS, auth handlers or product body parsing. */
export function configureRuntimeAdmission(
  application: NestExpressApplication,
  admission: RuntimeAdmission,
): void {
  application.use(
    (
      request: { path: string },
      response: { status(code: number): { json(body: unknown): void } },
      next: () => void,
    ) => {
      if (/^\/(?:api|auth|ws)(?:\/|$)/i.test(request.path) && !admission.accepting) {
        response
          .status(HTTP_UNAVAILABLE)
          .json(
            errorEnvelope(ERROR_CODES.TEMPORARILY_UNAVAILABLE, 'Service temporarily unavailable.'),
          );
        return;
      }
      next();
    },
  );
}
