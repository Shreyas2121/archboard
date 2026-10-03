import { Module } from '@nestjs/common';
import { RuntimeAdmission } from '../../platform/lifecycle/runtime-admission.js';
import { DataSource } from 'typeorm';
import { BoardPermissionService, BoardAuthorityTransaction } from './application/index.js';
import type { BoardPermissionTransaction } from './application/index.js';
import { BoardTransaction } from './infrastructure/board-transaction.js';
import { PostgresBoardAuthorityReader } from './infrastructure/postgres-board-authority-reader.js';
import { BoardSequenceAccess } from './application/index.js';
import { PostgresBoardSequenceAccess } from './infrastructure/postgres-board-sequence-access.js';

/** Shared authority port avoids a Boards/Collaboration module dependency cycle. */
@Module({
  providers: [
    { provide: BoardSequenceAccess, useFactory: () => new PostgresBoardSequenceAccess() },
    {
      provide: BoardAuthorityTransaction,
      inject: [DataSource, RuntimeAdmission],
      useFactory: (source: DataSource, admission: RuntimeAdmission) => ({
        run: <T>(work: (transaction: BoardPermissionTransaction) => Promise<T>) =>
          new BoardTransaction(source, admission).run(work),
      }),
    },
    {
      provide: BoardPermissionService,
      inject: [DataSource],
      useFactory: (dataSource: DataSource) =>
        new BoardPermissionService(new PostgresBoardAuthorityReader(dataSource)),
    },
  ],
  exports: [BoardPermissionService, BoardAuthorityTransaction, BoardSequenceAccess],
})
export class BoardAuthorityModule {}
