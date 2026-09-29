import { GRAPH_SCHEMA_VERSION } from '@archboard/contracts';
import { SYNC_DATABASE_VERSION, type PendingAccountBoard } from '@archboard/sync-client';

export type UpdateSafety =
  'compatible' | 'unsupported-worker' | 'unsupported-local-schema' | 'other-tabs-open';

export interface WorkerCompatibility {
  readonly graphSchemaVersion: number;
  readonly syncDatabaseVersion: number;
  readonly openClientCount: number;
}

export function updateSafety(
  worker: WorkerCompatibility | null,
  pendingBoards: readonly PendingAccountBoard[],
): UpdateSafety {
  if (
    worker?.graphSchemaVersion !== GRAPH_SCHEMA_VERSION ||
    worker.syncDatabaseVersion !== SYNC_DATABASE_VERSION
  )
    return 'unsupported-worker';
  if (worker.openClientCount !== 1) return 'other-tabs-open';
  if (pendingBoards.some((board) => board.namespace.graphSchemaVersion !== GRAPH_SCHEMA_VERSION))
    return 'unsupported-local-schema';
  return 'compatible';
}

export function samePendingWork(
  left: readonly PendingAccountBoard[],
  right: readonly PendingAccountBoard[],
): boolean {
  const key = (board: PendingAccountBoard) =>
    JSON.stringify([
      board.namespace.deploymentOrigin,
      board.namespace.userId,
      board.namespace.boardId,
      board.namespace.graphSchemaVersion,
      [...board.updateIds].sort(),
    ]);
  return JSON.stringify(left.map(key).sort()) === JSON.stringify(right.map(key).sort());
}
