import { Brackets, type QueryRunner } from 'typeorm';

import { BoardEntity } from './entities/board.entity.js';
import { BoardInviteEntity } from './entities/board-invite.entity.js';
import { BoardMemberEntity } from './entities/board-member.entity.js';
import type { InitialBoardSnapshot } from './empty-board-snapshot.js';

export type BoardRecord = Readonly<BoardEntity>;
export type BoardListRecord = BoardRecord & { readonly contentUpdatedAtCursor: string };

export class BoardRepository {
  public constructor(private readonly runner: QueryRunner) {}

  public async create(
    ownerUserId: string,
    title: string,
    description: string,
  ): Promise<BoardRecord> {
    const result = await this.runner.manager
      .getRepository(BoardEntity)
      .createQueryBuilder()
      .insert()
      .values({
        ownerUserId,
        title,
        description,
        contentUpdatedAt: () => 'CURRENT_TIMESTAMP',
        createdAt: () => 'CURRENT_TIMESTAMP',
        updatedAt: () => 'CURRENT_TIMESTAMP',
      })
      .returning('*')
      .execute();
    return this.runner.manager.getRepository(BoardEntity).findOneByOrFail({
      id: result.identifiers[0]!.id as string,
    });
  }

  public async get(boardId: string): Promise<BoardRecord | null> {
    return this.runner.manager.getRepository(BoardEntity).findOneBy({ id: boardId });
  }

  public async listAccessible(
    userId: string,
    archived: boolean,
    limit: number,
    cursor?: { contentUpdatedAt: string; id: string },
    search?: string,
  ): Promise<BoardListRecord[]> {
    const query = this.runner.manager
      .getRepository(BoardEntity)
      .createQueryBuilder('board')
      .where(
        new Brackets((where) => {
          where.where('board.owner_user_id = :userId', { userId }).orWhere(
            `EXISTS (SELECT 1 FROM board_members member
            WHERE member.board_id = board.id AND member.user_id = :userId)`,
            { userId },
          );
        }),
      )
      .andWhere(archived ? 'board.archived_at IS NOT NULL' : 'board.archived_at IS NULL')
      .addSelect(
        `to_char(board.content_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        'content_updated_at_cursor',
      )
      .orderBy('board.content_updated_at', 'DESC')
      .addOrderBy('board.id', 'DESC')
      .take(limit);
    if (cursor)
      query.andWhere(
        '(board.content_updated_at, board.id) < (CAST(:timestamp AS timestamptz), CAST(:cursorId AS uuid))',
        { timestamp: cursor.contentUpdatedAt, cursorId: cursor.id },
      );
    if (search) query.andWhere('position(lower(:search) in lower(board.title)) > 0', { search });
    const { entities, raw } = await query.getRawAndEntities();
    return entities.map((board, index) => ({
      ...board,
      contentUpdatedAtCursor: raw[index]!.content_updated_at_cursor as string,
    }));
  }
}

export type MemberRecord = Readonly<BoardMemberEntity>;

export class BoardMemberRepository {
  public constructor(private readonly runner: QueryRunner) {}

  public async get(boardId: string, userId: string): Promise<MemberRecord | null> {
    return this.runner.manager.getRepository(BoardMemberEntity).findOneBy({ boardId, userId });
  }

  public async list(boardId: string): Promise<MemberRecord[]> {
    return this.runner.manager.getRepository(BoardMemberEntity).find({
      where: { boardId },
      order: { createdAt: 'ASC', userId: 'ASC' },
    });
  }
}

export type InviteRecord = Readonly<BoardInviteEntity>;

export class BoardInviteRepository {
  public constructor(private readonly runner: QueryRunner) {}

  public async get(boardId: string, inviteId: string): Promise<InviteRecord | null> {
    return this.runner.manager
      .getRepository(BoardInviteEntity)
      .findOneBy({ boardId, id: inviteId });
  }

  public async findByTokenHash(tokenHash: Buffer): Promise<InviteRecord | null> {
    return this.runner.manager.getRepository(BoardInviteEntity).findOneBy({ tokenHash });
  }

  public async list(boardId: string): Promise<InviteRecord[]> {
    return this.runner.manager.getRepository(BoardInviteEntity).find({
      where: { boardId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }
}

export interface CommittedGraph {
  snapshot: {
    readonly schemaVersion: number;
    readonly throughSeq: string;
    readonly updateBytes: Buffer;
    readonly byteLength: number;
  };
  updates: { readonly sequence: string; readonly updateBytes: Buffer }[];
}

export class CommittedGraphRepository {
  public constructor(private readonly runner: QueryRunner) {}

  public async createInitialSnapshot(
    boardId: string,
    snapshot: InitialBoardSnapshot,
  ): Promise<void> {
    await this.runner.manager
      .createQueryBuilder()
      .insert()
      .into('board_snapshots')
      .values({
        boardId,
        schemaVersion: snapshot.schemaVersion,
        throughSeq: snapshot.throughSeq,
        updateBytes: snapshot.updateBytes,
        byteLength: snapshot.byteLength,
        updatedAt: () => 'CURRENT_TIMESTAMP',
      })
      .execute();
  }

  public async load(boardId: string, latestSeq?: string): Promise<CommittedGraph | null> {
    const snapshot = (await this.runner.manager
      .createQueryBuilder()
      .select('snapshot.schema_version', 'schemaVersion')
      .addSelect('snapshot.through_seq::text', 'throughSeq')
      .addSelect('snapshot.update_bytes', 'updateBytes')
      .addSelect('snapshot.byte_length', 'byteLength')
      .from('board_snapshots', 'snapshot')
      .where('snapshot.board_id = :boardId', { boardId })
      .getRawOne()) as CommittedGraph['snapshot'] | undefined;
    if (!snapshot) return null;
    const updatesQuery = this.runner.manager
      .createQueryBuilder()
      .select('board_update.seq::text', 'sequence')
      .addSelect('board_update.update_bytes', 'updateBytes')
      .from('board_updates', 'board_update')
      .where('board_update.board_id = :boardId', { boardId })
      .andWhere('board_update.seq > CAST(:throughSeq AS bigint)', {
        throughSeq: snapshot.throughSeq,
      })
      .orderBy('board_update.seq', 'ASC');
    if (latestSeq !== undefined)
      updatesQuery.andWhere('board_update.seq <= CAST(:latestSeq AS bigint)', { latestSeq });
    const updates = (await updatesQuery.getRawMany()) as CommittedGraph['updates'];
    return { snapshot, updates };
  }
}
