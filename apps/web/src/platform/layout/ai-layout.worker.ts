import { runAiLayeredLayout } from './ai-layout-worker';
import type { AiLayoutInput } from '@/features/editor/ai/ai-diagram-geometry';

// A worker receives a single bounded topology request and returns geometry only.
declare const self: {
  onmessage: ((event: MessageEvent<AiLayoutInput>) => void) | null;
  postMessage(value: unknown): void;
};
self.onmessage = async (event) => {
  try {
    self.postMessage({ positions: await runAiLayeredLayout(event.data) });
  } catch {
    // Do not transmit/log provider text, graph content or engine diagnostics.
    self.postMessage({ failed: true });
  }
};
