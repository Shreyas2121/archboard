import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module.js';
import { BetterAuthRuntime, configureAuthHttp } from './modules/auth/index.js';
import { configureCollaborationWebSockets } from './modules/collaboration/infrastructure/websocket/index.js';
import { loadApiConfig, PUBLIC_BIND_HOST } from './platform/config/index.js';
import { PrivacyLogger } from './platform/http/privacy-logger.js';

async function bootstrap(): Promise<void> {
  const config = loadApiConfig(process.env);
  const application = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
    bodyParser: false,
    logger: new PrivacyLogger(),
  });
  configureCollaborationWebSockets(application);
  configureAuthHttp(application, application.get(BetterAuthRuntime), config);
  application.enableShutdownHooks();

  await application.listen(config.port, PUBLIC_BIND_HOST);
}

void bootstrap().catch(() => {
  new PrivacyLogger().fatal();
  // Startup may already own a pool/worker; do not leave a failed process alive.
  process.exit(1);
});
