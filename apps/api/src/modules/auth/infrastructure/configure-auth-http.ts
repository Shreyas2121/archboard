import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';

import type { ApiConfig } from '../../../platform/config/index.js';
import type { BetterAuthRuntime } from './better-auth.runtime.js';
import { configureProductHttp } from '../../../platform/http/product-http.js';
import { configureProtectedResponses } from '../../../platform/http/protected-response.js';

type AuthNodeHandler = ReturnType<typeof toNodeHandler>;
const HTTP_FORBIDDEN = 403;

interface ExpressRouteRegistrar {
  all(path: string, handler: AuthNodeHandler): void;
}

export function configureAuthHttp(
  application: NestExpressApplication,
  authRuntime: BetterAuthRuntime,
  config: ApiConfig,
): void {
  configureProtectedResponses(application);
  application.enableCors({
    origin: [...config.allowedWebOrigins],
    credentials: true,
  });

  const expressApplication = application.getHttpAdapter().getInstance() as ExpressRouteRegistrar;
  const authHandler = toNodeHandler(authRuntime.auth);
  expressApplication.all('/api/auth/*splat', (request, response) => {
    // OAuth responses can carry the same-app invitation continuation.
    response.setHeader('cache-control', 'no-store');
    response.setHeader('referrer-policy', 'no-referrer');
    const origin = request.headers.origin;
    if (
      origin !== undefined &&
      (typeof origin !== 'string' ||
        (origin !== config.publicApiOrigin && !config.allowedWebOrigins.includes(origin)))
    ) {
      response.statusCode = HTTP_FORBIDDEN;
      response.end();
      return Promise.resolve();
    }
    return authHandler(request, response);
  });

  configureProductHttp(application);
}
