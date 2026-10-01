import {
  ERROR_CODES,
  MAX_ACTIVE_OWNED_BOARDS,
  decodePageCursor,
  encodePageCursor,
  type BoardDetail,
  type BoardMember,
  type BoardListQuery,
  type BoardListResponse,
  type BoardSummary,
  type CreateBoard,
  type ChangeMemberRole,
  type DuplicateBoard,
  type BoardVersionRequest,
  type ErrorCode,
  type PatchBoard,
} from '@archboard/contracts';
import type { BoardAccessNotification } from './board-access-notification.js';
import type { BoardResourceNotification } from './board-resource-notification.js';

import {
  decideBoardPermission,
  type BoardAuthorityState,
  type BoardPermissionService,
  type BoardPermissionTransaction,
  type EffectiveBoardRole,
} from './permissions/index.js';

export interface BoardView extends BoardAuthorityState {
  readonly title: string;
  readonly description: string;
  readonly contentUpdatedAt: Date;
  readonly contentUpdatedAtCursor: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly owner: BoardSummary['owner'];
  readonly memberCount: number;
}

export interface BoardWriteScope {
  readonly permissionTransaction: BoardPermissionTransaction;
  lockOwnerAndCount(actorUserId: string): Promise<number>;
  create(actorUserId: string, title: string, description: string): Promise<string>;
  createEmptySnapshot(boardId: string): Promise<void>;
  createSnapshot(boardId: string, updateBytes: Uint8Array): Promise<void>;
  loadCommittedGraph(boardId: string, latestSeq: string): Promise<Uint8Array>;
  load(boardId: string, actorUserId: string): Promise<BoardView | null>;
  updateMetadata(boardId: string, title: string, description: string): Promise<void>;
  setArchived(boardId: string, archived: boolean): Promise<void>;
  listMembers(boardId: string): Promise<BoardMember[]>;
  getMember(boardId: string, userId: string): Promise<BoardMember | null>;
  setMemberRole(boardId: string, userId: string, role: ChangeMemberRole['role']): Promise<void>;
  removeMember(boardId: string, userId: string): Promise<void>;
}

export interface BoardPersistence {
  list(
    actorUserId: string,
    query: BoardListQuery,
    cursor?: { timestamp: string; id: string },
  ): Promise<BoardView[]>;
  load(boardId: string, actorUserId: string): Promise<BoardView | null>;
  run<T>(work: (scope: BoardWriteScope) => Promise<T>): Promise<T>;
  idempotent<T>(
    actorUserId: string,
    operation: string,
    key: string,
    request: unknown,
    work: (scope: BoardWriteScope) => Promise<{ status: number; body: T }>,
  ): Promise<{ status: number; body: T; replayed: boolean }>;
}

export class BoardServiceError extends Error {
  public constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function requireReadable(
  view: BoardView | null,
  actorUserId: string,
): { view: BoardView; role: EffectiveBoardRole } {
  const decision = decideBoardPermission('read', view, actorUserId);
  if (!decision.allowed || !view)
    throw new BoardServiceError(ERROR_CODES.NOT_FOUND, 'Board not found.');
  return { view, role: decision.role };
}

function summary(view: BoardView, role: EffectiveBoardRole): BoardSummary {
  return {
    id: view.id,
    title: view.title,
    description: view.description,
    owner: view.owner,
    effectiveRole: role,
    archivedAt: view.archivedAt?.toISOString() ?? null,
    metadataVersion: view.metadataVersion,
    latestSeq: view.latestSeq,
    contentUpdatedAt: view.contentUpdatedAt.toISOString(),
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}

function detail(view: BoardView, role: EffectiveBoardRole): BoardDetail {
  return { ...summary(view, role), memberCount: view.memberCount };
}

export class BoardService {
  public constructor(
    private readonly persistence: BoardPersistence,
    private readonly permissions: BoardPermissionService,
    private readonly accessChanged: BoardAccessNotification = async () => undefined,
    private readonly resourcesChanged: BoardResourceNotification = async () => undefined,
  ) {}

  public async create(
    actorUserId: string,
    key: string,
    input: CreateBoard,
  ): Promise<{ board: BoardDetail; replayed: boolean }> {
    const request = { title: input.title, description: input.description ?? '' };
    const result = await this.persistence.idempotent(
      actorUserId,
      'board.create',
      key,
      request,
      async (scope) => {
        const count = await scope.lockOwnerAndCount(actorUserId);
        if (count >= MAX_ACTIVE_OWNED_BOARDS) {
          throw new BoardServiceError(ERROR_CODES.RATE_LIMITED, 'Active board limit reached.');
        }
        const boardId = await scope.create(actorUserId, request.title, request.description);
        await scope.createEmptySnapshot(boardId);
        const view = await scope.load(boardId, actorUserId);
        const readable = requireReadable(view, actorUserId);
        return { status: 201, body: detail(readable.view, readable.role) };
      },
    );
    return { board: result.body, replayed: result.replayed };
  }

  public async list(actorUserId: string, query: BoardListQuery): Promise<BoardListResponse> {
    const cursor = query.cursor ? decodePageCursor(query.cursor) : undefined;
    const rows = await this.persistence.list(actorUserId, query, cursor);
    const visible = rows.slice(0, query.limit);
    const data = visible.map((view) => {
      const readable = requireReadable(view, actorUserId);
      return summary(readable.view, readable.role);
    });
    const last = visible.at(-1);
    const nextCursor =
      rows.length > query.limit && last
        ? encodePageCursor(last.contentUpdatedAtCursor, last.id)
        : null;
    return { data, nextCursor };
  }

  public async read(actorUserId: string, boardId: string): Promise<BoardDetail> {
    const readable = requireReadable(
      await this.persistence.load(boardId, actorUserId),
      actorUserId,
    );
    return detail(readable.view, readable.role);
  }

  public async update(
    actorUserId: string,
    boardId: string,
    input: PatchBoard,
  ): Promise<BoardDetail> {
    let changed = false;
    const result = await this.persistence.run(async (scope) => {
      const decision = await this.permissions.editMetadata(
        scope.permissionTransaction,
        boardId,
        actorUserId,
      );
      if (!decision.allowed)
        throw new BoardServiceError(decision.code, 'Board metadata update unavailable.');
      const current = await scope.load(boardId, actorUserId);
      if (!current) throw new BoardServiceError(ERROR_CODES.NOT_FOUND, 'Board not found.');
      if (current.metadataVersion !== input.expectedVersion) {
        throw new BoardServiceError(
          ERROR_CODES.VERSION_CONFLICT,
          'Board metadata version is stale.',
        );
      }
      const title = input.title ?? current.title;
      const description = input.description ?? current.description;
      if (title === current.title && description === current.description)
        return detail(current, decision.role);
      await scope.updateMetadata(boardId, title, description);
      changed = true;
      const updated = await scope.load(boardId, actorUserId);
      if (!updated) throw new Error('Updated board disappeared inside its transaction.');
      return detail(updated, decision.role);
    });
    if (changed) {
      try {
        await this.resourcesChanged(boardId, ['metadata']);
      } catch {
        /* Best-effort committed hint. */
      }
    }
    return result;
  }

  public async archive(
    actorUserId: string,
    boardId: string,
    input: BoardVersionRequest,
  ): Promise<BoardDetail> {
    return this.setArchiveState(actorUserId, boardId, input, true);
  }

  public async restore(
    actorUserId: string,
    boardId: string,
    input: BoardVersionRequest,
  ): Promise<BoardDetail> {
    return this.setArchiveState(actorUserId, boardId, input, false);
  }

  private async setArchiveState(
    actorUserId: string,
    boardId: string,
    input: BoardVersionRequest,
    archived: boolean,
  ): Promise<BoardDetail> {
    let changed = false;
    const result = await this.persistence.run(async (scope) => {
      const activeOwnedCount = archived ? undefined : await scope.lockOwnerAndCount(actorUserId);
      const decision = await this.permissions.manageLifecycle(
        scope.permissionTransaction,
        boardId,
        actorUserId,
      );
      if (!decision.allowed)
        throw new BoardServiceError(decision.code, 'Board lifecycle action unavailable.');
      const current = await scope.load(boardId, actorUserId);
      if (!current) throw new Error('Locked board disappeared inside its transaction.');
      if (current.metadataVersion !== input.expectedVersion)
        throw new BoardServiceError(
          ERROR_CODES.VERSION_CONFLICT,
          'Board metadata version is stale.',
        );
      if ((current.archivedAt !== null) === archived) return detail(current, decision.role);
      if (!archived && activeOwnedCount! >= MAX_ACTIVE_OWNED_BOARDS)
        throw new BoardServiceError(ERROR_CODES.RATE_LIMITED, 'Active board limit reached.');
      await scope.setArchived(boardId, archived);
      changed = true;
      const updated = await scope.load(boardId, actorUserId);
      if (!updated) throw new Error('Updated board disappeared inside its transaction.');
      return detail(updated, decision.role);
    });
    if (changed) await this.accessChanged(boardId);
    return result;
  }

  public async duplicate(
    actorUserId: string,
    sourceId: string,
    key: string,
    input: DuplicateBoard,
  ): Promise<{ board: BoardDetail; replayed: boolean }> {
    const result = await this.persistence.idempotent(
      actorUserId,
      'board.duplicate',
      key,
      { sourceId, title: input.title },
      async (scope) => {
        const count = await scope.lockOwnerAndCount(actorUserId);
        if (count >= MAX_ACTIVE_OWNED_BOARDS)
          throw new BoardServiceError(ERROR_CODES.RATE_LIMITED, 'Active board limit reached.');
        const decision = await this.permissions.readLocked(
          scope.permissionTransaction,
          sourceId,
          actorUserId,
        );
        if (!decision.allowed) throw new BoardServiceError(decision.code, 'Board not found.');
        const bytes = await scope.loadCommittedGraph(sourceId, decision.board.latestSeq);
        const boardId = await scope.create(actorUserId, input.title, '');
        await scope.createSnapshot(boardId, bytes);
        const view = await scope.load(boardId, actorUserId);
        const readable = requireReadable(view, actorUserId);
        return { status: 201, body: detail(readable.view, readable.role) };
      },
    );
    return { board: result.body, replayed: result.replayed };
  }

  public async members(actorUserId: string, boardId: string): Promise<BoardMember[]> {
    return this.persistence.run(async (scope) => {
      const decision = await this.permissions.readLocked(
        scope.permissionTransaction,
        boardId,
        actorUserId,
      );
      if (!decision.allowed) throw new BoardServiceError(decision.code, 'Board not found.');
      return scope.listMembers(boardId);
    });
  }

  public async changeMemberRole(
    actorUserId: string,
    boardId: string,
    targetUserId: string,
    input: ChangeMemberRole,
  ): Promise<BoardMember> {
    let membershipChanged = false;
    const result = await this.persistence.run(async (scope) => {
      const decision = await this.permissions.manageAccess(
        scope.permissionTransaction,
        boardId,
        actorUserId,
      );
      if (!decision.allowed)
        throw new BoardServiceError(decision.code, 'Board member change unavailable.');
      if (targetUserId === decision.board.ownerUserId)
        throw new BoardServiceError(ERROR_CODES.FORBIDDEN, 'The board owner cannot be demoted.');
      const member = await scope.getMember(boardId, targetUserId);
      if (!member) throw new BoardServiceError(ERROR_CODES.NOT_FOUND, 'Board member not found.');
      if (member.role === input.role) return member;
      await scope.setMemberRole(boardId, targetUserId, input.role);
      membershipChanged = true;
      const changed = await scope.getMember(boardId, targetUserId);
      if (!changed) throw new Error('Updated member disappeared inside its transaction.');
      return changed;
    });
    if (membershipChanged) await this.accessChanged(boardId, targetUserId);
    return result;
  }

  public async removeMember(
    actorUserId: string,
    boardId: string,
    targetUserId: string,
  ): Promise<void> {
    let changed = false;
    await this.persistence.run(async (scope) => {
      const decision =
        targetUserId === actorUserId
          ? await this.permissions.leave(scope.permissionTransaction, boardId, actorUserId)
          : await this.permissions.manageAccess(scope.permissionTransaction, boardId, actorUserId);
      if (!decision.allowed)
        throw new BoardServiceError(decision.code, 'Board member removal unavailable.');
      if (targetUserId === decision.board.ownerUserId)
        throw new BoardServiceError(ERROR_CODES.FORBIDDEN, 'The board owner cannot be removed.');
      if (await scope.getMember(boardId, targetUserId)) {
        await scope.removeMember(boardId, targetUserId);
        changed = true;
      }
    });
    if (changed) await this.accessChanged(boardId, targetUserId);
  }
}
