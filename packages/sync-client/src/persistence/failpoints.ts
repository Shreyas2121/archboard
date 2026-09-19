export const INDEXEDDB_FAILPOINTS = {
  AFTER_LOCAL_UPDATE_WRITE: 'after-local-update-write',
  AFTER_ACK_WRITE: 'after-ack-write',
  AFTER_SNAPSHOT_WRITE: 'after-snapshot-write',
} as const;

export type IndexedDbFailpoint = (typeof INDEXEDDB_FAILPOINTS)[keyof typeof INDEXEDDB_FAILPOINTS];

export class IndexedDbFailpointController {
  private readonly armed = new Set<IndexedDbFailpoint>();

  public arm(point: IndexedDbFailpoint): void {
    this.armed.add(point);
  }

  public consume(point: IndexedDbFailpoint): boolean {
    if (!this.armed.has(point)) return false;
    this.armed.delete(point);
    return true;
  }
}
