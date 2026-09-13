import type * as Y from 'yjs';

import { projectPhysicalGraph } from '../projection/project.js';
import type { PhysicalGraph } from './read.js';
import { readPhysicalGraph } from './read.js';
import { DocumentValidationError } from './error.js';

function requireAcceptedKeys<T>(
  accepted: ReadonlyMap<string, T>,
  candidate: ReadonlyMap<string, T>,
  rootName: string,
): void {
  for (const id of accepted.keys()) {
    if (!candidate.has(id)) {
      throw new DocumentValidationError([
        { path: [rootName, id], message: 'Accepted entities cannot be physically removed.' },
      ]);
    }
  }
}

function requireAcceptedTombstones(
  accepted: ReadonlySet<string>,
  candidate: ReadonlySet<string>,
  rootName: string,
): void {
  for (const id of accepted) {
    if (!candidate.has(id)) {
      throw new DocumentValidationError([
        { path: [rootName, id], message: 'Accepted tombstones are append-only.' },
      ]);
    }
  }
}

function validateImmutableFields(candidate: PhysicalGraph, accepted: PhysicalGraph): void {
  requireAcceptedKeys(accepted.nodes, candidate.nodes, 'nodes');
  requireAcceptedKeys(accepted.edges, candidate.edges, 'edges');
  requireAcceptedKeys(accepted.boundaries, candidate.boundaries, 'boundaries');
  requireAcceptedKeys(accepted.steps, candidate.steps, 'steps');
  requireAcceptedTombstones(accepted.deletedNodes, candidate.deletedNodes, 'deletedNodes');
  requireAcceptedTombstones(accepted.deletedEdges, candidate.deletedEdges, 'deletedEdges');
  requireAcceptedTombstones(
    accepted.deletedBoundaries,
    candidate.deletedBoundaries,
    'deletedBoundaries',
  );
  requireAcceptedTombstones(accepted.deletedSteps, candidate.deletedSteps, 'deletedSteps');

  for (const [id, previous] of accepted.nodes) {
    const next = candidate.nodes.get(id)!;
    if (next.kind !== previous.kind) {
      throw new DocumentValidationError([
        { path: ['nodes', id, 'kind'], message: 'Accepted node kinds are immutable.' },
      ]);
    }
  }
  for (const [id, previous] of accepted.edges) {
    const next = candidate.edges.get(id)!;
    for (const field of ['sourceId', 'targetId', 'sourceHandle', 'targetHandle'] as const) {
      if (next[field] !== previous[field]) {
        throw new DocumentValidationError([
          {
            path: ['edges', id, field],
            message: 'Accepted edge endpoints and handles are immutable.',
          },
        ]);
      }
    }
  }
}

export function validateGraphDocument(document: Y.Doc, acceptedDocument?: Y.Doc): void {
  const candidate = readPhysicalGraph(document);
  projectPhysicalGraph(candidate);
  if (acceptedDocument !== undefined) {
    validateImmutableFields(candidate, readPhysicalGraph(acceptedDocument));
  }
}
