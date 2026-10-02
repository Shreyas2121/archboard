import { IsNull, type QueryRunner } from 'typeorm';

import { PostgresTransaction } from '../../../platform/database/postgres-transaction.js';

import { BoardEntity } from './entities/board.entity.js';
import { BoardMemberEntity } from './entities/board-member.entity.js';

export interface LockedBoard {
  readonly id: string;
  readonly ownerUserId: string;
  readonly archivedAt: Date | null;
  readonly metadataVersion: number;
  readonly latestSeq: string;
  readonly memberRole: 'editor' | 'viewer' | null;
}

export class BoardTransaction extends PostgresTransaction {
  public async lockBoard(
    runner: QueryRunner,
    boardId: string,
    actorUserId: string,
  ): Promise<LockedBoard | null> {
    const board = await runner.manager
      .getRepository(BoardEntity)
      .createQueryBuilder('board')
      .where('board.id = :boardId', { boardId })
      .setLock('pessimistic_write')
      .getOne();
    if (!board) return null;
    const member = await runner.manager
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

  public async lockUserAndCountActiveOwnedBoards(
    runner: QueryRunner,
    userId: string,
  ): Promise<number> {
    const users = (await runner.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [
      userId,
    ])) as { id: string }[];
    if (users.length !== 1) throw new Error('The board owner does not exist.');
    return runner.manager.getRepository(BoardEntity).countBy({
      ownerUserId: userId,
      archivedAt: IsNull(),
    });
  }
}
