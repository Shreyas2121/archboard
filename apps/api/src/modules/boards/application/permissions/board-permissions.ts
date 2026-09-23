import { BOARD_ROLES, ERROR_CODES, type ErrorCode } from '@archboard/contracts';

// The application sees only an active transaction scope; the adapter owns its database type.
export interface BoardPermissionTransaction {
  readonly isTransactionActive: boolean;
}

export type BoardOperation =
  'read' | 'editMetadata' | 'editGraph' | 'manageAccess' | 'manageLifecycle';
export type EffectiveBoardRole = 'owner' | 'editor' | 'viewer';

export interface BoardAuthorityState {
  readonly id: string;
  readonly ownerUserId: string;
  readonly memberRole: 'editor' | 'viewer' | null;
  readonly archivedAt: Date | null;
  readonly metadataVersion: number;
  readonly latestSeq: string;
}

export interface BoardAuthorityReader {
  read(boardId: string, actorUserId: string): Promise<BoardAuthorityState | null>;
  lock(
    transaction: BoardPermissionTransaction,
    boardId: string,
    actorUserId: string,
  ): Promise<BoardAuthorityState | null>;
}

export type BoardPermissionDecision =
  | {
      readonly allowed: true;
      readonly role: EffectiveBoardRole;
      readonly board: BoardAuthorityState;
    }
  | { readonly allowed: false; readonly code: ErrorCode };

export function decideBoardPermission(
  operation: BoardOperation,
  board: BoardAuthorityState | null,
  actorUserId: string,
): BoardPermissionDecision {
  const role: EffectiveBoardRole | null =
    board === null
      ? null
      : board.ownerUserId === actorUserId
        ? BOARD_ROLES.OWNER
        : board.memberRole;
  if (role === null || board === null) return { allowed: false, code: ERROR_CODES.NOT_FOUND };
  if (operation === 'read') return { allowed: true, role, board };
  if (operation === 'manageLifecycle') {
    return role === BOARD_ROLES.OWNER
      ? { allowed: true, role, board }
      : { allowed: false, code: ERROR_CODES.FORBIDDEN };
  }
  if (operation === 'manageAccess' && role !== BOARD_ROLES.OWNER) {
    return { allowed: false, code: ERROR_CODES.FORBIDDEN };
  }
  if ((operation === 'editMetadata' || operation === 'editGraph') && role === BOARD_ROLES.VIEWER) {
    return { allowed: false, code: ERROR_CODES.FORBIDDEN };
  }
  if (board.archivedAt !== null) return { allowed: false, code: ERROR_CODES.BOARD_ARCHIVED };
  return { allowed: true, role, board };
}

export class BoardPermissionService {
  public constructor(private readonly reader: BoardAuthorityReader) {}

  public read(boardId: string, actorUserId: string): Promise<BoardPermissionDecision> {
    return this.check('read', boardId, actorUserId);
  }

  public readLocked(
    transaction: BoardPermissionTransaction,
    boardId: string,
    actorUserId: string,
  ): Promise<BoardPermissionDecision> {
    return this.check('read', boardId, actorUserId, transaction);
  }

  // Advisory preflight only. Mutations must call the locked operation again before writing.
  public previewEditGraph(boardId: string, actorUserId: string): Promise<BoardPermissionDecision> {
    return this.check('editGraph', boardId, actorUserId);
  }

  public editMetadata(
    transaction: BoardPermissionTransaction,
    boardId: string,
    actorUserId: string,
  ): Promise<BoardPermissionDecision> {
    return this.check('editMetadata', boardId, actorUserId, transaction);
  }

  public editGraph(
    transaction: BoardPermissionTransaction,
    boardId: string,
    actorUserId: string,
  ): Promise<BoardPermissionDecision> {
    return this.check('editGraph', boardId, actorUserId, transaction);
  }

  public manageAccess(
    transaction: BoardPermissionTransaction,
    boardId: string,
    actorUserId: string,
  ): Promise<BoardPermissionDecision> {
    return this.check('manageAccess', boardId, actorUserId, transaction);
  }

  public manageLifecycle(
    transaction: BoardPermissionTransaction,
    boardId: string,
    actorUserId: string,
  ): Promise<BoardPermissionDecision> {
    return this.check('manageLifecycle', boardId, actorUserId, transaction);
  }

  private async check(
    operation: BoardOperation,
    boardId: string,
    actorUserId: string,
    transaction?: BoardPermissionTransaction,
  ): Promise<BoardPermissionDecision> {
    const board =
      transaction === undefined
        ? await this.reader.read(boardId, actorUserId)
        : await this.reader.lock(transaction, boardId, actorUserId);
    return decideBoardPermission(operation, board, actorUserId);
  }
}
