import { expect, it, vi } from 'vitest';
import { createLimitGraphFixture } from '@archboard/fixtures';
import { CanvasProjectionAdapter, type CanvasNode } from './projection-adapter';
import { CanvasRenderCache } from './canvas-render-cache';

it('retains unrelated final node and data identities on a large graph', () => {
  const fixture = createLimitGraphFixture();
  const adapter = new CanvasProjectionAdapter();
  const cache = new CanvasRenderCache<CanvasNode>();
  const build = vi.fn((node: CanvasNode) => ({ ...node, data: { ...node.data, editable: true } }));
  const render = (graph: typeof fixture) =>
    adapter
      .adapt(graph)
      .nodes.map((node) => cache.get(node.id, [node, false, true], () => build(node)));
  const before = render(fixture);
  expect(render(fixture)).toEqual(before);
  expect(build).toHaveBeenCalledTimes(fixture.nodes.length);
  const changed = render({
    ...fixture,
    nodes: fixture.nodes.map((node, index) =>
      index === 0 ? { ...node, title: 'Edited title' } : node,
    ),
  });
  expect(changed[0]).not.toBe(before[0]);
  for (let index = 1; index < before.length; index += 1) expect(changed[index]).toBe(before[index]);
  expect(build).toHaveBeenCalledTimes(fixture.nodes.length + 1);
});

it('invalidates selection, editability, handlers and removed entities', () => {
  const cache = new CanvasRenderCache<object>();
  const source = {};
  const handler = () => {};
  const build = () => ({});
  const original = cache.get('card', [source, false, true, handler], build);
  expect(cache.get('card', [source, false, true, handler], build)).toBe(original);
  expect(cache.get('card', [source, true, true, handler], build)).not.toBe(original);
  const selected = cache.get('card', [source, true, true, handler], build);
  expect(cache.get('card', [source, true, false, handler], build)).not.toBe(selected);
  const readonly = cache.get('card', [source, true, false, handler], build);
  expect(cache.get('card', [source, true, false, () => {}], build)).not.toBe(readonly);
  cache.retain(new Set());
  expect(cache.get('card', [source, false, true, handler], build)).not.toBe(original);
});
