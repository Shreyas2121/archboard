import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { loadApiConfig, PUBLIC_BIND_HOST } from './platform/config/index.js';

async function bootstrap(): Promise<void> {
  const config = loadApiConfig(process.env);
  const application = await NestFactory.create(AppModule.register(config));

  await application.listen(config.port, PUBLIC_BIND_HOST);
}

void bootstrap();
