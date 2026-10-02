import type { BoardSummary } from '@archboard/contracts';
import type { EditorSessionSnapshot } from '../application/editor-session';

export const RECEIPT_WINDOW_MS = 86_400_000;
export const JSON_PREVIEW_INDENT = 2;
export const HTTP_NOT_FOUND = 404;
export const HTTP_PAYLOAD_TOO_LARGE = 413;
export const HTTP_SERVER_ERROR = 500;

export function isNewPrivateBoard(
  board: BoardSummary,
  accountId: string,
  sourceId?: string,
): boolean {
  return board.owner.id === accountId && board.effectiveRole === 'owner' && board.id !== sourceId;
}

export function localDurability(snapshot: EditorSessionSnapshot, online: boolean) {
  const persistence = snapshot.writer.persistence;
  const sync = snapshot.sync;
  return {
    online,
    authoritative: !snapshot.accessDenied && sync?.connected === true && sync.ready,
    persistencePending: !persistence?.savedOnDevice || persistence.pendingWrites !== 0,
    outboxPending: sync === null || sync.pendingCount !== 0,
    acknowledged: sync?.phase === 'saved-to-server',
  };
}

export function checkpointBlocker(
  snapshot: EditorSessionSnapshot,
  board: BoardSummary | undefined,
  online: boolean,
  fresh: boolean,
  atCap: boolean,
): string | null {
  if (!online) return 'Reconnect and authenticate to create a checkpoint.';
  if (!fresh || !board || snapshot.accessDenied) return 'Refresh current board access first.';
  if (atCap) return 'This board has reached its 100 checkpoint limit.';
  if (board.archivedAt || snapshot.archived) return 'Archived boards cannot create checkpoints.';
  if (
    !['owner', 'editor'].includes(board.effectiveRole) ||
    (snapshot.boardRole !== null && snapshot.boardRole !== board.effectiveRole)
  )
    return 'Current owner or editor access is required.';
  const durability = localDurability(snapshot, online);
  if (durability.persistencePending) return 'Wait until all local writes are saved on this device.';
  if (!durability.authoritative || !durability.acknowledged || durability.outboxPending)
    return 'Wait for server acknowledgment of every queued change.';
  return null;
}

/** A receipt retry must retain both the body bytes and key, even after editing or reconnect. */
export class PortableSubmission {
  public readonly key: string;
  public readonly startedAt: number;
  public readonly json: string;
  public state: 'pending' | 'uncertain' | 'rejected' = 'pending';
  public constructor(key: string, body: unknown, startedAt: number) {
    this.key = key;
    this.startedAt = startedAt;
    this.json = JSON.stringify(body);
  }
  public retryable(now: number): boolean {
    return (
      this.state === 'uncertain' &&
      now >= this.startedAt &&
      now - this.startedAt < RECEIPT_WINDOW_MS
    );
  }
}

/** Also fences adapters that ignore AbortSignal. */
export class PortabilityGeneration {
  private generation = 0;
  public capture(): number {
    return this.generation;
  }
  public invalidate(): void {
    this.generation += 1;
  }
  public current(generation: number): boolean {
    return generation === this.generation;
  }
}
