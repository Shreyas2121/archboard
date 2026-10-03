export const COLLABORATION_DRAIN_MS = 20_000;
export const PROCESS_SHUTDOWN_MS = 25_000;

/** On timeout, exit while ownership is still held; never unlock beneath live work. */
export class ShutdownDeadline {
  public async run<T>(work: () => Promise<T>, milliseconds: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        Promise.resolve().then(work),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            this.terminate();
            reject(new Error('Shutdown deadline exceeded.'));
          }, milliseconds);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  protected terminate(): void {
    console.info(JSON.stringify({ event: 'runtime.shutdown_timeout' }));
    process.exit(1);
  }
}
