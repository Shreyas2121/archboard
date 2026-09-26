import { GRAPH_SCHEMA_VERSION, type GraphProjection, MAX_LIVE_NODES } from '@archboard/contracts';
import {
  createGraphDocument,
  hydrateGraphDocument,
  restoreDeletedObjects,
} from '@archboard/document-model';
import {
  FIXED_IDS,
  buildNode,
  createLimitGraphFixture,
  createTypicalGraphFixture,
  minimalGraphFixture,
} from '@archboard/fixtures';
import * as Y from 'yjs';

import type { CandidateValidationInput } from './validation-worker-pool.js';

const INVALID_UPDATE_MARKER = 0xff;

function encodeGraph(graph: GraphProjection): Uint8Array {
  const document = createGraphDocument();
  try {
    restoreDeletedObjects(document, graph, (_kind, id) => id);
    return Y.encodeStateAsUpdate(document);
  } finally {
    document.destroy();
  }
}

export function createValidationFixture(graph: GraphProjection): CandidateValidationInput {
  const accepted = createGraphDocument();
  try {
    return {
      acceptedState: Y.encodeStateAsUpdate(accepted),
      update: encodeGraph(graph),
    };
  } finally {
    accepted.destroy();
  }
}

export function createTypicalValidationFixture(): CandidateValidationInput {
  return createValidationFixture(createTypicalGraphFixture());
}

export function createLimitValidationFixture(): CandidateValidationInput {
  return createValidationFixture(createLimitGraphFixture());
}

export function createLimitOverflowValidationFixture(): CandidateValidationInput {
  const acceptedState = encodeGraph(createLimitGraphFixture());
  const update = encodeGraph({
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [buildNode(MAX_LIVE_NODES)],
    edges: [],
    boundaries: [],
    steps: [],
  });
  return { acceptedState, update };
}

export function createMalformedValidationFixture(): CandidateValidationInput {
  const accepted = createGraphDocument();
  try {
    return {
      acceptedState: Y.encodeStateAsUpdate(accepted),
      update: Uint8Array.from([INVALID_UPDATE_MARKER, 0, INVALID_UPDATE_MARKER]),
    };
  } finally {
    accepted.destroy();
  }
}

function mutationFixture(
  prepare: (document: Y.Doc) => void,
  mutate: (document: Y.Doc) => void,
): CandidateValidationInput {
  const document = hydrateGraphDocument(minimalGraphFixture);
  try {
    prepare(document);
    const acceptedState = Y.encodeStateAsUpdate(document);
    const acceptedVector = Y.encodeStateVector(document);
    mutate(document);
    return { acceptedState, update: Y.encodeStateAsUpdate(document, acceptedVector) };
  } finally {
    document.destroy();
  }
}

export function createImmutableEndpointValidationFixture(): CandidateValidationInput {
  return mutationFixture(
    () => undefined,
    (document) => {
      const edge = document.getMap('edges').get(FIXED_IDS.EDGE_A) as Y.Map<unknown>;
      edge.set('sourceId', FIXED_IDS.NODE_B);
      edge.set('targetId', FIXED_IDS.NODE_A);
    },
  );
}

export function createRemovedEntityValidationFixture(): CandidateValidationInput {
  return mutationFixture(
    () => undefined,
    (document) => document.getMap('edges').delete(FIXED_IDS.EDGE_A),
  );
}

export function createRemovedTombstoneValidationFixture(): CandidateValidationInput {
  return mutationFixture(
    (document) => document.getMap('deletedEdges').set(FIXED_IDS.EDGE_A, true),
    (document) => document.getMap('deletedEdges').delete(FIXED_IDS.EDGE_A),
  );
}
