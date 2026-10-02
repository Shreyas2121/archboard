import { allEntityGraphFixture } from '@archboard/fixtures';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createFreshGraphUpdate } from './fresh.js';
import { projectGraphDocument } from './project.js';
import { getGraphDocumentRoots } from '../schema/document.js';

describe('fresh portable initialization', () => {
  it('preserves all semantics through a complete disjoint ID map with empty tombstones', () => {
    const source = allEntityGraphFixture;
    const document = new Y.Doc();
    Y.applyUpdate(document, createFreshGraphUpdate(source));
    const output = projectGraphDocument(document);
    const ids = new Map<string, string>();
    for (const kind of ['nodes', 'edges', 'boundaries', 'steps'] as const) {
      // Pair by semantic content, since projection sorts newly generated IDs.
      for (const entity of source[kind]) {
        const match = output[kind].find((candidate) =>
          'title' in entity && 'title' in candidate
            ? candidate.title === entity.title
            : 'label' in entity && 'label' in candidate && candidate.label === entity.label,
        );
        expect(match).toBeDefined();
        ids.set(match!.id, entity.id);
      }
    }
    const oldIds = new Set(ids.values());
    expect([...ids.keys()].some((id) => oldIds.has(id))).toBe(false);
    const normalize = (value: unknown): unknown => {
      if (typeof value === 'string') return ids.get(value) ?? value;
      if (Array.isArray(value)) return value.map(normalize);
      if (value && typeof value === 'object')
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, normalize(item)]),
        );
      return value;
    };
    for (const kind of ['nodes', 'edges', 'boundaries', 'steps'] as const) {
      const normalized = normalize(output[kind]) as { id: string }[];
      expect(normalized.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
        [...source[kind]].sort((a, b) => a.id.localeCompare(b.id)),
      );
    }
    const roots = getGraphDocumentRoots(document);
    for (const root of [
      roots.deletedNodes,
      roots.deletedEdges,
      roots.deletedBoundaries,
      roots.deletedSteps,
    ])
      expect(root.size).toBe(0);
    document.destroy();
  });
});
