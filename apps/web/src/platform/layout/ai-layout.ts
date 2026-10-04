import {
  AI_LAYOUT_TIMEOUT_MS,
  aiLayoutInputSchema,
  validateAiPositions,
  fallbackAiLayout,
  type AiLayout,
  type AiLayoutInput,
} from '@/features/editor/ai/ai-diagram-geometry';

export interface AiLayoutWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(input: AiLayoutInput): void;
  terminate(): void;
}
export type AiLayoutWorkerFactory = () => AiLayoutWorker;
const browserWorker: AiLayoutWorkerFactory = () =>
  new Worker(new URL('./ai-layout.worker.ts', import.meta.url), {
    type: 'module',
    name: 'archboard-diagram-layout',
  });

/** Abort rejects without a draft; engine failure/timeout yields a complete honest fallback. */
export function layoutAiDiagram(
  value: AiLayoutInput,
  signal: AbortSignal,
  factory: AiLayoutWorkerFactory = browserWorker,
): Promise<AiLayout> {
  const input = aiLayoutInputSchema.parse(value);
  if (signal.aborted) return Promise.reject(new Error('Diagram preparation cancelled.'));
  return new Promise((resolve, reject) => {
    let worker: AiLayoutWorker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        worker.terminate();
      }
    };
    const finish = (result: AiLayout) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const fallback = (reason: NonNullable<AiLayout['reason']>) =>
      finish({
        positions: validateAiPositions(input, fallbackAiLayout(input)),
        status: 'fallback',
        reason,
      });
    const cancel = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Diagram preparation cancelled.'));
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      worker = factory();
      if (settled || signal.aborted) {
        worker.terminate();
        return;
      }
      worker.onmessage = (event) => {
        if (settled) return;
        try {
          const value = event.data;
          if (!value || typeof value !== 'object' || !('positions' in value)) {
            fallback('failed');
            return;
          }
          finish({ positions: validateAiPositions(input, value.positions), status: 'layered' });
        } catch {
          fallback('invalid');
        }
      };
      worker.onerror = () => fallback('failed');
      worker.onmessageerror = () => fallback('invalid');
      timer = setTimeout(() => fallback('timeout'), AI_LAYOUT_TIMEOUT_MS);
      worker.postMessage(input);
    } catch {
      fallback('unavailable');
    }
  });
}
