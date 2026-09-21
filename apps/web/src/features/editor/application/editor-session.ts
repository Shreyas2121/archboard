import {
  GRAPH_SCHEMA_VERSION,
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
import {
  BrowserWriterSession,
  LOCAL_DEMO_USER_KEY,
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
}

export class EditorSession {
  private readonly writerSession: BrowserWriterSession;
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
    this.writerSession = BrowserWriterSession.create({
      namespace: {
        deploymentOrigin: options.deploymentOrigin,
        userId: LOCAL_DEMO_USER_KEY,
        boardId: DEMO_BOARD_ID,
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

  public async resetDemo(): Promise<void> {
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
    this.writerSession.executeMutation((document) => createNode(document, node));
  }

  public createBoundary(boundary: Boundary): void {
    this.writerSession.executeMutation((document) => createBoundary(document, boundary));
  }

  public createObjects(batch: GraphObjectBatch): void {
    this.writerSession.executeMutation((document) => createGraphObjects(document, batch));
  }

  public deleteObjects(selection: {
    readonly nodeIds?: readonly string[];
    readonly edgeIds?: readonly string[];
    readonly boundaryIds?: readonly string[];
  }): GraphProjection {
    let capture: GraphProjection | null = null;
    this.writerSession.executeMutation((document) => {
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
    this.writerSession.executeMutation((document) => {
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
    this.writerSession.executeMutation((document) => editBoundary(document, id, { color }));
  }

  public setGeometry(batch: GeometryBatch): void {
    this.writerSession.executeMutation((document) => setGraphGeometry(document, batch));
    this.finishTextHistory();
  }

  public alignCards(ids: readonly string[], alignment: NodeAlignment): void {
    this.writerSession.executeMutation((document) => alignNodeGeometry(document, ids, alignment));
    this.finishTextHistory();
  }

  public createConnection(edge: GraphEdge): void {
    this.writerSession.executeMutation((document) => createEdge(document, edge));
  }

  public editConnection(
    id: string,
    changes: Partial<Pick<GraphEdge, 'direction' | 'style'>>,
  ): void {
    this.writerSession.executeMutation((document) => editEdge(document, id, changes));
  }

  public replaceConnection(originalId: string, replacement: GraphEdge): void {
    this.writerSession.executeMutation((document) =>
      replaceEdge(document, originalId, replacement),
    );
  }

  public accessText(target: GraphTextTarget): GraphTextAccess | null {
    const binding = this.writerSession.getWritableBinding();
    return binding === null ? null : accessGraphText(binding.document, target);
  }

  public editText(target: GraphTextTarget, edit: TextEdit): void {
    this.writerSession.executeMutation((document) => editGraphText(document, target, edit));
  }

  public setCardColor(id: string, color: GraphNode['color']): void {
    this.writerSession.executeMutation((document) => setNodeColor(document, id, color));
  }

  public setComponentCategory(id: string, category: ComponentContent['category']): void {
    this.writerSession.executeMutation((document) => setComponentCategory(document, id, category));
  }

  public setComponentExternalUrl(id: string, externalUrl: string | null): void {
    this.writerSession.executeMutation((document) =>
      setComponentExternalUrl(document, id, externalUrl),
    );
  }

  public setCodeLanguage(id: string, language: CodeContent['language']): void {
    this.writerSession.executeMutation((document) => setCodeLanguage(document, id, language));
  }

  public finishTextHistory(): void {
    if (this.undoManager !== null) stopLocalUndoCapture(this.undoManager);
  }

  private changeHistory(direction: 'undo' | 'redo'): HistoryResult {
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

  private async openInternal(): Promise<void> {
    this.unsubscribeWriter = this.writerSession.subscribe(this.refresh);
    await this.writerSession.initialize();
    if (this.writerSession.getSnapshot().writable && !this.writerSession.hadStoredStateOnOpen()) {
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
    });
    for (const listener of this.listeners) listener();
  };

  private async closeInternal(): Promise<void> {
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
