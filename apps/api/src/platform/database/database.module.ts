import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import type { ApiConfig } from '../config/index.js';
import { CollaborationWriterLockService } from './collaboration-writer-lock.service.js';
import { directDataSourceOptions, runtimeDataSourceOptions } from './data-source-options.js';
import { DATABASE_DIRECT_DATA_SOURCE } from './database.tokens.js';

@Module({})
export class DatabaseModule {
  public static register(config: ApiConfig): DynamicModule {
    return {
      module: DatabaseModule,
      imports: [TypeOrmModule.forRoot(runtimeDataSourceOptions(config))],
      providers: [
        {
          provide: DATABASE_DIRECT_DATA_SOURCE,
          useFactory: () => new DataSource(directDataSourceOptions(config)),
        },
        CollaborationWriterLockService,
      ],
      exports: [TypeOrmModule, CollaborationWriterLockService],
    };
  }
}
