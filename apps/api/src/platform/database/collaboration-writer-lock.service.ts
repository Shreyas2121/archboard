import { Inject, Injectable } from '@nestjs/common';
import type { OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import type { DataSource, QueryRunner } from 'typeorm';
import { WS_PING_INTERVAL_MS } from '@archboard/contracts';

import { DATABASE_DIRECT_DATA_SOURCE } from './database.tokens.js';

export const COLLABORATION_WRITER_ADVISORY_LOCK_KEY = '4706898538184786258';

interface AdvisoryLockRow {
  readonly acquired: boolean;
}

interface SessionConnection {
  once(event: 'error', listener: () => void): void;
}

export class CollaborationWriterLockUnavailableError extends Error {
  public constructor() {
    super('The collaboration writer advisory lock is already owned by another process.');
    this.name = 'CollaborationWriterLockUnavailableError';
  }
}

@Injectable()
export class CollaborationWriterLockService implements OnModuleInit, OnApplicationShutdown {
  private queryRunner: QueryRunner | undefined;
  private lockOwned = false;
  private heartbeat: NodeJS.Timeout | undefined;
  private checking = false;
  private shuttingDown = false;

  public constructor(
    @Inject(DATABASE_DIRECT_DATA_SOURCE) private readonly directDataSource: DataSource,
  ) {}

  public async onModuleInit(): Promise<void> {
    if (!this.directDataSource.isInitialized) await this.directDataSource.initialize();
    const queryRunner = this.directDataSource.createQueryRunner();
    this.queryRunner = queryRunner;
    try {
      await queryRunner.connect();
      const sessionConnection = (
        queryRunner as unknown as { databaseConnection: SessionConnection }
      ).databaseConnection;
      sessionConnection.once('error', () => {
        this.loseOwnership();
      });
      const rows = (await queryRunner.query('SELECT pg_try_advisory_lock($1::bigint) AS acquired', [
        COLLABORATION_WRITER_ADVISORY_LOCK_KEY,
      ])) as AdvisoryLockRow[];
      this.lockOwned = rows[0]?.acquired === true;
      if (!this.lockOwned) throw new CollaborationWriterLockUnavailableError();
      this.heartbeat = setInterval(() => {
        if (this.checking) return;
        this.checking = true;
        void this.isReady().finally(() => {
          this.checking = false;
        });
      }, WS_PING_INTERVAL_MS);
      this.heartbeat.unref();
    } catch (error) {
      await this.releaseResources(false);
      throw error;
    }
  }

  public async isReady(): Promise<boolean> {
    if (!this.lockOwned || this.queryRunner === undefined || this.queryRunner.isReleased) {
      return false;
    }
    try {
      await this.queryRunner.query('SELECT 1');
      return true;
    } catch {
      this.loseOwnership();
      return false;
    }
  }

  public async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    await this.releaseResources(true);
  }

  protected terminateProcess(): void {
    process.kill(process.pid, 'SIGTERM');
  }

  private loseOwnership(): void {
    if (!this.lockOwned) return;
    this.lockOwned = false;
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    if (!this.shuttingDown) this.terminateProcess();
  }

  private async releaseResources(unlockLock: boolean): Promise<void> {
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    const queryRunner = this.queryRunner;
    this.queryRunner = undefined;
    if (queryRunner !== undefined && !queryRunner.isReleased) {
      if (unlockLock && this.lockOwned) {
        try {
          await queryRunner.query('SELECT pg_advisory_unlock($1::bigint)', [
            COLLABORATION_WRITER_ADVISORY_LOCK_KEY,
          ]);
        } catch {
          // A lost PostgreSQL session has already released its session-scoped lock.
        }
      }
      await queryRunner.release().catch(() => undefined);
    }
    this.lockOwned = false;
    if (this.directDataSource.isInitialized) {
      await this.directDataSource.destroy().catch(() => undefined);
    }
  }
}
