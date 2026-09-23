import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';

import type { ApiConfig } from '../../../platform/config/index.js';
import type { BetterAuthRuntime } from './better-auth.runtime.js';

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
  application.enableCors({
    origin: [...config.allowedWebOrigins],
    credentials: true,
  });

  const expressApplication = application.getHttpAdapter().getInstance() as ExpressRouteRegistrar;
  const authHandler = toNodeHandler(authRuntime.auth);
  expressApplication.all('/api/auth/*splat', (request, response) => {
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

  // Better Auth must receive the untouched request stream before Nest installs JSON parsing.
  application.useBodyParser('json');
}
