import type { ServerResponse } from 'node:http';
import { aiRunEventSchema, type AiRun } from '@archboard/contracts';

const SNAPSHOT_INTERVAL_MS = 5_000;
const MAX_STREAM_MS = 120_000;
const MAX_FRAMES = 64;
const MAX_STREAM_BYTES = 65_536;
export function aiSnapshotEvent(run: AiRun) {
  const base = { schemaVersion: 1, runId: run.id, sequence: String(Date.parse(run.updatedAt)) };
  return aiRunEventSchema.parse(
    run.content.status === 'available'
      ? { ...base, type: 'result-available', state: run.state, expiresAt: run.content.expiresAt }
      : run.content.status === 'expired'
        ? { ...base, type: 'content-expired', expiredAt: run.content.expiredAt }
        : run.failure
          ? { ...base, type: 'failed', failure: run.failure }
          : run.state === 'cancelled'
            ? { ...base, type: 'cancelled' }
            : { ...base, type: 'status', state: run.state },
  );
}
/** No provider deltas or replay queue. Each heartbeat/snapshot reauthorizes. */
export class AiEvents {
  private readonly closers = new Set<() => void>();
  public async serve(
    response: ServerResponse,
    subscription: { close(): void; next(requireSession?: () => Promise<void>): Promise<AiRun> },
    requireSession: () => Promise<void>,
  ): Promise<void> {
    let closed = false;
    let timer: NodeJS.Timeout | undefined;
    let frames = 0;
    let bytes = 0;
    let previous = '';
    const close = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      clearTimeout(deadline);
      subscription.close();
      response.off('close', close);
      response.off('error', close);
      this.closers.delete(close);
      if (!response.writableEnded) response.end();
    };
    response.on('close', close);
    response.on('error', close);
    this.closers.add(close);
    const deadline = setTimeout(close, MAX_STREAM_MS);
    deadline.unref();
    const deliver = async () => {
      // Include session revalidation in active subscription work, so a slow
      // authorized heartbeat cannot be expired as an idle consumer.
      const run = await subscription.next(requireSession);
      if (closed) return;
      const event = aiSnapshotEvent(run);
      const json = JSON.stringify(event);
      const frame =
        json === previous
          ? ': heartbeat\n\n'
          : `id: ${event.sequence}\nevent: ${event.type}\ndata: ${json}\n\n`;
      previous = json;
      frames += 1;
      bytes += Buffer.byteLength(frame);
      if (frames > MAX_FRAMES || bytes > MAX_STREAM_BYTES) {
        close();
        return;
      }
      if (!response.headersSent) {
        response.setHeader('cache-control', 'no-store');
        response.setHeader('content-type', 'text/event-stream; charset=utf-8');
        response.setHeader('x-accel-buffering', 'no');
      }
      // A slow client gets at most one bounded write; disconnect instead of queuing.
      if (!response.write(frame)) {
        close();
        return;
      }
      if (run.content.status !== 'pending') {
        close();
        return;
      }
      timer = setTimeout(() => {
        void deliver().catch(close);
      }, SNAPSHOT_INTERVAL_MS);
      timer.unref();
    };
    try {
      await deliver();
    } catch (error) {
      if (closed) return;
      // Before any stream bytes, let the central filter return the normal error envelope.
      closed = true;
      clearTimeout(timer);
      clearTimeout(deadline);
      subscription.close();
      response.off('close', close);
      response.off('error', close);
      this.closers.delete(close);
      if (response.headersSent) response.end();
      else throw error;
    }
  }
  public onModuleDestroy(): void {
    for (const close of this.closers) close();
  }
}
