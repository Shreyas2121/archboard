import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BoardPermissionService, BoardAuthorityTransaction } from './application/index.js';
import type { BoardPermissionTransaction } from './application/index.js';
import { BoardTransaction } from './infrastructure/board-transaction.js';
import { PostgresBoardAuthorityReader } from './infrastructure/postgres-board-authority-reader.js';

/** Shared authority port avoids a Boards/Collaboration module dependency cycle. */
@Module({
  providers: [
    {
      provide: BoardAuthorityTransaction,
      inject: [DataSource],
      useFactory: (source: DataSource) => ({
        run: <T>(work: (transaction: BoardPermissionTransaction) => Promise<T>) =>
          new BoardTransaction(source).run(work),
      }),
    },
    {
      provide: BoardPermissionService,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) =>
        new BoardPermissionService(new PostgresBoardAuthorityReader(dataSource)),
    },
  ],
  exports: [BoardPermissionService, BoardAuthorityTransaction],
})
export class BoardAuthorityModule {}
