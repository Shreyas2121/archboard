import {
  ERROR_CODES,
  MAX_ACTIVE_OWNED_BOARDS,
  decodePageCursor,
  encodePageCursor,
  type BoardDetail,
  type BoardListQuery,
  type BoardListResponse,
  type BoardSummary,
  type CreateBoard,
  type ErrorCode,
  type PatchBoard,
} from '@archboard/contracts';

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
  load(boardId: string, actorUserId: string): Promise<BoardView | null>;
  updateMetadata(boardId: string, title: string, description: string): Promise<void>;
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
    return this.persistence.run(async (scope) => {
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
      const updated = await scope.load(boardId, actorUserId);
      if (!updated) throw new Error('Updated board disappeared inside its transaction.');
      return detail(updated, decision.role);
    });
  }
}
