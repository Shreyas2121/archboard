import { ERROR_CODES } from '@archboard/contracts';
import { Global, Injectable, Module } from '@nestjs/common';
import { fail } from '../http/api-boundary.js';

@Injectable()
export class RuntimeAdmission {
  private owned = false;
  private compatible = false;
  private stopped = false;
  private lost = false;
  private transactions = 0;
  private readonly idle = new Set<() => void>();

  public get accepting(): boolean {
    return this.owned && this.compatible && !this.stopped;
  }
  public get stopping(): boolean {
    return this.stopped;
  }
  public get activeTransactions(): number {
    return this.transactions;
  }
  public setOwnership(owned: boolean): void {
    this.owned = owned;
    if (!owned) {
      this.lost = true;
      this.stop();
    }
    this.reportState();
  }
  public setSchemaCompatible(compatible: boolean): void {
    if (this.compatible === compatible) return;
    this.compatible = compatible;
    this.reportState();
  }
  public stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.reportState();
  }
  public assertAccepting(): void {
    if (!this.accepting)
      fail(ERROR_CODES.TEMPORARILY_UNAVAILABLE, 'Service temporarily unavailable.');
  }
  public beginTransaction(): () => void {
    this.assertAccepting();
    this.transactions++;
    let finished = false;
    return () => {
      if (finished) return;
      finished = true;
      this.transactions--;
      if (this.transactions === 0) {
        for (const resolve of this.idle) resolve();
        this.idle.clear();
      }
    };
  }
  public whenIdle(): Promise<void> {
    return this.transactions === 0
      ? Promise.resolve()
      : new Promise((resolve) => this.idle.add(resolve));
  }
  /** Already admitted work may finish on graceful shutdown, never after ownership loss. */
  public assertCanCommit(): void {
    if (this.lost || !this.owned || !this.compatible)
      fail(ERROR_CODES.TEMPORARILY_UNAVAILABLE, 'Service temporarily unavailable.');
  }
  private reportState(): void {
    try {
      console.info(
        JSON.stringify({
          event: 'runtime.admission',
          accepting: this.accepting,
          activeTransactions: this.transactions,
        }),
      );
    } catch {
      // A failed diagnostic sink cannot change writer fencing.
    }
  }
}

@Global()
@Module({ providers: [RuntimeAdmission], exports: [RuntimeAdmission] })
export class RuntimeAdmissionModule {}
