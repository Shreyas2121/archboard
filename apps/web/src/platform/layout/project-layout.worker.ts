import { runProjectLayeredLayout } from './project-layout-worker';
import type { ProjectLayoutInput } from '@/features/editor/project-context/project-context-layout';

// A worker receives a single bounded topology request and returns geometry only.
declare const self: {
  onmessage: ((event: MessageEvent<ProjectLayoutInput>) => void) | null;
  postMessage(value: unknown): void;
};
self.onmessage = async (event) => {
  try {
    self.postMessage({ positions: await runProjectLayeredLayout(event.data) });
  } catch {
    // Do not transmit/log graph content or engine diagnostics.
    self.postMessage({ failed: true });
  }
};
