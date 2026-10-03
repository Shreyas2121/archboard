import { describe, expect, it } from 'vitest';
import { allEntityGraphFixture, createLimitGraphFixture } from '@archboard/fixtures';
import {
  navigableObjects,
  toggleObjectSelection,
  shouldRecoverObjectFocus,
} from '@/features/editor/selection/object-navigation';
import { geometryInputNumber } from '@/features/editor/selection/geometry-input';

describe('keyboard object navigation from the canonical projection', () => {
  it('exposes all kinds and endpoint names without changing graph data', () => {
    const graph = structuredClone(allEntityGraphFixture);
    const before = JSON.stringify(graph);
    const objects = navigableObjects(graph);
    expect(objects).toHaveLength(graph.nodes.length + graph.edges.length + graph.boundaries.length);
    for (const node of graph.nodes)
      expect(objects.find(({ reference }) => reference.id === node.id)?.label).toContain(node.kind);
    const edge = graph.edges[0]!;
    const label = objects.find(({ reference }) => reference.id === edge.id)?.label;
    expect(label).toContain(graph.nodes.find(({ id }) => id === edge.sourceId)!.title);
    expect(label).toContain(graph.nodes.find(({ id }) => id === edge.targetId)!.title);
    expect(JSON.stringify(graph)).toBe(before);
  });
  it('keeps the complete limit board discoverable and removes deleted references on reprojection', () => {
    const graph = createLimitGraphFixture();
    const before = navigableObjects(graph);
    expect(before).toHaveLength(graph.nodes.length + graph.edges.length + graph.boundaries.length);
    const removed = graph.nodes[0]!;
    const after = navigableObjects({
      ...graph,
      nodes: graph.nodes.filter(({ id }) => id !== removed.id),
      edges: graph.edges.filter(
        (edge) => edge.sourceId !== removed.id && edge.targetId !== removed.id,
      ),
    });
    expect(after.some(({ reference }) => reference.id === removed.id)).toBe(false);
  });
  it('supports single, group and deselection by typed identity without mutating prior selection', () => {
    const card = { id: 'same-id', kind: 'node' } as const;
    const boundary = { id: 'same-id', kind: 'boundary' } as const;
    const single = [card];
    const group = toggleObjectSelection(single, boundary);
    expect(group).toEqual([card, boundary]);
    expect(toggleObjectSelection(group, card)).toEqual([boundary]);
    expect(toggleObjectSelection(single, card)).toEqual([]);
    expect(single).toEqual([card]);
  });
  it('recovers a removed owned control without stealing focus from another panel or modal', () => {
    expect(shouldRecoverObjectFocus(true, true, false)).toBe(true);
    expect(shouldRecoverObjectFocus(true, false, false)).toBe(false);
    expect(shouldRecoverObjectFocus(true, true, true)).toBe(false);
    expect(shouldRecoverObjectFocus(false, true, false)).toBe(false);
  });
  it.each(['', ' ', 'NaN', 'Infinity', '-Infinity'])(
    'rejects invalid geometry field %j before any mutation',
    (value) => expect(() => geometryInputNumber(value)).toThrow(),
  );
  it('retains explicit zero and signed finite coordinates', () => {
    expect(geometryInputNumber('0')).toBe(0);
    const coordinate = -16;
    expect(geometryInputNumber(String(coordinate))).toBe(coordinate);
  });
});
