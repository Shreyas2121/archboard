import type { GraphProjection } from '@archboard/contracts';
import { createGraphDocument } from '@archboard/document-model';
import type * as Y from 'yjs';

import {
  LOCAL_PERSISTENCE_PHASES,
  LocalPersistenceAdapter,
  type LocalPersistenceAdapterOptions,
  type LocalPersistenceStatus,
} from '../persistence/local-persistence-adapter.js';
import { boardStorageNamespaceKey, type BoardStorageNamespace } from '../persistence/namespace.js';
import { deleteBoardStorageNamespace } from '../persistence/namespace-storage.js';
import { LOCK_HINT_TYPES, WRITER_LOCK_VERSION, type LockHintType } from './constants.js';
import { lockHintChannelName, writerLockName } from './names.js';

export const WRITER_SESSION_PHASES = {
  OPENING: 'opening',
  WRITER: 'writer',
  READ_ONLY_HELD_ELSEWHERE: 'read-only-held-elsewhere',
  UNSUPPORTED: 'unsupported',
  RELEASING: 'releasing',
  CLOSED: 'closed',
} as const;

export type WriterSessionPhase = (typeof WRITER_SESSION_PHASES)[keyof typeof WRITER_SESSION_PHASES];

export interface WriterSessionSnapshot {
  readonly phase: WriterSessionPhase;
  readonly writable: boolean;
  readonly persistence: LocalPersistenceStatus | null;
  readonly lastHint: LockHintType | null;
}

export interface WritableDocumentBinding {
  readonly document: Y.Doc;
  readonly persistence: LocalPersistenceAdapter;
}

interface LockManagerLike {
  request(
    name: string,
    options: LockOptions,
    callback: (lock: Lock | null) => Promise<void>,
  ): Promise<void>;
}

interface HintChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  close(): void;
}

interface PageLifecycleTarget {
  addEventListener(type: 'pagehide', listener: () => void): void;
  removeEventListener(type: 'pagehide', listener: () => void): void;
}

interface LockHintMessage {
  readonly version: typeof WRITER_LOCK_VERSION;
  readonly namespace: string;
  readonly type: LockHintType;
}

export interface BrowserWriterSessionOptions {
  readonly namespace: BoardStorageNamespace;
  readonly lockManager?: LockManagerLike | null;
  readonly channelFactory?: (name: string) => HintChannel;
  readonly lifecycleTarget?: PageLifecycleTarget | null;
  readonly documentFactory?: () => Y.Doc;
  readonly persistenceOptions?: Omit<
    LocalPersistenceAdapterOptions,
    'namespace' | 'document' | 'mode'
  >;
}

type SessionListener = () => void;
type LockAttempt = 'acquired' | 'unavailable' | 'failed';

function defaultLockManager(): LockManagerLike | null {
  return typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : null;
}

function isLockHintMessage(value: unknown, namespace: string): value is LockHintMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Partial<LockHintMessage>;
  return (
    message.version === WRITER_LOCK_VERSION &&
    message.namespace === namespace &&
    Object.values(LOCK_HINT_TYPES).some((type) => type === message.type)
  );
}

export class WriterLockRequiredError extends Error {
  public constructor() {
    super('This browser context does not own the board writer lock.');
    this.name = 'WriterLockRequiredError';
  }
}

export class BrowserWriterSession {
  private readonly namespaceKey: string;
  private readonly lockName: string;
  private readonly lockManager: LockManagerLike | null;
  private readonly channel: HintChannel;
  private readonly documentFactory: () => Y.Doc;
  private readonly persistenceOptions: BrowserWriterSessionOptions['persistenceOptions'];
  private readonly lifecycleTarget: PageLifecycleTarget | null;
  private readonly listeners = new Set<SessionListener>();
  private document: Y.Doc | null = null;
  private persistence: LocalPersistenceAdapter | null = null;
  private unsubscribePersistence: (() => void) | null = null;
  private initialization: Promise<void> | null = null;
  private transition: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private lockRequest: Promise<void> | null = null;
  private releaseLock: (() => void) | null = null;
  private ownsLock = false;
  private closeRequested = false;
  private snapshot: WriterSessionSnapshot = Object.freeze({
    phase: WRITER_SESSION_PHASES.OPENING,
    writable: false,
    persistence: null,
    lastHint: null,
  });

  private constructor(private readonly options: BrowserWriterSessionOptions) {
    this.namespaceKey = boardStorageNamespaceKey(options.namespace);
    this.lockName = writerLockName(options.namespace);
    this.lockManager =
      options.lockManager === undefined ? defaultLockManager() : options.lockManager;
    this.channel = (options.channelFactory ?? ((name) => new BroadcastChannel(name)))(
      lockHintChannelName(options.namespace),
    );
    this.documentFactory = options.documentFactory ?? createGraphDocument;
    this.persistenceOptions = options.persistenceOptions;
    this.lifecycleTarget =
      options.lifecycleTarget === undefined
        ? typeof window === 'undefined'
          ? null
          : window
        : options.lifecycleTarget;
    this.channel.addEventListener('message', this.handleHint);
    this.lifecycleTarget?.addEventListener('pagehide', this.handlePageHide);
  }

  public static create(options: BrowserWriterSessionOptions): BrowserWriterSession {
    return new BrowserWriterSession(options);
  }

  public static async open(options: BrowserWriterSessionOptions): Promise<BrowserWriterSession> {
    const session = BrowserWriterSession.create(options);
    await session.initialize();
    return session;
  }

  public initialize(): Promise<void> {
    this.initialization ??= this.initializeInternal();
    return this.initialization;
  }

  public getSnapshot(): WriterSessionSnapshot {
    return this.snapshot;
  }

  public subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getProjection(): GraphProjection {
    if (this.persistence === null) throw new Error('Writer session has not hydrated a document.');
    return this.persistence.exportInMemoryProjection();
  }

  public getWritableBinding(): WritableDocumentBinding | null {
    if (this.snapshot.phase !== WRITER_SESSION_PHASES.WRITER || !this.snapshot.writable)
      return null;
    if (this.document === null || this.persistence === null) return null;
    return { document: this.document, persistence: this.persistence };
  }

  public executeMutation(mutate: (document: Y.Doc) => void): void {
    const binding = this.getWritableBinding();
    if (binding === null) throw new WriterLockRequiredError();
    binding.persistence.assertEditingAllowed();
    mutate(binding.document);
  }

  public async whenIdle(): Promise<void> {
    await this.persistence?.whenIdle();
  }

  public hadStoredStateOnOpen(): boolean {
    if (this.persistence === null) throw new Error('Writer session has not hydrated a document.');
    return this.persistence.hadStoredStateOnOpen();
  }

  public async replaceLocalState(initialize: (document: Y.Doc) => void): Promise<void> {
    if (!this.ownsLock || this.snapshot.phase !== WRITER_SESSION_PHASES.WRITER) {
      throw new WriterLockRequiredError();
    }
    this.publish(WRITER_SESSION_PHASES.OPENING);
    await this.closeView();
    await deleteBoardStorageNamespace(this.options.namespace);
    await this.openView('read-write');
    const binding = this.getBindingDuringOwnedTransition();
    try {
      initialize(binding.document);
      await binding.persistence.whenIdle();
    } finally {
      this.publish(WRITER_SESSION_PHASES.WRITER);
    }
    binding.persistence.assertEditingAllowed();
    this.announceResetComplete();
  }

  /** Call only after an explicit server-reload decision; keep the lock through deletion. */
  public async clearOwnedLocalState(): Promise<void> {
    if (!this.ownsLock || this.snapshot.phase !== WRITER_SESSION_PHASES.WRITER) {
      throw new WriterLockRequiredError();
    }
    this.publish(WRITER_SESSION_PHASES.OPENING);
    await this.closeView();
    await deleteBoardStorageNamespace(this.options.namespace);
    this.announceResetComplete();
  }

  public retry(): Promise<void> {
    if (
      this.closeRequested ||
      this.snapshot.phase !== WRITER_SESSION_PHASES.READ_ONLY_HELD_ELSEWHERE
    ) {
      return Promise.resolve();
    }
    this.transition ??= this.retryInternal().finally(() => {
      this.transition = null;
    });
    return this.transition;
  }

  public announceResetComplete(): void {
    if (!this.ownsLock) throw new WriterLockRequiredError();
    this.postHint(LOCK_HINT_TYPES.RESET_COMPLETE);
  }

  public close(): Promise<void> {
    this.closePromise ??= this.closeInternal();
    return this.closePromise;
  }

  private async initializeInternal(): Promise<void> {
    if (this.lockManager === null) {
      await this.openView('read-only');
      if (!this.closeRequested) this.publish(WRITER_SESSION_PHASES.UNSUPPORTED);
      return;
    }
    const attempt = await this.tryAcquireLock();
    if (this.closeRequested) return;
    if (attempt === 'acquired') {
      await this.openView('read-write');
      if (!this.closeRequested) this.publish(WRITER_SESSION_PHASES.WRITER);
    } else {
      await this.openView('read-only');
      if (!this.closeRequested) {
        this.publish(
          attempt === 'failed'
            ? WRITER_SESSION_PHASES.UNSUPPORTED
            : WRITER_SESSION_PHASES.READ_ONLY_HELD_ELSEWHERE,
        );
      }
    }
  }

  private async retryInternal(): Promise<void> {
    this.publish(WRITER_SESSION_PHASES.OPENING);
    await this.closeView();
    if (this.closeRequested) return;
    const attempt = await this.tryAcquireLock();
    if (this.closeRequested) return;
    if (attempt === 'acquired') {
      await this.openView('read-write');
      if (!this.closeRequested) this.publish(WRITER_SESSION_PHASES.WRITER);
    } else {
      await this.openView('read-only');
      if (!this.closeRequested) {
        this.publish(
          attempt === 'failed'
            ? WRITER_SESSION_PHASES.UNSUPPORTED
            : WRITER_SESSION_PHASES.READ_ONLY_HELD_ELSEWHERE,
        );
      }
    }
  }

  private async refreshReadOnlyInternal(): Promise<void> {
    this.publish(WRITER_SESSION_PHASES.OPENING);
    await this.closeView();
    if (this.closeRequested) return;
    await this.openView('read-only');
    if (!this.closeRequested) this.publish(WRITER_SESSION_PHASES.READ_ONLY_HELD_ELSEWHERE);
  }

  private async openView(mode: 'read-write' | 'read-only'): Promise<void> {
    const document = this.documentFactory();
    const persistence = await LocalPersistenceAdapter.open({
      ...this.persistenceOptions,
      namespace: this.options.namespace,
      document,
      mode,
    });
    if (this.closeRequested) {
      await persistence.close();
      document.destroy();
      return;
    }
    this.document = document;
    this.persistence = persistence;
    this.unsubscribePersistence = persistence.subscribe(this.handlePersistenceStatus);
  }

  private getBindingDuringOwnedTransition(): WritableDocumentBinding {
    if (!this.ownsLock || this.document === null || this.persistence === null) {
      throw new WriterLockRequiredError();
    }
    this.persistence.assertEditingAllowed();
    return { document: this.document, persistence: this.persistence };
  }

  private async closeView(): Promise<void> {
    this.unsubscribePersistence?.();
    this.unsubscribePersistence = null;
    const persistence = this.persistence;
    const document = this.document;
    this.persistence = null;
    this.document = null;
    await persistence?.close();
    document?.destroy();
  }

  private async tryAcquireLock(): Promise<LockAttempt> {
    if (this.lockManager === null) return 'failed';
    let settleAttempt!: (attempt: LockAttempt) => void;
    const attempted = new Promise<LockAttempt>((resolve) => {
      settleAttempt = resolve;
    });
    const held = new Promise<void>((resolve) => {
      this.releaseLock = resolve;
    });
    this.lockRequest = this.lockManager
      .request(this.lockName, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
        if (lock === null) {
          this.releaseLock = null;
          settleAttempt('unavailable');
          return;
        }
        this.ownsLock = true;
        settleAttempt('acquired');
        await held;
        this.ownsLock = false;
      })
      .catch(() => settleAttempt('failed'));
    return attempted;
  }

  private readonly handlePersistenceStatus = (): void => {
    const status = this.persistence?.getSnapshot() ?? null;
    if (
      this.snapshot.phase === WRITER_SESSION_PHASES.WRITER &&
      status?.phase === LOCAL_PERSISTENCE_PHASES.SAVED
    ) {
      this.postHint(LOCK_HINT_TYPES.CACHE_CHANGED);
    }
    this.publish(this.snapshot.phase);
  };

  private readonly handleHint = (event: MessageEvent<unknown>): void => {
    if (!isLockHintMessage(event.data, this.namespaceKey) || this.closeRequested) return;
    this.publish(this.snapshot.phase, event.data.type);
    if (
      event.data.type === LOCK_HINT_TYPES.LOCK_RELEASED &&
      this.snapshot.phase === WRITER_SESSION_PHASES.READ_ONLY_HELD_ELSEWHERE
    ) {
      void this.retry();
    } else if (
      event.data.type === LOCK_HINT_TYPES.RESET_COMPLETE &&
      this.snapshot.phase === WRITER_SESSION_PHASES.READ_ONLY_HELD_ELSEWHERE
    ) {
      this.transition ??= this.refreshReadOnlyInternal().finally(() => {
        this.transition = null;
      });
    }
  };

  private readonly handlePageHide = (): void => {
    void this.close();
  };

  private postHint(type: LockHintType): void {
    this.channel.postMessage({ version: WRITER_LOCK_VERSION, namespace: this.namespaceKey, type });
  }

  private publish(phase: WriterSessionPhase, lastHint = this.snapshot.lastHint): void {
    const persistence = this.persistence?.getSnapshot() ?? null;
    this.snapshot = Object.freeze({
      phase,
      writable: phase === WRITER_SESSION_PHASES.WRITER && persistence?.editingPaused === false,
      persistence,
      lastHint,
    });
    for (const listener of this.listeners) listener();
  }

  private async closeInternal(): Promise<void> {
    this.closeRequested = true;
    this.lifecycleTarget?.removeEventListener('pagehide', this.handlePageHide);
    await this.initialization;
    await this.transition;
    const heldWriterLock = this.ownsLock;
    if (heldWriterLock) this.publish(WRITER_SESSION_PHASES.RELEASING);
    await this.closeView();
    if (heldWriterLock) {
      this.releaseLock?.();
      this.releaseLock = null;
      await this.lockRequest;
      this.postHint(LOCK_HINT_TYPES.LOCK_RELEASED);
    }
    this.channel.removeEventListener('message', this.handleHint);
    this.channel.close();
    this.publish(WRITER_SESSION_PHASES.CLOSED);
    this.listeners.clear();
  }
}
