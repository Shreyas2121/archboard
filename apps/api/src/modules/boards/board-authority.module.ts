import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BoardPermissionService } from './application/index.js';
import { PostgresBoardAuthorityReader } from './infrastructure/postgres-board-authority-reader.js';

/** Shared authority port avoids a Boards/Collaboration module dependency cycle. */
@Module({
  providers: [
    {
      provide: BoardPermissionService,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) =>
        new BoardPermissionService(new PostgresBoardAuthorityReader(dataSource)),
    },
  ],
  exports: [BoardPermissionService],
})
export class BoardAuthorityModule {}
