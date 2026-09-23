import { type DataSource, type QueryRunner } from 'typeorm';

import {
  BOARD_ROLES,
  INVITE_LIFETIME_DAYS,
  type BoardInvite,
  type BoardRole,
  type CreateInvite,
} from '@archboard/contracts';

import type {
  InviteListItem,
  InvitePersistence,
  InviteScope,
  InviteState,
} from '../application/invite-service.js';
import { BoardTransaction } from './board-transaction.js';
import { BoardEntity } from './entities/board.entity.js';
import { BoardInviteEntity } from './entities/board-invite.entity.js';
import { BoardMemberEntity } from './entities/board-member.entity.js';
import { IdempotencyService } from './idempotency.js';
import { createInviteToken, digestInviteToken, digestMatches } from './invite-token.js';

interface SafeUserRow {
  id: string;
  name: string;
  image: string | null;
}

interface InviteListRow extends SafeUserRow {
  invite_id: string;
  role: CreateInvite['role'];
  created_at: Date;
  created_at_cursor: string;
  expires_at: Date;
  status: BoardInvite['status'];
}

export class PostgresInvitePersistence implements InvitePersistence {
  private readonly transactions: BoardTransaction;
  private readonly idempotency: IdempotencyService;

  public constructor(
    dataSource: DataSource,
    private readonly webOrigin: string,
    private readonly beforeBoardLock?: () => Promise<void>,
  ) {
    this.transactions = new BoardTransaction(dataSource);
    this.idempotency = new IdempotencyService(dataSource);
  }

  public run<T>(work: (scope: InviteScope) => Promise<T>): Promise<T> {
    return this.transactions.run((runner) => work(this.scope(runner)));
  }

  public idempotent<T>(
    actorUserId: string,
    operation: string,
    key: string,
    request: unknown,
    work: (scope: InviteScope) => Promise<{ status: number; body: T; replaySafeBody?: T }>,
  ): Promise<{ status: number; body: T; replayed: boolean }> {
    return this.idempotency.execute(actorUserId, operation, key, request, (runner) =>
      work(this.scope(runner)),
    );
  }

  private scope(runner: QueryRunner): InviteScope {
    const repository = runner.manager.getRepository(BoardInviteEntity);
    return {
      permissionTransaction: runner,
      create: async (boardId, actorUserId, role) => {
        const { token, digest } = createInviteToken();
        const rows = (await runner.query(
          `INSERT INTO board_invites (board_id, token_hash, role, created_by, expires_at)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP + $5 * INTERVAL '1 day')
           RETURNING id, role, created_at, expires_at`,
          [boardId, digest, role, actorUserId, INVITE_LIFETIME_DAYS],
        )) as { id: string; role: CreateInvite['role']; created_at: Date; expires_at: Date }[];
        const created = rows[0];
        if (!created) throw new Error('Invitation insert returned no row.');
        const actor = await this.user(runner, actorUserId);
        const inviteUrl = new URL(`/invite/${token}`, this.webOrigin).toString();
        return {
          id: created.id,
          role: created.role,
          createdBy: actor,
          createdAt: created.created_at.toISOString(),
          expiresAt: created.expires_at.toISOString(),
          status: 'active',
          inviteUrl,
          inviteUrlAvailable: true,
        };
      },
      list: async (boardId, limit, cursor) => {
        const rows = (await runner.query(
          `SELECT invite.id AS invite_id, invite.role, invite.created_at, invite.expires_at,
             to_char(invite.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor,
             CASE WHEN invite.accepted_at IS NOT NULL THEN 'accepted'
               WHEN invite.revoked_at IS NOT NULL THEN 'revoked'
               WHEN invite.expires_at <= clock_timestamp() THEN 'expired'
               ELSE 'active' END AS status,
             creator.id, creator.name, creator.image
           FROM board_invites invite JOIN "user" creator ON creator.id = invite.created_by
           WHERE invite.board_id = $1
             AND ($3::timestamptz IS NULL OR (invite.created_at, invite.id) < ($3::timestamptz, $4::uuid))
           ORDER BY invite.created_at DESC, invite.id DESC
           LIMIT $2`,
          [boardId, limit, cursor?.timestamp ?? null, cursor?.id ?? null],
        )) as InviteListRow[];
        return rows.map((row): InviteListItem => ({
          invite: {
            id: row.invite_id,
            role: row.role,
            createdBy: { id: row.id, name: row.name, image: row.image },
            createdAt: row.created_at.toISOString(),
            expiresAt: row.expires_at.toISOString(),
            status: row.status,
          },
          createdAtCursor: row.created_at_cursor,
        }));
      },
      get: async (boardId, inviteId, lock) => {
        const query = repository
          .createQueryBuilder('invite')
          .where('invite.board_id = :boardId AND invite.id = :inviteId', { boardId, inviteId });
        if (lock) query.setLock('pessimistic_write');
        const invite = await query.getOne();
        return invite ? this.state(invite) : null;
      },
      revoke: async (boardId, inviteId) => {
        await runner.query(
          'UPDATE board_invites SET revoked_at = clock_timestamp() WHERE board_id = $1 AND id = $2 AND revoked_at IS NULL',
          [boardId, inviteId],
        );
      },
      candidate: async (token) => {
        const digest = digestInviteToken(token);
        if (!digest) return null;
        const invite = await repository.findOne({
          where: { tokenHash: digest },
          select: { id: true, boardId: true },
        });
        return invite ? { id: invite.id, boardId: invite.boardId } : null;
      },
      getByToken: async (candidate, token, lock) => {
        const invite = await (async () => {
          const query = repository
            .createQueryBuilder('invite')
            .where('invite.board_id = :boardId AND invite.id = :inviteId', {
              boardId: candidate.boardId,
              inviteId: candidate.id,
            });
          if (lock) query.setLock('pessimistic_write');
          return query.getOne();
        })();
        const digest = digestInviteToken(token);
        return invite && digest && digestMatches(invite.tokenHash, digest)
          ? this.state(invite)
          : null;
      },
      board: async (boardId, lock) => {
        if (lock) await this.beforeBoardLock?.();
        const query = runner.manager
          .getRepository(BoardEntity)
          .createQueryBuilder('board')
          .where('board.id = :boardId', { boardId });
        if (lock) query.setLock('pessimistic_write');
        const board = await query.getOne();
        return board
          ? {
              id: board.id,
              title: board.title,
              ownerUserId: board.ownerUserId,
              archivedAt: board.archivedAt,
            }
          : null;
      },
      inviterName: async (userId) => (await this.user(runner, userId)).name,
      now: async () => {
        const rows = (await runner.query('SELECT clock_timestamp() AS now')) as { now: Date }[];
        return rows[0]!.now;
      },
      effectiveRole: async (board, userId) => {
        if (board.ownerUserId === userId) return BOARD_ROLES.OWNER;
        const member = await runner.manager.getRepository(BoardMemberEntity).findOneBy({
          boardId: board.id,
          userId,
        });
        return member?.role ?? null;
      },
      applyMembership: async (boardId, userId, role): Promise<BoardRole> => {
        const rows = (await runner.query(
          `INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, $3)
           ON CONFLICT (board_id, user_id) DO UPDATE SET role =
             CASE WHEN board_members.role = $4 OR EXCLUDED.role = $4 THEN $4 ELSE $5 END
           RETURNING role`,
          [boardId, userId, role, BOARD_ROLES.EDITOR, BOARD_ROLES.VIEWER],
        )) as { role: BoardRole }[];
        if (!rows[0]) throw new Error('Membership upsert returned no role.');
        return rows[0].role;
      },
      markAccepted: async (boardId, inviteId, userId) => {
        await runner.query(
          `UPDATE board_invites SET accepted_by = $3, accepted_at = clock_timestamp()
           WHERE board_id = $1 AND id = $2 AND accepted_by IS NULL`,
          [boardId, inviteId, userId],
        );
      },
    };
  }

  private state(invite: BoardInviteEntity): InviteState {
    return {
      id: invite.id,
      boardId: invite.boardId,
      role: invite.role,
      expiresAt: invite.expiresAt,
      revokedAt: invite.revokedAt,
      acceptedBy: invite.acceptedBy,
      createdBy: invite.createdBy,
    };
  }

  private async user(runner: QueryRunner, userId: string): Promise<SafeUserRow> {
    const rows = (await runner.query('SELECT id, name, image FROM "user" WHERE id = $1', [
      userId,
    ])) as SafeUserRow[];
    if (!rows[0]) throw new Error('Invitation user is missing.');
    return rows[0];
  }
}
