import type * as Y from 'yjs';

import { getGraphDocumentRoots } from '../schema/document.js';
import { GraphCommandError } from './error.js';
import { LOCAL_STRUCTURAL_ORIGIN } from './internal.js';

type EntityKind = 'node' | 'edge' | 'boundary' | 'step';

export function tombstoneEntity(document: Y.Doc, kind: EntityKind, id: string): void {
  const roots = getGraphDocumentRoots(document);
  const [entities, tombstones] =
    kind === 'node'
      ? [roots.nodes, roots.deletedNodes]
      : kind === 'edge'
        ? [roots.edges, roots.deletedEdges]
        : kind === 'boundary'
          ? [roots.boundaries, roots.deletedBoundaries]
          : [roots.steps, roots.deletedSteps];
  if (!entities.has(id)) throw new GraphCommandError(`${kind} ${id} does not exist.`);
  if (tombstones.has(id)) return;
  document.transact(() => tombstones.set(id, true), LOCAL_STRUCTURAL_ORIGIN);
}

export const tombstoneNode = (document: Y.Doc, id: string): void =>
  tombstoneEntity(document, 'node', id);
export const tombstoneEdge = (document: Y.Doc, id: string): void =>
  tombstoneEntity(document, 'edge', id);
export const tombstoneBoundary = (document: Y.Doc, id: string): void =>
  tombstoneEntity(document, 'boundary', id);
export const tombstonePresentationStep = (document: Y.Doc, id: string): void =>
  tombstoneEntity(document, 'step', id);
