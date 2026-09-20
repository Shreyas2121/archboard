import {
  GRAPH_SCHEMA_VERSION,
  type CodeContent,
  type ComponentContent,
  type GraphEdge,
  type GraphNode,
  type GraphProjection,
} from '@archboard/contracts';
import {
  accessGraphText,
  createLocalUndoManager,
  createEdge,
  createNode,
  editGraphText,
  editEdge,
  replaceEdge,
  setCodeLanguage,
  setComponentCategory,
  setComponentExternalUrl,
  setNodeColor,
  stopLocalUndoCapture,
  type GraphTextAccess,
  type GraphTextTarget,
  type TextEdit,
} from '@archboard/document-model';
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
}

type SessionListener = () => void;
type UndoManager = ReturnType<typeof createLocalUndoManager>;

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
  private opening: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
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
    });
  }

  public open(): Promise<void> {
    this.opening ??= this.openInternal().catch(() => {
      this.snapshot = Object.freeze({
        revision: this.snapshot.revision + 1,
        writer: this.writerSession.getSnapshot(),
        projection: null,
        initializationError: true,
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

  public createCard(node: GraphNode): void {
    this.writerSession.executeMutation((document) => createNode(document, node));
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

  public close(): Promise<void> {
    this.closePromise ??= this.closeInternal();
    return this.closePromise;
  }

  private async openInternal(): Promise<void> {
    this.unsubscribeWriter = this.writerSession.subscribe(this.refresh);
    await this.writerSession.initialize();
    this.refresh();
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
    if (writer.persistence !== null) {
      projection = this.writerSession.getProjection();
    }

    this.snapshot = Object.freeze({
      revision: this.snapshot.revision + 1,
      writer,
      projection,
      initializationError: false,
    });
    for (const listener of this.listeners) listener();
  };

  private async closeInternal(): Promise<void> {
    this.unsubscribeWriter?.();
    this.unsubscribeWriter = null;
    this.undoManager?.destroy();
    this.undoManager = null;
    this.undoDocument = null;
    await this.writerSession.close();
    this.listeners.clear();
  }
}
