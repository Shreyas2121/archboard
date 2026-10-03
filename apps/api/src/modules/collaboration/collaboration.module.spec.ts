import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { Module, Global } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AUTH_REQUEST_ACTOR, AUTH_SESSION_LOOKUP } from '../auth/application/index.js';
import { BoardAuthorityModule } from '../boards/board-authority.module.js';
import { BoardSequenceAccess } from '../boards/application/index.js';
import { BoardsModule } from '../boards/boards.module.js';
import { BoardService } from '../boards/application/board-service.js';
import { CheckpointService } from '../boards/application/checkpoint-service.js';
import { loadApiConfig } from '../../platform/config/index.js';
import { CollaborationWriterLockService } from '../../platform/database/index.js';
import { CollaborationModule } from './collaboration.module.js';
import {
  CandidateValidator,
  CommittedGraphCopier,
  CommittedGraphReader,
} from './application/index.js';
import { ValidationWorkerPool } from './infrastructure/validation-worker/index.js';
import { CollaborationShutdownService } from './infrastructure/lifecycle/collaboration-shutdown.service.js';

describe('release feature provider composition without a database or HTTP server', () => {
  it('shares public validation/copy/sequence ports and closes the actual lifecycle providers', async () => {
    const config = loadApiConfig({
      NODE_ENV: 'test',
      PUBLIC_API_ORIGIN: 'http://localhost:3000',
      ALLOWED_WEB_ORIGINS: 'http://localhost:5173',
      PORT: '3000',
      DATABASE_URL: 'postgresql://unused:unused@localhost/unused',
      DATABASE_DIRECT_URL: 'postgresql://unused:unused@localhost/unused',
      BETTER_AUTH_SECRET: 'unused-unit-secret-at-least-32-characters',
    });
    const server = new EventEmitter();
    @Global()
    @Module({
      providers: [
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: () => {
              throw new Error('Database access forbidden in unit composition');
            },
          },
        },
        { provide: CollaborationWriterLockService, useValue: {} },
        { provide: HttpAdapterHost, useValue: { httpAdapter: { getHttpServer: () => server } } },
      ],
      exports: [DataSource, CollaborationWriterLockService, HttpAdapterHost],
    })
    class DatabaseStub {}
    @Module({
      providers: [
        { provide: AUTH_SESSION_LOOKUP, useValue: { lookup: async () => null } },
        { provide: AUTH_REQUEST_ACTOR, useValue: {} },
      ],
      exports: [AUTH_SESSION_LOOKUP, AUTH_REQUEST_ACTOR],
    })
    class AuthStub {}
    const auth = { module: AuthStub };
    const database = { module: DatabaseStub };
    const collaboration = CollaborationModule.register(
      config,
      auth,
      database,
      BoardAuthorityModule,
    );
    @Module({ imports: [collaboration, BoardsModule.register(config, auth, collaboration)] })
    class ProductStub {}
    const context = await NestFactory.createApplicationContext(ProductStub, {
      logger: false,
      abortOnError: false,
    });
    const workers = context.get(ValidationWorkerPool);
    try {
      expect(context.get(CandidateValidator)).toBe(workers);
      expect(context.get(CommittedGraphCopier)).toBe(context.get(CommittedGraphReader));
      expect(context.get(BoardSequenceAccess)).toBeDefined();
      expect(context.get(BoardService)).toBeDefined();
      expect(context.get(CheckpointService)).toBeDefined();
      expect(context.get(CollaborationShutdownService)).toBeDefined();
      expect(server.listenerCount('upgrade')).toBe(1);
    } finally {
      await context.close();
    }
    expect(workers.activeWorkerCount).toBe(0);
    expect(server.listenerCount('upgrade')).toBe(0);
  });
});
