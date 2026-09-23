import type { DataSource, QueryRunner } from 'typeorm';

import type {
  BoardAuthorityReader,
  BoardAuthorityState,
  BoardPermissionTransaction,
} from '../application/index.js';
import { BoardTransaction } from './board-transaction.js';
import { BoardEntity } from './entities/board.entity.js';
import { BoardMemberEntity } from './entities/board-member.entity.js';

export class PostgresBoardAuthorityReader implements BoardAuthorityReader {
  private readonly transactions: BoardTransaction;

  public constructor(private readonly dataSource: DataSource) {
    this.transactions = new BoardTransaction(dataSource);
  }

  public async read(boardId: string, actorUserId: string): Promise<BoardAuthorityState | null> {
    const board = await this.dataSource.getRepository(BoardEntity).findOneBy({ id: boardId });
    if (!board) return null;
    const member =
      board.ownerUserId === actorUserId
        ? null
        : await this.dataSource
            .getRepository(BoardMemberEntity)
            .findOneBy({ boardId, userId: actorUserId });
    return {
      id: board.id,
      ownerUserId: board.ownerUserId,
      archivedAt: board.archivedAt,
      metadataVersion: board.metadataVersion,
      latestSeq: board.latestSeq,
      memberRole: member?.role ?? null,
    };
  }

  public lock(
    transaction: BoardPermissionTransaction,
    boardId: string,
    actorUserId: string,
  ): Promise<BoardAuthorityState | null> {
    if (!transaction.isTransactionActive)
      throw new Error('A board permission write requires an active transaction.');
    return this.transactions.lockBoard(transaction as QueryRunner, boardId, actorUserId);
  }
}
