import type { BoardRole, ErrorCode, InvalidateMessage } from '@archboard/contracts';

export type ResourceRefreshEvent = { readonly boardId: string } & (
  | { readonly kind: 'ready' }
  | { readonly kind: 'invalidate'; readonly resource: InvalidateMessage['data']['resource'] }
  | { readonly kind: 'access'; readonly role: BoardRole | null; readonly code?: ErrorCode }
);

/** Relational hints have their own channel; they never publish graph saved/ACK state. */
export class ResourceRefreshEvents {
  private readonly listeners = new Set<(event: ResourceRefreshEvent) => void>();
  public subscribe(listener: (event: ResourceRefreshEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  public emit(event: ResourceRefreshEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* A REST consumer must not interrupt graph transport. */
      }
    }
  }
}
