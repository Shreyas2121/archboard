import { ERROR_CODES } from '@archboard/contracts';
import { Controller, Get, Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { CollaborationWriterLockService } from '../database/index.js';
import { RuntimeAdmission } from '../lifecycle/runtime-admission.js';
import { schemaCompatible } from '../database/schema-compatibility.js';
import { StartupReadinessUnavailableError } from '../lifecycle/startup-errors.js';

import { fail } from './api-boundary.js';

@Injectable()
export class ReadinessService implements OnApplicationBootstrap {
  public constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(CollaborationWriterLockService)
    private readonly writerLock: CollaborationWriterLockService,
    @Inject(RuntimeAdmission) private readonly admission: RuntimeAdmission,
  ) {}

  public async onApplicationBootstrap(): Promise<void> {
    if (!(await this.ready())) throw new StartupReadinessUnavailableError();
  }

  public async ready(): Promise<boolean> {
    if (this.admission.stopping) return false;
    if (!this.dataSource.isInitialized) {
      this.admission.setSchemaCompatible(false);
      return false;
    }
    try {
      const owned = await this.writerLock.isReady();
      if (this.admission.stopping) return false;
      if (!owned) {
        this.admission.setSchemaCompatible(false);
        return false;
      }
      const compatible = await this.checkSchema();
      if (this.admission.stopping) return false;
      this.admission.setSchemaCompatible(compatible);
      return compatible && this.admission.accepting;
    } catch {
      this.admission.setSchemaCompatible(false);
      return false;
    }
  }
  protected checkSchema(): Promise<boolean> {
    return schemaCompatible(this.dataSource);
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
