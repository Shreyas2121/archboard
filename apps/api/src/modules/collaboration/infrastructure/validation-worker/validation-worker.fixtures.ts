import { GRAPH_SCHEMA_VERSION, type GraphProjection, MAX_LIVE_NODES } from '@archboard/contracts';
import { createGraphDocument, restoreDeletedObjects } from '@archboard/document-model';
import { buildNode, createLimitGraphFixture, createTypicalGraphFixture } from '@archboard/fixtures';
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
