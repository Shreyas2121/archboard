import { GRAPH_SCHEMA_VERSION } from '@archboard/contracts';
import {
  cacheBoardSummary,
  readSelectedCachedBoard,
  selectLocalAccount,
} from '@archboard/sync-client';

import { readBoard } from '@/features/boards/board-api';
import { closeEditorSession, EditorSession } from '@/features/editor/application';
import { serverUnavailable } from '@/platform/api';
import { loadWebConfig } from '@/platform/config';

export type BoardLoadMode = 'online' | 'offline' | 'none';
export type BoardLoadStatus = 'checking' | 'ready' | 'no-account' | 'unavailable' | 'cache-error';

export interface BoardEditorIdentity {
  readonly deploymentOrigin: string;
  readonly boardId: string;
  readonly userId: string;
  readonly forceReadOnly: boolean;
}

export interface BoardEditorLoadState {
  readonly session: EditorSession | null;
  readonly boardTitle: string;
  readonly status: BoardLoadStatus;
}

/** Owns one account/board session; request generations fence late async results. */
export class BoardEditorLoader {
  private current: EditorSession | null = null;
  private opening: Promise<void> | null = null;
  private request: AbortController | null = null;
  private generation = 0;
  private closed = false;
  private title = 'Board';

  public constructor(
    private readonly identity: BoardEditorIdentity,
    private readonly onState: (state: BoardEditorLoadState) => void,
  ) {}

  public async load(mode: Exclude<BoardLoadMode, 'none'>): Promise<void> {
    if (this.closed) return;
    const generation = ++this.generation;
    this.request?.abort();
    const request = new AbortController();
    this.request = request;
    const active = () => !this.closed && this.generation === generation && !request.signal.aborted;
    try {
      this.opening ??= this.openSession();
      await this.opening;
      if (!active() || this.current === null) return;
      if (mode === 'offline') {
        await this.openCached(active);
        return;
      }
      let detail;
      try {
        detail = await readBoard(this.identity.boardId, request.signal);
      } catch (error) {
        if (!active()) return;
        if (serverUnavailable(error)) await this.openCached(active);
        else {
          this.current.denyBoardAccess();
          this.publish('ready');
        }
        return;
      }
      if (!active()) return;
      await this.current.setBoardAccess(detail.effectiveRole, detail.archivedAt !== null);
      if (!active()) return;
      this.title = detail.title;
      this.publish('ready');
      await cacheBoardSummary(
        { ...this.identity, graphSchemaVersion: GRAPH_SCHEMA_VERSION },
        detail,
      ).catch(() => undefined);
      if (active()) await this.current.startSync();
    } catch {
      if (!active()) return;
      const failed = this.current;
      this.current = null;
      this.opening = null;
      this.publish('cache-error');
      await closeEditorSession(failed);
    }
  }

  public async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.generation += 1;
    this.request?.abort();
    const session = this.current;
    this.current = null;
    await closeEditorSession(session);
  }

  private async openSession(): Promise<void> {
    const { deploymentOrigin, boardId, userId, forceReadOnly } = this.identity;
    this.current = new EditorSession({
      deploymentOrigin,
      forceReadOnly,
      board: { boardId, userId, webSocketOrigin: loadWebConfig(import.meta.env).webSocketOrigin },
    });
    await this.current.open();
    if (this.closed || this.current === null) return;
    if (this.current.getSnapshot().initializationError)
      throw new Error('Local board initialization failed.');
  }

  private async openCached(active: () => boolean): Promise<void> {
    const { deploymentOrigin, boardId, userId } = this.identity;
    if (selectLocalAccount(deploymentOrigin, { kind: 'network-unavailable' })?.userId !== userId) {
      await this.unavailable('no-account', active);
      return;
    }
    const cached = await readSelectedCachedBoard(deploymentOrigin, boardId);
    if (!active()) return;
    if (
      cached === null ||
      !cached.locallyAvailable ||
      cached.boardId !== boardId ||
      selectLocalAccount(deploymentOrigin, { kind: 'network-unavailable' })?.userId !== userId ||
      !this.current?.useCachedBoardAccess(cached.role, cached.archived)
    ) {
      await this.unavailable('unavailable', active);
      return;
    }
    this.title = cached.summary?.title ?? 'Cached board';
    this.publish('ready');
    if (active()) await this.current.startSync();
  }

  private async unavailable(
    status: 'no-account' | 'unavailable',
    active: () => boolean,
  ): Promise<void> {
    if (!active()) return;
    const session = this.current;
    this.current = null;
    this.opening = null;
    this.publish(status);
    await closeEditorSession(session);
  }

  private publish(status: BoardLoadStatus): void {
    if (!this.closed) this.onState({ session: this.current, boardTitle: this.title, status });
  }
}
