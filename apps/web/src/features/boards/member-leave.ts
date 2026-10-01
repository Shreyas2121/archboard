import type { PendingAccountBoard, BoardStorageNamespace } from '@archboard/sync-client';

export interface MemberLeavePorts {
  readonly namespace: BoardStorageNamespace;
  readonly assertAllowed: () => void;
  readonly freeze: () => Promise<void>;
  readonly resume: () => void;
  readonly readPending: () => Promise<readonly PendingAccountBoard[]>;
  readonly download: (boards: readonly PendingAccountBoard[]) => Promise<void>;
  readonly remove: () => Promise<void>;
  readonly left: () => void;
}

export interface MemberLeaveSnapshot {
  readonly phase: 'idle' | 'checking' | 'preserve' | 'ready' | 'leaving' | 'left';
  readonly boards: readonly PendingAccountBoard[];
}

/** Freeze/flush the existing graph session before asking about exact queued work. Never delete it. */
export class MemberLeave {
  private readonly ports: MemberLeavePorts;
  private readonly listeners = new Set<() => void>();
  private epoch = 0;
  private disposed = false;
  private preparing = false;
  private snapshot: MemberLeaveSnapshot = { phase: 'idle', boards: [] };
  public constructor(ports: MemberLeavePorts) {
    this.ports = ports;
  }
  public getSnapshot = (): MemberLeaveSnapshot => this.snapshot;
  public activate(): void {
    this.disposed = false;
  }
  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  public async begin(): Promise<void> {
    if (this.disposed || this.preparing || this.snapshot.phase !== 'idle') return;
    this.ports.assertAllowed();
    const epoch = ++this.epoch;
    this.publish('checking', []);
    this.preparing = true;
    try {
      await this.ports.freeze();
      if (!this.current(epoch)) {
        this.ports.resume();
        return;
      }
      this.ports.assertAllowed();
      const boards = this.scoped(await this.ports.readPending());
      if (!this.current(epoch)) return;
      this.ports.assertAllowed();
      this.publish(boards.length > 0 ? 'preserve' : 'ready', boards);
    } catch (error) {
      if (this.current(epoch)) this.cancel();
      throw error;
    } finally {
      this.preparing = false;
    }
  }
  public async download(): Promise<void> {
    if (this.disposed || this.snapshot.phase !== 'preserve')
      throw new Error('Pending work is no longer available in this dialog.');
    await this.ports.download(this.snapshot.boards);
  }
  public async commit(): Promise<void> {
    if (this.disposed || !['preserve', 'ready'].includes(this.snapshot.phase)) return;
    this.ports.assertAllowed();
    const epoch = this.epoch;
    const approved = this.snapshot.boards;
    this.publish('leaving', approved);
    try {
      const current = this.scoped(await this.ports.readPending());
      if (!this.current(epoch)) return;
      if (this.fingerprint(current) !== this.fingerprint(approved))
        throw new Error('Pending changes changed. Cancel and review the local copy again.');
      this.ports.assertAllowed();
      await this.ports.remove();
      // A committed removal ends access even if the dialog closed while the HTTP request ran.
      this.ports.left();
      if (this.current(epoch)) this.publish('left', approved);
    } catch (error) {
      if (this.current(epoch)) this.publish(approved.length > 0 ? 'preserve' : 'ready', approved);
      throw error;
    }
  }
  public cancel(): void {
    if (this.snapshot.phase === 'leaving' || this.snapshot.phase === 'left') return;
    this.epoch += 1;
    this.ports.resume();
    this.publish('idle', []);
  }
  public dispose(): void {
    this.cancel();
    this.disposed = true;
    this.listeners.clear();
  }
  private current(epoch: number): boolean {
    return !this.disposed && epoch === this.epoch;
  }
  private scoped(boards: readonly PendingAccountBoard[]): readonly PendingAccountBoard[] {
    const scope = this.ports.namespace;
    return boards.filter(
      ({ namespace }) =>
        namespace.deploymentOrigin === scope.deploymentOrigin &&
        namespace.userId === scope.userId &&
        namespace.boardId === scope.boardId,
    );
  }
  private fingerprint(boards: readonly PendingAccountBoard[]): string {
    return JSON.stringify(
      boards
        .map(({ namespace, pendingCount, updateIds }) =>
          JSON.stringify([namespace.graphSchemaVersion, pendingCount, [...updateIds].sort()]),
        )
        .sort(),
    );
  }
  private publish(
    phase: MemberLeaveSnapshot['phase'],
    boards: readonly PendingAccountBoard[],
  ): void {
    this.snapshot = { phase, boards };
    this.listeners.forEach((listener) => listener());
  }
}
