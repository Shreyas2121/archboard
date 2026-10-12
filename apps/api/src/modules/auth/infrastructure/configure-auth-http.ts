import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';

import type { ApiConfig } from '../../../platform/config/index.js';
import type { BetterAuthRuntime } from './better-auth.runtime.js';
import { configureProductHttp } from '../../../platform/http/product-http.js';
import { configureProtectedResponses } from '../../../platform/http/protected-response.js';
import { RuntimeAdmission } from '../../../platform/lifecycle/runtime-admission.js';
import { configureRuntimeAdmission } from '../../../platform/http/runtime-admission-http.js';
import {
  LOCAL_LOGIN_PATH,
  localLoginEnabled,
  localLoginRequestAllowed,
} from './local-development-login.js';

type AuthNodeHandler = ReturnType<typeof toNodeHandler>;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

interface ExpressRouteRegistrar {
  all(path: string, handler: AuthNodeHandler): void;
}

export function configureAuthHttp(
  application: NestExpressApplication,
  authRuntime: BetterAuthRuntime,
  config: ApiConfig,
): void {
  configureProtectedResponses(application);
  const admission = application.get(RuntimeAdmission);
  application.enableCors({
    origin: [...config.allowedWebOrigins],
    credentials: true,
  });
  // Browsers must be able to read admission errors as well as successful responses.
  configureRuntimeAdmission(application, admission);

  const expressApplication = application.getHttpAdapter().getInstance() as ExpressRouteRegistrar;
  const authHandler = toNodeHandler(authRuntime.auth);
  expressApplication.all('/api/auth/*splat', (request, response) => {
    // OAuth responses can carry the same-app invitation continuation.
    response.setHeader('cache-control', 'no-store');
    response.setHeader('referrer-policy', 'no-referrer');
    const origin = request.headers.origin;
    let authPath: string;
    try {
      authPath = decodeURIComponent(
        new URL(request.url ?? '/', config.publicApiOrigin).pathname,
      ).replace(/\/+$/, '');
    } catch {
      response.statusCode = HTTP_FORBIDDEN;
      response.end();
      return Promise.resolve();
    }
    if (authPath === LOCAL_LOGIN_PATH) {
      if (
        !localLoginEnabled(config) ||
        !localLoginRequestAllowed(
          config,
          request.socket.remoteAddress,
          typeof origin === 'string' ? origin : undefined,
        )
      ) {
        response.statusCode = localLoginEnabled(config) ? HTTP_FORBIDDEN : HTTP_NOT_FOUND;
        response.end();
        return Promise.resolve();
      }
    }
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

  configureProductHttp(application, [config.publicApiOrigin, ...config.allowedWebOrigins]);
}
