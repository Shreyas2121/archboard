import { Module, type DynamicModule } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RuntimeAdmission } from '../../platform/lifecycle/runtime-admission.js';
import type { ApiConfig } from '../../platform/config/index.js';
import { BoardAuthorityModule } from './board-authority.module.js';
import {
  BoardPermissionService,
  BOARD_RESOURCE_NOTIFICATION,
  type BoardResourceNotification,
} from './application/index.js';
import {
  BOARD_ACCESS_NOTIFICATION,
  type BoardAccessNotification,
} from './application/board-access-notification.js';
import { BoardService } from './application/board-service.js';
import { InviteService } from './application/invite-service.js';
import { BoardsController } from './boards.controller.js';
import { DiscussionController } from './discussion.controller.js';
import { DiscussionService } from './application/discussion-service.js';
import { PostgresDiscussionPersistence } from './infrastructure/postgres-discussion-persistence.js';
import { CommittedAnchorReader } from '../collaboration/application/index.js';
import { InvitesController } from './invites.controller.js';
import { PostgresBoardPersistence } from './infrastructure/postgres-board-persistence.js';
import { PostgresInvitePersistence } from './infrastructure/postgres-invite-persistence.js';
import { CommittedGraphCopier } from '../collaboration/application/index.js';
import { BoardOperationQueue, CommittedGraphReader } from '../collaboration/application/index.js';
import { CheckpointService } from './application/checkpoint-service.js';
import { PostgresCheckpointPersistence } from './infrastructure/postgres-checkpoint-persistence.js';
import { CheckpointsController } from './checkpoints.controller.js';
import { ImportsController } from './imports.controller.js';

@Module({})
export class BoardsModule {
  public static register(
    config: ApiConfig,
    auth: DynamicModule,
    collaboration: DynamicModule,
  ): DynamicModule {
    return {
      module: BoardsModule,
      imports: [auth, collaboration, BoardAuthorityModule],
      controllers: [
        BoardsController,
        InvitesController,
        DiscussionController,
        CheckpointsController,
        ImportsController,
      ],
      providers: [
        {
          provide: CheckpointService,
          inject: [
            DataSource,
            BoardPermissionService,
            BoardService,
            CommittedGraphReader,
            BoardOperationQueue,
            CommittedGraphCopier,
            BOARD_RESOURCE_NOTIFICATION,
            RuntimeAdmission,
          ],
          useFactory: (
            dataSource: DataSource,
            permissions: BoardPermissionService,
            boards: BoardService,
            reader: CommittedGraphReader,
            queue: BoardOperationQueue,
            copier: CommittedGraphCopier,
            notify: BoardResourceNotification,
            admission: RuntimeAdmission,
          ) =>
            new CheckpointService(
              new PostgresCheckpointPersistence(
                dataSource,
                reader,
                new PostgresBoardPersistence(dataSource, copier, admission),
                admission,
              ),
              permissions,
              boards,
              queue,
              notify,
            ),
        },
        {
          provide: DiscussionService,
          inject: [
            DataSource,
            BoardPermissionService,
            CommittedAnchorReader,
            BOARD_RESOURCE_NOTIFICATION,
            RuntimeAdmission,
          ],
          useFactory: (
            dataSource: DataSource,
            permissions: BoardPermissionService,
            anchors: CommittedAnchorReader,
            notify: BoardResourceNotification,
            admission: RuntimeAdmission,
          ) =>
            new DiscussionService(
              new PostgresDiscussionPersistence(dataSource, anchors, admission),
              permissions,
              notify,
            ),
        },
        {
          provide: BoardService,
          inject: [
            DataSource,
            BoardPermissionService,
            BOARD_ACCESS_NOTIFICATION,
            CommittedGraphCopier,
            BOARD_RESOURCE_NOTIFICATION,
            RuntimeAdmission,
          ],
          useFactory: (
            dataSource: DataSource,
            permissions: BoardPermissionService,
            notify: BoardAccessNotification,
            copier: CommittedGraphCopier,
            resourcesChanged: BoardResourceNotification,
            admission: RuntimeAdmission,
          ) =>
            new BoardService(
              new PostgresBoardPersistence(dataSource, copier, admission),
              permissions,
              notify,
              resourcesChanged,
            ),
        },
        {
          provide: InviteService,
          inject: [DataSource, BoardPermissionService, BOARD_ACCESS_NOTIFICATION, RuntimeAdmission],
          useFactory: (
            dataSource: DataSource,
            permissions: BoardPermissionService,
            notify: BoardAccessNotification,
            admission: RuntimeAdmission,
          ) =>
            new InviteService(
              new PostgresInvitePersistence(
                dataSource,
                config.allowedWebOrigins[0]!,
                undefined,
                admission,
              ),
              permissions,
              notify,
            ),
        },
      ],
      exports: [BoardService, InviteService, CheckpointService],
    };
  }
}
