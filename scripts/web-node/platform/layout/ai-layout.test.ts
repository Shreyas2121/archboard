import { afterEach, describe, expect, it, vi } from 'vitest';
import { layoutAiDiagram, type AiLayoutWorker } from '@/platform/layout/ai-layout';
import { runAiLayeredLayout } from '@/platform/layout/ai-layout-worker';
import ELK from 'elkjs/lib/elk.bundled.js';
import { MAX_AI_OUTPUT_NODES } from '@archboard/contracts';
import {
  AI_LAYOUT_TIMEOUT_MS,
  fallbackAiLayout,
  type AiLayoutInput,
} from '@/features/editor/ai/ai-diagram-geometry';

const input: AiLayoutInput = {
  nodes: ['a', 'b', 'c'].map((key) => ({ key, size: { width: 300, height: 160 } })),
  edges: [{ key: 'ab', source: 'a', target: 'b' }],
};
const fixture = (): AiLayoutWorker => ({
  onmessage: null,
  onerror: null,
  onmessageerror: null,
  postMessage: vi.fn(),
  terminate: vi.fn(),
});
const event = (data: unknown) => ({ data }) as MessageEvent<unknown>;
const layered = (value: AiLayoutInput) => runAiLayeredLayout(value, new ELK());
afterEach(() => vi.useRealTimers());

describe('bounded AI diagram layout worker lifecycle', () => {
  it('sends geometry/topology only and terminates on valid success', async () => {
    const worker = fixture();
    const result = layoutAiDiagram(input, new AbortController().signal, () => worker);
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith(input);
    worker.onmessage!(event({ positions: fallbackAiLayout(input) }));
    expect((await result).status).toBe('layered');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
  });
  it('terminates an unresponsive worker at the deadline, ignores late completion and preserves every node', async () => {
    vi.useFakeTimers();
    const worker = fixture();
    const result = layoutAiDiagram(input, new AbortController().signal, () => worker);
    const stale = worker.onmessage!;
    await vi.advanceTimersByTimeAsync(AI_LAYOUT_TIMEOUT_MS);
    expect(await result).toEqual({
      status: 'fallback',
      reason: 'timeout',
      positions: fallbackAiLayout(input),
    });
    stale(event({ positions: [] }));
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('terminates on abort, rejects instead of returning a draft and never starts pre-aborted work', async () => {
    const worker = fixture();
    const abort = new AbortController();
    const result = layoutAiDiagram(input, abort.signal, () => worker);
    const rejected = expect(result).rejects.toThrow('cancelled');
    abort.abort();
    await rejected;
    expect(worker.terminate).toHaveBeenCalledOnce();
    const factory = vi.fn(() => worker);
    await expect(layoutAiDiagram(input, abort.signal, factory)).rejects.toThrow('cancelled');
    expect(factory).not.toHaveBeenCalled();
  });
  it('reports unavailable/crash/malformed replies as complete deterministic fallbacks', async () => {
    expect(
      (
        await layoutAiDiagram(input, new AbortController().signal, () => {
          throw new Error('unavailable');
        })
      ).reason,
    ).toBe('unavailable');
    for (const data of [
      { failed: true },
      { positions: [] },
      { positions: fallbackAiLayout(input).slice(1) },
      { positions: fallbackAiLayout(input).map((node) => ({ ...node, position: { x: 0, y: 0 } })) },
    ]) {
      const worker = fixture();
      const result = layoutAiDiagram(input, new AbortController().signal, () => worker);
      worker.onmessage!(event(data));
      expect((await result).positions).toEqual(fallbackAiLayout(input));
      expect(worker.terminate).toHaveBeenCalledOnce();
    }
    const worker = fixture();
    const result = layoutAiDiagram(input, new AbortController().signal, () => worker);
    worker.onerror!({} as ErrorEvent);
    expect((await result).reason).toBe('failed');
  });
  it('cleans up if cancellation happens while the worker factory is constructing', async () => {
    vi.useFakeTimers();
    const worker = fixture();
    const abort = new AbortController();
    await expect(
      layoutAiDiagram(input, abort.signal, () => {
        abort.abort();
        return worker;
      }),
    ).rejects.toThrow('cancelled');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('runs the pinned ELK engine deterministically with disconnected components and cyclic topology', async () => {
    const cyclic = { ...input, edges: [...input.edges, { key: 'ba', source: 'b', target: 'a' }] };
    const a = await layered(cyclic);
    expect(a).toEqual(await layered(cyclic));
    expect(a.map((node) => node.key)).toEqual(['a', 'b', 'c']);
  });
  it('keeps the maximum 40-node disconnected fallback complete and bounded', async () => {
    const maximum = {
      nodes: Array.from({ length: MAX_AI_OUTPUT_NODES }, (_, index) => ({
        key: `n-${index}`,
        size: { width: 400, height: 260 },
      })),
      edges: [],
    };
    expect((await layered(maximum)).length).toBe(MAX_AI_OUTPUT_NODES);
    expect(
      (
        await layoutAiDiagram(maximum, new AbortController().signal, () => {
          throw new Error();
        })
      ).positions.length,
    ).toBe(MAX_AI_OUTPUT_NODES);
  });
});
