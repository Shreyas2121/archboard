import { PRESENTER_LEASE_TIMEOUT_MS, type PresenterState } from '@archboard/contracts';

/** Mutated only under the room queue. No graph or durable state is owned here. */
export class PresenterLease {
  private holder: string | null = null;
  private step: string | null = null;
  private deadline = 0;
  private changed = false;

  public consumeChange(): boolean {
    const changed = this.changed;
    this.changed = false;
    return changed;
  }
  public hasChanges(): boolean {
    return this.changed;
  }

  public snapshot(): PresenterState {
    return {
      connectionId: this.holder,
      stepId: this.step,
      expiresAt: this.holder === null ? null : new Date(this.deadline).toISOString(),
    };
  }
  public acquire(connectionId: string, now: number): boolean {
    if (this.holder !== null) return this.holder === connectionId;
    this.holder = connectionId;
    this.changed = true;
    this.deadline = now + PRESENTER_LEASE_TIMEOUT_MS;
    return true;
  }
  public select(connectionId: string, stepId: string, live: boolean): boolean {
    if (this.holder !== connectionId || !live) return false;
    if (this.step !== stepId) this.changed = true;
    this.step = stepId;
    return true;
  }
  public heartbeat(connectionId: string, now: number): boolean {
    if (this.holder !== connectionId || now >= this.deadline) return false;
    this.deadline = now + PRESENTER_LEASE_TIMEOUT_MS;
    this.changed = true;
    return true;
  }
  public release(connectionId: string): boolean {
    if (this.holder !== connectionId) return false;
    this.clear();
    return true;
  }
  public expire(now: number): boolean {
    if (this.holder === null || now < this.deadline) return false;
    this.clear();
    return true;
  }
  public reconcile(liveIds: readonly string[]): void {
    if (this.step !== null && !liveIds.includes(this.step)) {
      this.step = null;
      this.changed = true;
    }
  }
  public clear(): void {
    if (this.holder !== null) this.changed = true;
    this.holder = null;
    this.step = null;
    this.deadline = 0;
  }
}
