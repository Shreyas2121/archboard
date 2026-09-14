import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';

import type { ApiConfig } from '../../../platform/config/index.js';
import type { BetterAuthRuntime } from './better-auth.runtime.js';

type AuthNodeHandler = ReturnType<typeof toNodeHandler>;

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
  expressApplication.all('/api/auth/*splat', toNodeHandler(authRuntime.auth));

  // Better Auth must receive the untouched request stream before Nest installs JSON parsing.
  application.useBodyParser('json');
}
