import type { QueryClient } from '@tanstack/react-query';
import type { InvalidateMessage } from '@archboard/contracts';
import type { ResourceRefreshEvent } from '@archboard/sync-client';

export interface BoardQueryScope {
  readonly deploymentOrigin: string;
  readonly accountId: string;
  readonly boardId: string;
}
export type BoardQueryResource = InvalidateMessage['data']['resource'] | 'invites';
export const boardListQueryKey = (origin: string, accountId: string) =>
  ['boards', origin, accountId] as const;
export const boardResourceQueryKey = (scope: BoardQueryScope, resource?: BoardQueryResource) =>
  resource === undefined
    ? (['board-resources', scope.deploymentOrigin, scope.accountId, scope.boardId] as const)
    : ([
        'board-resources',
        scope.deploymentOrigin,
        scope.accountId,
        scope.boardId,
        resource,
      ] as const);
const readableResources: readonly BoardQueryResource[] = [
  'metadata',
  'members',
  'comments',
  'checkpoints',
  'invites',
];

/** Consumers append filter/thread/page keys beneath the resource prefix. Freshness comes from
 * the successful REST query, never from a transport hint or graph sequence. */
export class BoardResourceRefresh {
  private readonly client: QueryClient;
  private readonly scope: BoardQueryScope;
  private readonly pending = new Set<BoardQueryResource>();
  private active = true;
  private online = true;
  private running: Promise<void> | null = null;
  public constructor(client: QueryClient, scope: BoardQueryScope) {
    this.client = client;
    this.scope = scope;
  }
  public receive(event: ResourceRefreshEvent): void {
    if (!this.active || event.boardId !== this.scope.boardId) return;
    if (event.kind === 'access' && event.role === null) {
      this.dispose(true);
      return;
    }
    this.refresh(event.kind === 'invalidate' ? [event.resource] : readableResources);
  }
  public mutationCommitted(resources: readonly BoardQueryResource[]): void {
    this.refresh(resources);
  }
  public inviteAccepted(): void {
    this.refresh(['members', 'metadata', 'invites']);
  }
  public setOnline(online: boolean): void {
    this.online = online;
    if (!online) void this.client.cancelQueries({ queryKey: boardResourceQueryKey(this.scope) });
    if (online) this.refresh(readableResources);
  }
  public async whenIdle(): Promise<void> {
    while (this.running !== null) await this.running;
  }
  public dispose(clearProtected = false): void {
    this.active = false;
    this.pending.clear();
    const queryKey = boardResourceQueryKey(this.scope);
    void this.client.cancelQueries({ queryKey });
    if (clearProtected) {
      this.client.removeQueries({ queryKey });
      const listKey = boardListQueryKey(this.scope.deploymentOrigin, this.scope.accountId);
      void this.client.cancelQueries({ queryKey: listKey });
      this.client.removeQueries({ queryKey: listKey });
    }
  }
  private refresh(resources: readonly BoardQueryResource[]): void {
    if (!this.active) return;
    resources.forEach((resource) => this.pending.add(resource));
    if (this.running !== null) return;
    this.running = Promise.resolve()
      .then(async () => {
        while (this.active && this.pending.size > 0) {
          const batch = [...this.pending];
          this.pending.clear();
          const keys: readonly (readonly unknown[])[] = [
            ...batch.map((resource) => boardResourceQueryKey(this.scope, resource)),
            ...(batch.includes('members') || batch.includes('metadata')
              ? [boardListQueryKey(this.scope.deploymentOrigin, this.scope.accountId)]
              : []),
          ];
          await Promise.all(
            keys.map((queryKey) =>
              this.client.invalidateQueries({
                queryKey,
                refetchType: this.online ? 'active' : 'none',
              }),
            ),
          );
        }
      })
      .catch(() => undefined)
      .finally(() => {
        this.running = null;
        // A hint can arrive after the loop finishes but before this continuation runs.
        if (this.active && this.pending.size > 0) this.refresh([]);
      });
  }
}
