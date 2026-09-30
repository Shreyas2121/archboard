import { Module, type DynamicModule } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { ApiConfig } from '../../platform/config/index.js';
import { BoardAuthorityModule } from './board-authority.module.js';
import { BoardPermissionService } from './application/index.js';
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
import { ValidationWorkerPool } from '../collaboration/infrastructure/validation-worker/index.js';

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
      controllers: [BoardsController, InvitesController, DiscussionController],
      providers: [
        {
          provide: DiscussionService,
          inject: [DataSource, BoardPermissionService, CommittedAnchorReader],
          useFactory: (
            dataSource: DataSource,
            permissions: BoardPermissionService,
            anchors: CommittedAnchorReader,
          ) =>
            new DiscussionService(
              new PostgresDiscussionPersistence(dataSource, anchors),
              permissions,
            ),
        },
        {
          provide: BoardService,
          inject: [
            DataSource,
            BoardPermissionService,
            BOARD_ACCESS_NOTIFICATION,
            ValidationWorkerPool,
          ],
          useFactory: (
            dataSource: DataSource,
            permissions: BoardPermissionService,
            notify: BoardAccessNotification,
            workers: ValidationWorkerPool,
          ) =>
            new BoardService(
              new PostgresBoardPersistence(dataSource, workers),
              permissions,
              notify,
            ),
        },
        {
          provide: InviteService,
          inject: [DataSource, BoardPermissionService, BOARD_ACCESS_NOTIFICATION],
          useFactory: (
            dataSource: DataSource,
            permissions: BoardPermissionService,
            notify: BoardAccessNotification,
          ) =>
            new InviteService(
              new PostgresInvitePersistence(dataSource, config.allowedWebOrigins[0]!),
              permissions,
              notify,
            ),
        },
      ],
      exports: [BoardService, InviteService],
    };
  }
}
