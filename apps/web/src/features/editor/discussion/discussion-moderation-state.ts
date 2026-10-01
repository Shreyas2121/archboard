import type { Comment, Thread } from '@archboard/contracts';

export type DiscussionTarget =
  | { readonly kind: 'comment'; readonly value: Comment }
  | { readonly kind: 'thread'; readonly value: Thread };
export type ModerationAction =
  | { readonly kind: 'edit'; readonly resource: Comment; readonly body: string }
  | { readonly kind: 'delete'; readonly resource: Comment }
  | { readonly kind: 'resolve'; readonly resource: Thread; readonly resolved: boolean };
export interface ModerationSnapshot {
  readonly retainedEdits: readonly { readonly commentId: string; readonly body: string }[];
  readonly action: ModerationAction | null;
  readonly phase: 'idle' | 'draft' | 'sending' | 'refreshing' | 'review';
  readonly current: DiscussionTarget | null;
  readonly error: string;
  readonly notice: string;
}
export interface ModerationPorts {
  isCurrent(): boolean;
  authorize(action: ModerationAction, signal: AbortSignal): Promise<void>;
  send(action: ModerationAction, signal: AbortSignal): Promise<DiscussionTarget>;
  read(action: ModerationAction, signal: AbortSignal): Promise<DiscussionTarget>;
  committed(): Promise<void>;
  isConflict(cause: unknown): boolean;
  failed(cause: unknown): void;
}

/** Memory-only versioned forms. Reading a newer row never changes a pending CAS. */
export class DiscussionModeration {
  private snapshot: ModerationSnapshot = {
    retainedEdits: [],
    action: null,
    phase: 'idle',
    current: null,
    error: '',
    notice: '',
  };
  private readonly listeners = new Set<() => void>();
  private readonly edits = new Map<string, Extract<ModerationAction, { kind: 'edit' }>>();
  private flight: AbortController | null = null;
  private active = true;
  private readonly ports: ModerationPorts;
  public constructor(ports: ModerationPorts) {
    this.ports = ports;
  }
  public getSnapshot = (): ModerationSnapshot => this.snapshot;
  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(change: Partial<ModerationSnapshot>): void {
    if (!this.active) return;
    this.snapshot = {
      ...this.snapshot,
      ...change,
      retainedEdits: Array.from(this.edits.values(), (edit) => ({
        commentId: edit.resource.id,
        body: edit.body,
      })),
    };
    this.listeners.forEach((listener) => listener());
  }
  public begin(action: ModerationAction): void {
    if (!this.active || this.flight || this.snapshot.action) return;
    const retained = action.kind === 'edit' ? this.edits.get(action.resource.id) : undefined;
    this.update({
      action: retained ?? action,
      phase: 'draft',
      current: null,
      error: '',
      notice: '',
    });
  }
  public setBody(body: string): void {
    const action = this.snapshot.action;
    if (!action || action.kind !== 'edit' || this.flight) return;
    const draft = { ...action, body };
    this.edits.set(action.resource.id, draft);
    this.update({ action: draft });
  }
  public cancel(): void {
    if (this.flight) return;
    const action = this.snapshot.action;
    if (action?.kind === 'edit') this.edits.set(action.resource.id, action);
    this.update({
      action: null,
      current: null,
      phase: 'idle',
      error: '',
      notice: 'Action cancelled. Unsent edit text is retained in memory.',
    });
  }
  public async submit(): Promise<void> {
    if (this.snapshot.phase !== 'draft') return;
    await this.send();
  }
  public async retryReviewed(): Promise<void> {
    const { action, current, phase } = this.snapshot;
    if (phase !== 'review' || !action || !current || this.flight) return;
    if (action.kind === 'resolve' && current.kind === 'thread') {
      this.update({ action: { ...action, resource: current.value } });
    } else if (action.kind !== 'resolve' && current.kind === 'comment') {
      if (current.value.deletedAt !== null) {
        this.update({ error: 'This message is deleted. Its marker cannot be edited or restored.' });
        return;
      }
      this.update({ action: { ...action, resource: current.value } });
    } else return;
    await this.send();
  }
  private async send(): Promise<void> {
    const action = this.snapshot.action;
    if (!this.active || !action || this.flight) return;
    const controller = new AbortController();
    this.flight = controller;
    this.update({ phase: 'sending', error: '', notice: '' });
    try {
      await this.ports.authorize(action, controller.signal);
      if (!this.active || controller.signal.aborted || !this.ports.isCurrent())
        throw new Error('The action was interrupted.');
      await this.ports.send(action, controller.signal);
      if (!this.active) return;
      if (controller.signal.aborted || !this.ports.isCurrent())
        throw new Error('The action was interrupted.');
      if (action.kind === 'edit') this.edits.delete(action.resource.id);
      this.update({
        action: null,
        phase: 'idle',
        current: null,
        notice: 'Change committed.',
        error: '',
      });
      try {
        await this.ports.committed();
      } catch {
        this.update({ notice: 'Change committed. Discussion refresh failed; retry the read.' });
      }
    } catch (cause) {
      if (!this.active) return;
      if (this.ports.isCurrent()) this.ports.failed(cause);
      const error = this.ports.isConflict(cause)
        ? 'Version conflict. Your unsent text is retained. Review current content before retrying.'
        : 'The change was not confirmed. Your unsent text is retained. Refresh and review current content before retrying.';
      this.update({ phase: 'review', current: null, error });
    } finally {
      this.flight = null;
    }
    if (this.active && this.snapshot.action) await this.review();
  }
  public async review(): Promise<void> {
    const action = this.snapshot.action;
    if (!this.active || !action || this.flight) return;
    const controller = new AbortController();
    this.flight = controller;
    this.update({ phase: 'refreshing', current: null });
    try {
      const current = await this.ports.read(action, controller.signal);
      if (!this.active || controller.signal.aborted || !this.ports.isCurrent()) {
        this.update({ phase: 'review', current: null });
        return;
      }
      this.update({ current, phase: 'review' });
    } catch (cause) {
      if (this.active) {
        if (this.ports.isCurrent()) this.ports.failed(cause);
        this.update({
          phase: 'review',
          current: null,
          error:
            'Current content could not refresh. Your draft is retained; reconnect or refresh access, then retry the read.',
        });
      }
    } finally {
      this.flight = null;
    }
  }
  public suspend(): void {
    this.flight?.abort();
  }
  public activate(): void {
    this.active = true;
  }
  public dispose(): void {
    this.active = false;
    this.flight?.abort();
    this.listeners.clear();
  }
}
