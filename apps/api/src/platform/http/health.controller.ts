import { ERROR_CODES } from '@archboard/contracts';
import { Controller, Get, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

import { fail } from './api-boundary.js';

const REQUIRED_TABLES = [
  'user',
  'session',
  'boards',
  'board_members',
  'board_invites',
  'board_snapshots',
  'api_idempotency',
] as const;

@Injectable()
export class ReadinessService {
  public constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  public async ready(): Promise<boolean> {
    if (!this.dataSource.isInitialized) return false;
    try {
      if (await this.dataSource.showMigrations()) return false;
      const runner = this.dataSource.createQueryRunner();
      try {
        for (const table of REQUIRED_TABLES) {
          if (!(await runner.hasTable(table))) return false;
        }
        return true;
      } finally {
        await runner.release();
      }
    } catch {
      return false;
    }
  }
}

@Controller('health')
export class HealthController {
  public constructor(private readonly readiness: ReadinessService) {}

  @Get('live')
  public live() {
    return { status: 'live' };
  }

  @Get('ready')
  public async ready() {
    if (!(await this.readiness.ready())) {
      fail(ERROR_CODES.TEMPORARILY_UNAVAILABLE, 'Service temporarily unavailable.');
    }
    return { status: 'ready' };
  }
}
