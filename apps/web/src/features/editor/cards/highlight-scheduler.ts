// Decorative highlighting has its own work budget; graph/text limits are unchanged.
export const MAX_HIGHLIGHT_CHARACTERS = 8_192;
export const MAX_PENDING_HIGHLIGHTS = 32;

interface HighlightJob {
  readonly run: () => Promise<void>;
}

/** One active tokenization, bounded waiting work, no retained token/content cache. */
export class HighlightScheduler {
  private readonly pending = new Set<HighlightJob>();
  private active = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  public schedule(run: () => Promise<void>): (() => void) | null {
    if (this.pending.size >= MAX_PENDING_HIGHLIGHTS) return null;
    const job = { run };
    this.pending.add(job);
    this.requestDrain();
    return () => {
      this.pending.delete(job);
      if (this.pending.size === 0 && this.timer !== undefined) {
        clearTimeout(this.timer);
        this.timer = undefined;
      }
    };
  }

  private requestDrain(): void {
    if (this.active || this.timer !== undefined || this.pending.size === 0) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const job = this.pending.values().next().value;
      if (job === undefined) return;
      this.pending.delete(job);
      this.active = true;
      void Promise.resolve()
        .then(job.run)
        .catch(() => undefined)
        .finally(() => {
          this.active = false;
          this.requestDrain();
        });
    }, 0);
  }
}

export const highlightScheduler = new HighlightScheduler();
