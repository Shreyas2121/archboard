import {
  BOARD_ROLES,
  ERROR_CODES,
  decodePageCursor,
  encodePageCursor,
  type BoardInvite,
  type BoardInviteListResponse,
  type CreateInvite,
  type BoardRole,
  type InviteAcceptance,
  type InviteCreateResult,
  type InviteListQuery,
  type InvitePreview,
} from '@archboard/contracts';

import type { BoardPermissionService, BoardPermissionTransaction } from './permissions/index.js';
import { BoardServiceError } from './board-service.js';
import type { BoardAccessNotification } from './board-access-notification.js';

export interface InviteCandidate {
  readonly id: string;
  readonly boardId: string;
}

export interface InviteState extends InviteCandidate {
  readonly role: CreateInvite['role'];
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly acceptedBy: string | null;
  readonly createdBy: string;
}

export interface InviteBoardState {
  readonly id: string;
  readonly title: string;
  readonly ownerUserId: string;
  readonly archivedAt: Date | null;
}

export interface InviteListItem {
  readonly invite: BoardInvite;
  readonly createdAtCursor: string;
}

export interface InviteScope {
  readonly permissionTransaction: BoardPermissionTransaction;
  create(
    boardId: string,
    actorUserId: string,
    role: CreateInvite['role'],
  ): Promise<InviteCreateResult>;
  list(
    boardId: string,
    limit: number,
    cursor?: { timestamp: string; id: string },
  ): Promise<InviteListItem[]>;
  get(boardId: string, inviteId: string, lock: boolean): Promise<InviteState | null>;
  revoke(boardId: string, inviteId: string): Promise<void>;
  candidate(token: string): Promise<InviteCandidate | null>;
  getByToken(candidate: InviteCandidate, token: string, lock: boolean): Promise<InviteState | null>;
  board(boardId: string, lock: boolean): Promise<InviteBoardState | null>;
  inviterName(userId: string): Promise<string>;
  now(): Promise<Date>;
  effectiveRole(board: InviteBoardState, userId: string): Promise<BoardRole | null>;
  applyMembership(boardId: string, userId: string, role: CreateInvite['role']): Promise<BoardRole>;
  markAccepted(boardId: string, inviteId: string, userId: string): Promise<void>;
}

export interface InvitePersistence {
  run<T>(work: (scope: InviteScope) => Promise<T>): Promise<T>;
  idempotent<T>(
    actorUserId: string,
    operation: string,
    key: string,
    request: unknown,
    work: (scope: InviteScope) => Promise<{ status: number; body: T; replaySafeBody?: T }>,
  ): Promise<{ status: number; body: T; replayed: boolean }>;
}

function unavailable(): never {
  throw new BoardServiceError(ERROR_CODES.INVITE_UNAVAILABLE, 'Invitation unavailable.');
}

export class InviteService {
  public constructor(
    private readonly persistence: InvitePersistence,
    private readonly permissions: BoardPermissionService,
    private readonly accessChanged: BoardAccessNotification = async () => undefined,
  ) {}

  public async create(
    actorUserId: string,
    boardId: string,
    key: string,
    input: CreateInvite,
  ): Promise<InviteCreateResult> {
    const result = await this.persistence.idempotent(
      actorUserId,
      'invite.create',
      key,
      { boardId, role: input.role },
      async (scope) => {
        const decision = await this.permissions.manageAccess(
          scope.permissionTransaction,
          boardId,
          actorUserId,
        );
        if (!decision.allowed)
          throw new BoardServiceError(decision.code, 'Invitation creation unavailable.');
        const body = await scope.create(boardId, actorUserId, input.role);
        return {
          status: 201,
          body,
          replaySafeBody: { ...body, inviteUrl: null, inviteUrlAvailable: false },
        };
      },
    );
    return result.body;
  }

  public async list(
    actorUserId: string,
    boardId: string,
    query: InviteListQuery,
  ): Promise<BoardInviteListResponse> {
    return this.persistence.run(async (scope) => {
      const decision = await this.permissions.manageAccess(
        scope.permissionTransaction,
        boardId,
        actorUserId,
      );
      if (!decision.allowed) throw new BoardServiceError(decision.code, 'Invitations unavailable.');
      const cursor = query.cursor ? decodePageCursor(query.cursor) : undefined;
      const rows = await scope.list(boardId, query.limit + 1, cursor);
      const visible = rows.slice(0, query.limit);
      const last = visible.at(-1);
      return {
        data: visible.map((row) => row.invite),
        nextCursor:
          rows.length > query.limit && last
            ? encodePageCursor(last.createdAtCursor, last.invite.id)
            : null,
      };
    });
  }

  public async revoke(actorUserId: string, boardId: string, inviteId: string): Promise<void> {
    await this.persistence.run(async (scope) => {
      const decision = await this.permissions.manageAccess(
        scope.permissionTransaction,
        boardId,
        actorUserId,
      );
      if (!decision.allowed)
        throw new BoardServiceError(decision.code, 'Invitation revocation unavailable.');
      const invite = await scope.get(boardId, inviteId, true);
      if (!invite) throw new BoardServiceError(ERROR_CODES.NOT_FOUND, 'Invitation not found.');
      if (invite.revokedAt) return;
      if (invite.acceptedBy)
        throw new BoardServiceError(ERROR_CODES.INVITE_EXHAUSTED, 'Invitation already accepted.');
      if (invite.expiresAt <= (await scope.now()))
        throw new BoardServiceError(ERROR_CODES.INVITE_EXPIRED, 'Invitation expired.');
      await scope.revoke(boardId, inviteId);
    });
  }

  public async preview(token: string): Promise<InvitePreview> {
    return this.persistence.run(async (scope) => {
      const candidate = await scope.candidate(token);
      if (!candidate) unavailable();
      const board = await scope.board(candidate.boardId, false);
      const invite = await scope.getByToken(candidate, token, false);
      if (!board || !invite || invite.revokedAt) unavailable();
      if (board.archivedAt)
        throw new BoardServiceError(ERROR_CODES.BOARD_ARCHIVED, 'Board is archived.');
      if (invite.acceptedBy)
        throw new BoardServiceError(ERROR_CODES.INVITE_EXHAUSTED, 'Invitation already accepted.');
      if (invite.expiresAt <= (await scope.now()))
        throw new BoardServiceError(ERROR_CODES.INVITE_EXPIRED, 'Invitation expired.');
      return {
        boardTitle: board.title,
        inviterName: await scope.inviterName(invite.createdBy),
        role: invite.role,
        expiresAt: invite.expiresAt.toISOString(),
      };
    });
  }

  public async accept(actorUserId: string, token: string): Promise<InviteAcceptance> {
    let membershipChanged = false;
    const result = await this.persistence.run(async (scope) => {
      const candidate = await scope.candidate(token);
      if (!candidate) unavailable();
      const board = await scope.board(candidate.boardId, true);
      if (!board) unavailable();
      const invite = await scope.getByToken(candidate, token, true);
      if (!invite || invite.revokedAt) unavailable();
      if (board.archivedAt)
        throw new BoardServiceError(ERROR_CODES.BOARD_ARCHIVED, 'Board is archived.');
      if (invite.acceptedBy) {
        if (invite.acceptedBy !== actorUserId)
          throw new BoardServiceError(ERROR_CODES.INVITE_EXHAUSTED, 'Invitation already accepted.');
        const role = await scope.effectiveRole(board, actorUserId);
        if (!role) unavailable();
        return { boardId: board.id, effectiveRole: role };
      }
      if (invite.expiresAt <= (await scope.now()))
        throw new BoardServiceError(ERROR_CODES.INVITE_EXPIRED, 'Invitation expired.');
      const previousRole = await scope.effectiveRole(board, actorUserId);
      const role =
        actorUserId === board.ownerUserId
          ? BOARD_ROLES.OWNER
          : await scope.applyMembership(board.id, actorUserId, invite.role);
      await scope.markAccepted(board.id, invite.id, actorUserId);
      membershipChanged = previousRole !== role;
      return { boardId: board.id, effectiveRole: role };
    });
    if (membershipChanged) await this.accessChanged(result.boardId, actorUserId);
    return result;
  }
}
