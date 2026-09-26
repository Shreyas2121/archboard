import {
  GRAPH_SCHEMA_VERSION,
  BOARD_ROLES,
  type BoardRole,
  type Boundary,
  type CodeContent,
  type ColorToken,
  type ComponentContent,
  type GraphEdge,
  type GraphNode,
  type GraphProjection,
} from '@archboard/contracts';
import {
  accessGraphText,
  alignNodeGeometry,
  createGraphObjects,
  createLocalUndoManager,
  createBoundary,
  createEdge,
  createNode,
  createPresentationStep,
  editGraphText,
  editEdge,
  editBoundary,
  deleteGraphObjects,
  replaceEdge,
  restoreDeletedObjects,
  setGraphGeometry,
  setCodeLanguage,
  setComponentCategory,
  setComponentExternalUrl,
  setNodeColor,
  stopLocalUndoCapture,
  type GraphTextAccess,
  type GraphTextTarget,
  type GeometryBatch,
  type GraphObjectBatch,
  type NodeAlignment,
  type TextEdit,
} from '@archboard/document-model';
import { instantiateWebApplicationTemplate } from '@archboard/fixtures';
import * as Y from 'yjs';
import {
  BrowserWriterSession,
  LOCAL_DEMO_USER_KEY,
  OrderedSyncClient,
  SYNC_PHASES,
  type SyncStatus,
  type WriterSessionSnapshot,
} from '@archboard/sync-client';

export const DEMO_BOARD_ID = '6f5eb829-0b42-4e62-8a8a-3db5176adf67';

export interface EditorSessionSnapshot {
  readonly revision: number;
  readonly writer: WriterSessionSnapshot;
  readonly projection: GraphProjection | null;
  readonly initializationError: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly canRestoreDeletion: boolean;
  readonly preparingDemo: boolean;
  readonly boardRole: BoardRole | null;
  readonly archived: boolean;
  readonly hasLocalCopy: boolean;
  readonly sync: SyncStatus | null;
  readonly accessDenied: boolean;
}

export type HistoryResult = 'applied' | 'empty' | 'skipped-deleted-target';

type SessionListener = () => void;
type UndoManager = ReturnType<typeof createLocalUndoManager>;
const STATUS_PRESENTATION_DELAY_MS = 50;

function allowStatusPresentation(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, STATUS_PRESENTATION_DELAY_MS));
}

export interface EditorSessionOptions {
  readonly deploymentOrigin: string;
  readonly forceReadOnly?: boolean;
  readonly board?: {
    readonly boardId: string;
    readonly userId: string;
    readonly webSocketOrigin: string;
  };
}

export class EditorSession {
  private readonly board: EditorSessionOptions['board'];
  private readonly writerSession: BrowserWriterSession;
  private syncClient: OrderedSyncClient | null = null;
  private unsubscribeSync: (() => void) | null = null;
  private boardRole: BoardRole | null = null;
  private cachedRole: BoardRole | null = null;
  private archived = false;
  private hasLocalCopy = false;
  private initialBootstrapBytes: Uint8Array | null = null;
  private bootstrapQueued = false;
  private accessDenied = false;
  private readonly listeners = new Set<SessionListener>();
  private unsubscribeWriter: (() => void) | null = null;
  private undoManager: UndoManager | null = null;
  private undoDocument: object | null = null;
  private deletionCapture: GraphProjection | null = null;
  private opening: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private preparingDemo = false;
  private initializing = true;
  private snapshot: EditorSessionSnapshot;

  public constructor(options: EditorSessionOptions) {
    this.board = options.board;
    this.writerSession = BrowserWriterSession.create({
      namespace: {
        deploymentOrigin: options.deploymentOrigin,
        userId: options.board?.userId ?? LOCAL_DEMO_USER_KEY,
        boardId: options.board?.boardId ?? DEMO_BOARD_ID,
        graphSchemaVersion: GRAPH_SCHEMA_VERSION,
      },
      ...(options.forceReadOnly ? { lockManager: null } : {}),
    });
    this.snapshot = Object.freeze({
      revision: 0,
      writer: this.writerSession.getSnapshot(),
      projection: null,
      initializationError: false,
      canUndo: false,
      canRedo: false,
      canRestoreDeletion: false,
      preparingDemo: false,
      boardRole: null,
      archived: false,
      hasLocalCopy: false,
      sync: null,
      accessDenied: false,
    });
  }

  public open(): Promise<void> {
    this.opening ??= this.openInternal().catch(() => {
      this.snapshot = Object.freeze({
        revision: this.snapshot.revision + 1,
        writer: this.writerSession.getSnapshot(),
        projection: null,
        initializationError: true,
        canUndo: false,
        canRedo: false,
        canRestoreDeletion: false,
        preparingDemo: false,
        boardRole: this.boardRole,
        archived: this.archived,
        hasLocalCopy: this.hasLocalCopy,
        sync: this.syncClient?.getSnapshot() ?? null,
        accessDenied: this.accessDenied,
      });
      for (const listener of this.listeners) listener();
    });
    return this.opening;
  }

  public getSnapshot = (): EditorSessionSnapshot => this.snapshot;

  public subscribe = (listener: SessionListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public retry(): Promise<void> {
    return this.writerSession.retry();
  }

  public canEdit(): boolean {
    if (!this.writerSession.getSnapshot().writable) return false;
    if (this.board === undefined) return true;
    const syncPhase = this.syncClient?.getSnapshot().phase;
    return (
      (this.boardRole === BOARD_ROLES.OWNER || this.boardRole === BOARD_ROLES.EDITOR) &&
      !this.archived &&
      !this.accessDenied &&
      this.initialBootstrapBytes === null &&
      syncPhase !== SYNC_PHASES.ACCESS_CHANGED &&
      syncPhase !== SYNC_PHASES.RECOVERY_REQUIRED &&
      syncPhase !== SYNC_PHASES.STORAGE_ERROR
    );
  }

  public async setBoardAccess(role: BoardRole, archived: boolean): Promise<void> {
    if (this.board === undefined) return;
    if (!archived) await this.ensureBootstrap(role);
    const sync = this.syncClient?.getSnapshot();
    this.boardRole = sync?.ready ? sync.role : role;
    this.cachedRole = role;
    this.archived = archived;
    this.accessDenied = false;
    this.refresh();
    const binding = this.writerSession.getWritableBinding();
    await binding?.persistence.cacheBoardAccess({ role, archived }).catch(() => undefined);
    this.syncClient?.resumeDrain();
  }

  public denyBoardAccess(): void {
    if (this.board === undefined) return;
    this.boardRole = null;
    this.accessDenied = true;
    this.refresh();
  }

  public async startSync(): Promise<void> {
    await this.syncClient?.start();
    this.refresh();
  }

  private async ensureBootstrap(role: BoardRole | null): Promise<void> {
    if (
      this.bootstrapQueued ||
      this.initialBootstrapBytes === null ||
      (role !== BOARD_ROLES.OWNER && role !== BOARD_ROLES.EDITOR)
    )
      return;
    const binding = this.writerSession.getWritableBinding();
    if (binding === null) return;
    await binding.persistence.enqueueInitialDocumentState(this.initialBootstrapBytes);
    this.bootstrapQueued = true;
    this.initialBootstrapBytes = null;
  }

  public async resetDemo(): Promise<void> {
    if (this.board !== undefined) throw new Error('Only the local demo can be reset.');
    this.preparingDemo = true;
    this.refresh();
    try {
      await allowStatusPresentation();
      await this.writerSession.replaceLocalState((document) => this.seedDocument(document));
      this.deletionCapture = null;
    } finally {
      this.preparingDemo = false;
      this.refresh();
    }
  }

  public createCard(node: GraphNode): void {
    this.executeMutation((document) => createNode(document, node));
  }

  public createBoundary(boundary: Boundary): void {
    this.executeMutation((document) => createBoundary(document, boundary));
  }

  public createObjects(batch: GraphObjectBatch): void {
    this.executeMutation((document) => createGraphObjects(document, batch));
  }

  public deleteObjects(selection: {
    readonly nodeIds?: readonly string[];
    readonly edgeIds?: readonly string[];
    readonly boundaryIds?: readonly string[];
  }): GraphProjection {
    let capture: GraphProjection | null = null;
    this.executeMutation((document) => {
      capture = deleteGraphObjects(document, selection);
    });
    if (capture === null) throw new Error('The selected objects could not be captured.');
    this.deletionCapture = capture;
    this.refresh();
    return capture;
  }

  public restoreDeletion(): GraphProjection | null {
    const capture = this.deletionCapture;
    if (capture === null) return null;
    let restored: GraphProjection | null = null;
    this.executeMutation((document) => {
      restored = restoreDeletedObjects(document, capture, () => crypto.randomUUID()).graph;
    });
    this.deletionCapture = null;
    this.refresh();
    return restored;
  }

  public undo(): HistoryResult {
    return this.changeHistory('undo');
  }

  public redo(): HistoryResult {
    return this.changeHistory('redo');
  }

  public setBoundaryColor(id: string, color: ColorToken): void {
    this.executeMutation((document) => editBoundary(document, id, { color }));
  }

  public setGeometry(batch: GeometryBatch): void {
    this.executeMutation((document) => setGraphGeometry(document, batch));
    this.finishTextHistory();
  }

  public alignCards(ids: readonly string[], alignment: NodeAlignment): void {
    this.executeMutation((document) => alignNodeGeometry(document, ids, alignment));
    this.finishTextHistory();
  }

  public createConnection(edge: GraphEdge): void {
    this.executeMutation((document) => createEdge(document, edge));
  }

  public editConnection(
    id: string,
    changes: Partial<Pick<GraphEdge, 'direction' | 'style'>>,
  ): void {
    this.executeMutation((document) => editEdge(document, id, changes));
  }

  public replaceConnection(originalId: string, replacement: GraphEdge): void {
    this.executeMutation((document) => replaceEdge(document, originalId, replacement));
  }

  public accessText(target: GraphTextTarget): GraphTextAccess | null {
    if (!this.canEdit()) return null;
    const binding = this.writerSession.getWritableBinding();
    return binding === null ? null : accessGraphText(binding.document, target);
  }

  public editText(target: GraphTextTarget, edit: TextEdit): void {
    this.executeMutation((document) => editGraphText(document, target, edit));
  }

  public setCardColor(id: string, color: GraphNode['color']): void {
    this.executeMutation((document) => setNodeColor(document, id, color));
  }

  public setComponentCategory(id: string, category: ComponentContent['category']): void {
    this.executeMutation((document) => setComponentCategory(document, id, category));
  }

  public setComponentExternalUrl(id: string, externalUrl: string | null): void {
    this.executeMutation((document) => setComponentExternalUrl(document, id, externalUrl));
  }

  public setCodeLanguage(id: string, language: CodeContent['language']): void {
    this.executeMutation((document) => setCodeLanguage(document, id, language));
  }

  public finishTextHistory(): void {
    if (this.undoManager !== null) stopLocalUndoCapture(this.undoManager);
  }

  private changeHistory(direction: 'undo' | 'redo'): HistoryResult {
    if (!this.canEdit()) return 'empty';
    const manager = this.undoManager;
    if (manager === null || !(direction === 'undo' ? manager.canUndo() : manager.canRedo())) {
      return 'empty';
    }
    const before = JSON.stringify(this.writerSession.getProjection());
    if (direction === 'undo') manager.undo();
    else manager.redo();
    const visibleChange = before !== JSON.stringify(this.writerSession.getProjection());
    this.refresh();
    return visibleChange ? 'applied' : 'skipped-deleted-target';
  }

  public close(): Promise<void> {
    this.closePromise ??= this.closeInternal();
    return this.closePromise;
  }

  private executeMutation(mutate: Parameters<BrowserWriterSession['executeMutation']>[0]): void {
    if (!this.canEdit()) throw new Error('Editing is unavailable for this board.');
    this.writerSession.executeMutation(mutate);
  }

  private async openInternal(): Promise<void> {
    this.unsubscribeWriter = this.writerSession.subscribe(this.refresh);
    await this.writerSession.initialize();
    this.hasLocalCopy = this.writerSession.hadStoredStateOnOpen();
    if (this.board !== undefined) {
      const binding = this.writerSession.getWritableBinding();
      if (binding !== null && !(await binding.persistence.hasQueuedInitialState()))
        this.initialBootstrapBytes = Y.encodeStateAsUpdate(binding.document);
      const cached = await binding?.persistence.readCachedBoardAccess();
      if (cached !== undefined && cached !== null) {
        this.boardRole = cached.role;
        this.cachedRole = cached.role;
        this.archived = cached.archived;
      }
      this.initializing = false;
      this.refresh();
      if (binding !== null) {
        this.syncClient = new OrderedSyncClient({
          boardId: this.board.boardId,
          tabId: crypto.randomUUID(),
          webSocketOrigin: this.board.webSocketOrigin,
          persistence: binding.persistence,
          canSend: () => !this.archived && !this.accessDenied,
          beforeDrain: async () => {
            if (!this.archived && !this.accessDenied)
              await this.ensureBootstrap(this.syncClient?.getSnapshot().role ?? null);
          },
        });
        this.unsubscribeSync = this.syncClient.subscribe(() => {
          const sync = this.syncClient?.getSnapshot();
          if (sync?.ready || sync?.phase === SYNC_PHASES.ACCESS_CHANGED) {
            this.boardRole = sync.role;
          }
          if (sync?.ready) this.hasLocalCopy = true;
          if (sync?.ready && sync.role !== null && sync.role !== this.cachedRole) {
            this.cachedRole = sync.role;
            void binding.persistence
              .cacheBoardAccess({ role: sync.role, archived: this.archived })
              .catch(() => undefined);
          }
          this.refresh();
        });
        this.refresh();
      }
      return;
    }
    if (this.writerSession.getSnapshot().writable && !this.hasLocalCopy) {
      this.preparingDemo = true;
      this.refresh();
      await allowStatusPresentation();
      const binding = this.writerSession.getWritableBinding();
      if (binding === null) throw new Error('The demo writer lock was released before seeding.');
      this.seedDocument(binding.document);
      await this.writerSession.whenIdle();
      this.preparingDemo = false;
    }
    this.initializing = false;
    this.refresh();
  }

  private seedDocument(document: Parameters<typeof createGraphObjects>[0]): void {
    const fixture = instantiateWebApplicationTemplate(() => crypto.randomUUID());
    createGraphObjects(document, {
      nodes: fixture.nodes,
      edges: fixture.edges,
      boundaries: fixture.boundaries,
    });
    for (const step of fixture.steps) createPresentationStep(document, step);
  }

  private readonly refresh = (): void => {
    const writer = this.writerSession.getSnapshot();
    const binding = this.writerSession.getWritableBinding();
    const nextUndoDocument = binding?.document ?? null;

    if (nextUndoDocument !== this.undoDocument) {
      this.undoManager?.destroy();
      this.undoManager = binding === null ? null : createLocalUndoManager(binding.document);
      this.undoDocument = nextUndoDocument;
    }

    let projection: GraphProjection | null = null;
    if (writer.persistence !== null && !this.initializing) {
      projection = this.writerSession.getProjection();
    }

    this.snapshot = Object.freeze({
      revision: this.snapshot.revision + 1,
      writer,
      projection,
      initializationError: false,
      canUndo: this.undoManager?.canUndo() ?? false,
      canRedo: this.undoManager?.canRedo() ?? false,
      canRestoreDeletion: this.deletionCapture !== null,
      preparingDemo: this.preparingDemo,
      boardRole: this.boardRole,
      archived: this.archived,
      hasLocalCopy: this.hasLocalCopy,
      sync: this.syncClient?.getSnapshot() ?? null,
      accessDenied: this.accessDenied,
    });
    for (const listener of this.listeners) listener();
  };

  private async closeInternal(): Promise<void> {
    this.unsubscribeSync?.();
    this.unsubscribeSync = null;
    this.syncClient?.stop();
    this.syncClient = null;
    this.unsubscribeWriter?.();
    this.unsubscribeWriter = null;
    this.undoManager?.destroy();
    this.undoManager = null;
    this.undoDocument = null;
    this.deletionCapture = null;
    await this.writerSession.close();
    this.listeners.clear();
  }
}
