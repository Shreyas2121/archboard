import { CLIENT_EVENT_NAMES, clientMessageSchema, type PresenterState } from '@archboard/contracts';

const EMPTY: PresenterState = { connectionId: null, stepId: null, expiresAt: null };

/** Transport observation and controls only; following is an explicit UI decision. */
export class TransientPresenter {
  private state: PresenterState = EMPTY;
  private readonly listeners = new Set<() => void>();
  private connectionId: string | null = null;
  private denied = false;
  public constructor(private readonly send: (message: unknown) => boolean) {}
  public getSnapshot = (): PresenterState => this.state;
  public getConnectionId = (): string | null => this.connectionId;
  public wasDenied = (): boolean => this.denied;
  public deny(): void {
    this.denied = true;
    for (const listener of this.listeners) listener();
  }
  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  public connect(connectionId: string): void {
    this.clear();
    this.connectionId = connectionId;
  }
  public acquire(): boolean {
    return this.control(CLIENT_EVENT_NAMES.PRESENTER_ACQUIRE, {});
  }
  public release(): boolean {
    return this.control(CLIENT_EVENT_NAMES.PRESENTER_RELEASE, {});
  }
  public select(stepId: string): boolean {
    return this.control(CLIENT_EVENT_NAMES.PRESENTER_STEP, { stepId });
  }
  public receive(state: PresenterState): void {
    if (this.connectionId === null) return;
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  public clear(): void {
    this.connectionId = null;
    this.reset();
  }
  /** Access changes clear observation while a still-open socket retains its identity. */
  public reset(): void {
    this.denied = false;
    this.state = EMPTY;
    for (const listener of this.listeners) listener();
  }
  private control(event: string, data: unknown): boolean {
    if (this.connectionId === null) return false;
    const parsed = clientMessageSchema.safeParse({ event, data });
    this.denied = false;
    return parsed.success && this.send(parsed.data);
  }
}
