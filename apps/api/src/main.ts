import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';

// This named bootstrap default is replaced by validated configuration in C02.
const DEFAULT_DEVELOPMENT_PORT = 3000;
const PUBLIC_BIND_HOST = '0.0.0.0';

async function bootstrap(): Promise<void> {
  const application = await NestFactory.create(AppModule);
  const port = process.env.PORT ? Number.parseInt(process.env.PORT) : DEFAULT_DEVELOPMENT_PORT;

  await application.listen(port, PUBLIC_BIND_HOST);
}

void bootstrap();
