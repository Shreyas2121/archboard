import { GRAPH_SCHEMA_VERSION } from '@archboard/contracts';
import * as Y from 'yjs';

import { GRAPH_ROOT_NAMES, META_FIELDS } from './constants.js';

export interface GraphDocumentRoots {
  readonly meta: Y.Map<unknown>;
  readonly nodes: Y.Map<unknown>;
  readonly edges: Y.Map<unknown>;
  readonly boundaries: Y.Map<unknown>;
  readonly steps: Y.Map<unknown>;
  readonly deletedNodes: Y.Map<unknown>;
  readonly deletedEdges: Y.Map<unknown>;
  readonly deletedBoundaries: Y.Map<unknown>;
  readonly deletedSteps: Y.Map<unknown>;
}

export function getGraphDocumentRoots(document: Y.Doc): GraphDocumentRoots {
  return {
    meta: document.getMap(GRAPH_ROOT_NAMES.META),
    nodes: document.getMap(GRAPH_ROOT_NAMES.NODES),
    edges: document.getMap(GRAPH_ROOT_NAMES.EDGES),
    boundaries: document.getMap(GRAPH_ROOT_NAMES.BOUNDARIES),
    steps: document.getMap(GRAPH_ROOT_NAMES.STEPS),
    deletedNodes: document.getMap(GRAPH_ROOT_NAMES.DELETED_NODES),
    deletedEdges: document.getMap(GRAPH_ROOT_NAMES.DELETED_EDGES),
    deletedBoundaries: document.getMap(GRAPH_ROOT_NAMES.DELETED_BOUNDARIES),
    deletedSteps: document.getMap(GRAPH_ROOT_NAMES.DELETED_STEPS),
  };
}

export function createGraphDocument(): Y.Doc {
  const document = new Y.Doc();
  getGraphDocumentRoots(document);
  // Seed metadata under a separate client. Hydration happens before update
  // listeners attach; consuming the live client's clock here would make its
  // first persisted edit depend on an initialization record absent on peers.
  const seed = new Y.Doc();
  try {
    seed.getMap(GRAPH_ROOT_NAMES.META).set(META_FIELDS.SCHEMA_VERSION, GRAPH_SCHEMA_VERSION);
    Y.applyUpdate(document, Y.encodeStateAsUpdate(seed));
  } finally {
    seed.destroy();
  }
  return document;
}
