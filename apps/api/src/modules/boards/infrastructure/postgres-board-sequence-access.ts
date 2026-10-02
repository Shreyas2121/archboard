import type { ServerSequence } from '@archboard/contracts';
import type { QueryRunner } from 'typeorm';
import { BoardSequenceAccess } from '../application/permissions/board-sequence-access.js';
import type { BoardPermissionTransaction } from '../application/permissions/board-permissions.js';
import { BoardEntity } from './entities/board.entity.js';

export class PostgresBoardSequenceAccess extends BoardSequenceAccess {
  private runner(transaction: BoardPermissionTransaction): QueryRunner {
    if (!transaction.isTransactionActive)
      throw new Error('Board sequence access requires an active transaction.');
    return transaction as QueryRunner;
  }

  public async lock(
    transaction: BoardPermissionTransaction,
    boardId: string,
  ): Promise<string | null> {
    const board = await this.runner(transaction)
      .manager.getRepository(BoardEntity)
      .createQueryBuilder('board')
      .where('board.id = :boardId', { boardId })
      .setLock('pessimistic_write')
      .getOne();
    return board?.latestSeq ?? null;
  }

  public async advance(
    transaction: BoardPermissionTransaction,
    boardId: string,
    sequence: ServerSequence,
  ): Promise<void> {
    await this.runner(transaction)
      .manager.getRepository(BoardEntity)
      .update(
        { id: boardId },
        { latestSeq: sequence, contentUpdatedAt: () => 'CURRENT_TIMESTAMP' },
      );
  }
}
