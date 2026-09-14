import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module.js';
import { BetterAuthRuntime, configureAuthHttp } from './modules/auth/index.js';
import { loadApiConfig, PUBLIC_BIND_HOST } from './platform/config/index.js';

async function bootstrap(): Promise<void> {
  const config = loadApiConfig(process.env);
  const application = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
    bodyParser: false,
  });
  configureAuthHttp(application, application.get(BetterAuthRuntime), config);
  application.enableShutdownHooks();

  await application.listen(config.port, PUBLIC_BIND_HOST);
}

void bootstrap();
