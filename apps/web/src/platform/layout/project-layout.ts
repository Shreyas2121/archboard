import {
  PROJECT_LAYOUT_TIMEOUT_MS,
  projectLayoutInputSchema,
  validateProjectPositions,
  fallbackProjectLayout,
  type ProjectLayout,
  type ProjectLayoutInput,
} from '@/features/editor/project-context/project-context-layout';

export interface ProjectLayoutWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(input: ProjectLayoutInput): void;
  terminate(): void;
}
export type ProjectLayoutWorkerFactory = () => ProjectLayoutWorker;
const browserWorker: ProjectLayoutWorkerFactory = () =>
  new Worker(new URL('./project-layout.worker.ts', import.meta.url), {
    type: 'module',
    name: 'archboard-project-layout',
  });

/** Abort rejects without a draft; engine failure/timeout yields a complete honest fallback. */
export function layoutProjectDiagram(
  value: ProjectLayoutInput,
  signal: AbortSignal,
  factory: ProjectLayoutWorkerFactory = browserWorker,
): Promise<ProjectLayout> {
  const input = projectLayoutInputSchema.parse(value);
  if (signal.aborted) return Promise.reject(new Error('Diagram preparation cancelled.'));
  return new Promise((resolve, reject) => {
    let worker: ProjectLayoutWorker | undefined;
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
    const finish = (result: ProjectLayout) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const fallback = (reason: NonNullable<ProjectLayout['reason']>) =>
      finish({
        positions: validateProjectPositions(input, fallbackProjectLayout(input)),
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
          finish({
            positions: validateProjectPositions(input, value.positions),
            status: 'layered',
          });
        } catch {
          fallback('invalid');
        }
      };
      worker.onerror = () => fallback('failed');
      worker.onmessageerror = () => fallback('invalid');
      timer = setTimeout(() => fallback('timeout'), PROJECT_LAYOUT_TIMEOUT_MS);
      worker.postMessage(input);
    } catch {
      fallback('unavailable');
    }
  });
}
