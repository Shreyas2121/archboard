import {
  presenterStateSchema,
  type PresenterState,
  type PresentationStep,
} from '@archboard/contracts';

const EMPTY_LEASE: PresenterState = { connectionId: null, stepId: null, expiresAt: null };
export interface PresenterFollowSnapshot {
  readonly connectionId: string | null;
  readonly live: boolean;
  readonly lease: PresenterState;
  readonly following: boolean;
}

export function resolveFollowedStep(
  state: PresenterFollowSnapshot,
  steps: readonly PresentationStep[],
  now: number,
): PresentationStep | null {
  if (
    !state.live ||
    !state.following ||
    state.lease.expiresAt === null ||
    Date.parse(state.lease.expiresAt) <= now
  )
    return null;
  return steps.find(({ id }) => id === state.lease.stepId) ?? null;
}

/** One namespace and observer connection. Owns no graph, viewport or saved preference. */
export class PresenterFollowModel {
  private state: PresenterFollowSnapshot = {
    connectionId: null,
    live: false,
    lease: EMPTY_LEASE,
    following: false,
  };
  private readonly listeners = new Set<() => void>();
  private readonly scope: string;
  public constructor(scope: string) {
    this.scope = scope;
  }
  public getSnapshot = (): PresenterFollowSnapshot => this.state;
  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  public bind(connectionId: string | null, live: boolean): void {
    live = live && connectionId !== null;
    if (this.state.connectionId === connectionId && this.state.live === live) return;
    this.set({ connectionId, live, lease: EMPTY_LEASE, following: false });
  }
  public receive(
    scope: string,
    connectionId: string | null,
    lease: PresenterState,
    now: number,
  ): void {
    if (scope !== this.scope || connectionId !== this.state.connectionId || !this.state.live)
      return;
    const parsed = presenterStateSchema.safeParse(lease);
    if (!parsed.success) return;
    const incoming = parsed.data;
    const previousExpired =
      this.state.lease.expiresAt !== null && Date.parse(this.state.lease.expiresAt) <= now;
    const expired = incoming.expiresAt !== null && Date.parse(incoming.expiresAt) <= now;
    const sameHolder =
      incoming.connectionId !== null && incoming.connectionId === this.state.lease.connectionId;
    this.set({
      ...this.state,
      lease: expired ? EMPTY_LEASE : incoming,
      following: this.state.following && sameHolder && !previousExpired && !expired,
    });
  }
  public expire(now: number): void {
    if (this.state.lease.expiresAt !== null && Date.parse(this.state.lease.expiresAt) <= now)
      this.set({ ...this.state, lease: EMPTY_LEASE, following: false });
  }
  public follow(now: number): boolean {
    this.expire(now);
    if (
      !this.state.live ||
      this.state.lease.connectionId === null ||
      this.state.lease.connectionId === this.state.connectionId
    )
      return false;
    this.set({ ...this.state, following: true });
    return true;
  }
  public unfollow(): void {
    if (this.state.following) this.set({ ...this.state, following: false });
  }
  private set(state: PresenterFollowSnapshot): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
