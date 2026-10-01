import type { InvitePreview, InviteAcceptance } from '@archboard/contracts';

export type InviteFailure =
  'expired' | 'unavailable' | 'exhausted' | 'archived' | 'session-expired' | 'network';
export type InviteStage =
  | InviteFailure
  | 'idle'
  | 'loading'
  | 'ready'
  | 'accepting'
  | 'uncertain'
  | 'accepted'
  | 'already-member';
export interface InviteAcceptanceState {
  readonly stage: InviteStage;
  readonly preview: InvitePreview | null;
  readonly result: InviteAcceptance | null;
  readonly refreshFailed: boolean;
  readonly opening: boolean;
  readonly previewFetchedAt: number | null;
}
export interface InviteAcceptancePorts {
  readonly authenticate: (signal: AbortSignal) => Promise<boolean>;
  readonly current: () => boolean;
  readonly preview: (signal: AbortSignal) => Promise<InvitePreview>;
  readonly accept: (signal: AbortSignal) => Promise<InviteAcceptance>;
  readonly failure: (cause: unknown) => InviteFailure;
  readonly alreadyMember: (result: InviteAcceptance, preview: InvitePreview | null) => boolean;
  readonly openBoard: (result: InviteAcceptance, signal: AbortSignal) => Promise<void>;
}

/** Explicit acceptance only. Tokens live in the route/ports, never in query or draft records. */
export class InviteAcceptanceFlow {
  private state: InviteAcceptanceState = {
    stage: 'idle',
    preview: null,
    result: null,
    refreshFailed: false,
    opening: false,
    previewFetchedAt: null,
  };
  private readonly listeners = new Set<() => void>();
  private request: AbortController | null = null;
  private active = true;
  public constructor(private readonly ports: InviteAcceptancePorts) {}
  public readonly getSnapshot = () => this.state;
  public readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  public activate(): void {
    this.active = true;
  }
  public dispose(): void {
    this.active = false;
    this.request?.abort();
    this.request = null;
  }
  public cancelForOffline(): void {
    this.request?.abort();
  }
  private current(controller: AbortController): boolean {
    return this.active && this.ports.current() && this.request === controller;
  }
  private set(state: InviteAcceptanceState): void {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }
  public async load(): Promise<void> {
    if (this.request || !this.active || !this.ports.current()) return;
    // A lost acceptance must be retried explicitly, not hidden by an exhausted preview.
    if (this.state.stage === 'uncertain' || this.state.result) return;
    const controller = new AbortController();
    this.request = controller;
    this.set({
      stage: 'loading',
      preview: null,
      result: null,
      refreshFailed: false,
      opening: false,
      previewFetchedAt: null,
    });
    try {
      if (!(await this.ports.authenticate(controller.signal))) {
        if (this.current(controller)) this.set({ ...this.state, stage: 'session-expired' });
        return;
      }
      if (!this.current(controller)) return;
      if (controller.signal.aborted) {
        this.set({ ...this.state, stage: 'network' });
        return;
      }
      const preview = await this.ports.preview(controller.signal);
      if (this.current(controller) && !controller.signal.aborted)
        this.set({ ...this.state, stage: 'ready', preview, previewFetchedAt: Date.now() });
    } catch (cause) {
      if (this.current(controller))
        this.set({ ...this.state, preview: null, stage: this.ports.failure(cause) });
    } finally {
      if (this.request === controller) this.request = null;
    }
  }
  public async accept(): Promise<void> {
    if (this.request || !this.active || !this.ports.current()) return;
    if (!['ready', 'uncertain', 'exhausted'].includes(this.state.stage)) return;
    const controller = new AbortController();
    this.request = controller;
    const preview = this.state.preview;
    this.set({ ...this.state, stage: 'accepting', refreshFailed: false });
    let submitted = false;
    try {
      if (!(await this.ports.authenticate(controller.signal))) {
        if (this.current(controller))
          this.set({ ...this.state, preview: null, stage: 'session-expired' });
        return;
      }
      if (!this.current(controller)) return;
      if (controller.signal.aborted) {
        this.set({ ...this.state, stage: 'ready' });
        return;
      }
      submitted = true;
      const result = await this.ports.accept(controller.signal);
      if (!this.current(controller)) return;
      this.set({
        stage: this.ports.alreadyMember(result, preview) ? 'already-member' : 'accepted',
        preview: null,
        result,
        refreshFailed: false,
        opening: true,
        previewFetchedAt: null,
      });
      await this.ports.openBoard(result, controller.signal);
    } catch (cause) {
      if (!this.current(controller)) return;
      if (this.state.result) this.set({ ...this.state, refreshFailed: true });
      else {
        const failure = this.ports.failure(cause);
        this.set({
          ...this.state,
          stage:
            submitted && (controller.signal.aborted || failure === 'network')
              ? 'uncertain'
              : failure,
          preview: failure === 'network' ? preview : null,
        });
      }
    } finally {
      if (this.current(controller) && this.state.opening)
        this.set({ ...this.state, opening: false });
      if (this.request === controller) this.request = null;
    }
  }
  public async openBoard(): Promise<void> {
    if (this.request || !this.state.result || !this.active || !this.ports.current()) return;
    const controller = new AbortController();
    this.request = controller;
    this.set({ ...this.state, opening: true, refreshFailed: false });
    try {
      if (!(await this.ports.authenticate(controller.signal)))
        throw new Error('Session unavailable');
      if (this.current(controller))
        await this.ports.openBoard(this.state.result, controller.signal);
    } catch {
      if (this.current(controller)) this.set({ ...this.state, refreshFailed: true });
    } finally {
      if (this.current(controller)) this.set({ ...this.state, opening: false });
      if (this.request === controller) this.request = null;
    }
  }
}
