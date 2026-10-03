import { Inject, Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import { RuntimeAdmission } from '../../../../platform/lifecycle/runtime-admission.js';
import {
  ShutdownDeadline,
  COLLABORATION_DRAIN_MS,
} from '../../../../platform/lifecycle/shutdown-deadline.js';

import { ValidationWorkerPool } from '../validation-worker/index.js';
import { CollaborationGateway } from '../websocket/collaboration.gateway.js';
import { CollaborationUpgradeService } from '../websocket/collaboration-upgrade.service.js';
import { RoomMaintenanceService } from './room-maintenance.service.js';
import { CollaborationRoomRegistry } from '../../application/room-registry.js';

/** Completes during module destruction, before auth/database application-shutdown hooks. */
@Injectable()
export class CollaborationShutdownService implements OnModuleDestroy {
  private closing?: Promise<void>;

  public constructor(
    @Inject(CollaborationUpgradeService) private readonly upgrades: CollaborationUpgradeService,
    @Inject(CollaborationGateway) private readonly gateway: CollaborationGateway,
    @Inject(RoomMaintenanceService) private readonly maintenance: RoomMaintenanceService,
    @Inject(ValidationWorkerPool) private readonly workers: ValidationWorkerPool,
    @Inject(CollaborationRoomRegistry) private readonly rooms: CollaborationRoomRegistry,
    @Optional() @Inject(RuntimeAdmission) private readonly admission?: RuntimeAdmission,
  ) {}

  public onModuleDestroy(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.admission?.stop();
    this.upgrades.stopAdmission();
    this.gateway.stopAdmission();
    this.rooms.stopAdmission();
    this.closing = new ShutdownDeadline().run(async () => {
      const results = await Promise.allSettled([
        this.workers.close(),
        this.upgrades.drain(),
        this.gateway.drain(),
        this.maintenance.onModuleDestroy(),
        this.admission?.whenIdle(),
      ]);
      // Workers and feature tasks have settled; drain remaining admitted room work before
      // disposing documents. Database lifecycle hooks run only after this hook completes.
      await this.rooms.close();
      const failed = results.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    }, COLLABORATION_DRAIN_MS);
    return this.closing;
  }
}
