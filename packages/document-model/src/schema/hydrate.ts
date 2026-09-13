import {
  GRAPH_SCHEMA_VERSION,
  NODE_KINDS,
  graphProjectionSchema,
  type Boundary,
  type GraphEdge,
  type GraphNode,
  type GraphProjection,
  type PresentationStep,
} from '@archboard/contracts';
import * as Y from 'yjs';

import {
  BOUNDARY_FIELDS,
  EDGE_FIELDS,
  META_FIELDS,
  NODE_FIELDS,
  STEP_FIELDS,
} from './constants.js';
import { createGraphDocument, getGraphDocumentRoots } from './document.js';

function yText(value: string): Y.Text {
  const text = new Y.Text();
  text.insert(0, value);
  return text;
}

function nodeMap(node: GraphNode): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set(NODE_FIELDS.KIND, node.kind);
  map.set(NODE_FIELDS.POSITION, { ...node.position });
  map.set(NODE_FIELDS.SIZE, { ...node.size });
  map.set(NODE_FIELDS.TITLE, yText(node.title));
  map.set(NODE_FIELDS.COLOR, node.color);

  switch (node.kind) {
    case NODE_KINDS.COMPONENT:
      map.set(NODE_FIELDS.CATEGORY, node.content.category);
      map.set(NODE_FIELDS.DESCRIPTION, yText(node.content.description));
      map.set(NODE_FIELDS.TECHNOLOGY, yText(node.content.technology));
      map.set(NODE_FIELDS.EXTERNAL_URL, node.content.externalUrl);
      break;
    case NODE_KINDS.CODE:
      map.set(NODE_FIELDS.LANGUAGE, node.content.language);
      map.set(NODE_FIELDS.BODY, yText(node.content.body));
      break;
    case NODE_KINDS.SCHEMA:
    case NODE_KINDS.NOTE:
      map.set(NODE_FIELDS.BODY, yText(node.content.body));
      break;
  }
  return map;
}

function edgeMap(edge: GraphEdge): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set(EDGE_FIELDS.SOURCE_ID, edge.sourceId);
  map.set(EDGE_FIELDS.TARGET_ID, edge.targetId);
  map.set(EDGE_FIELDS.SOURCE_HANDLE, edge.sourceHandle);
  map.set(EDGE_FIELDS.TARGET_HANDLE, edge.targetHandle);
  map.set(EDGE_FIELDS.LABEL, yText(edge.label));
  map.set(EDGE_FIELDS.PROTOCOL, yText(edge.protocol));
  map.set(EDGE_FIELDS.DIRECTION, edge.direction);
  map.set(EDGE_FIELDS.STYLE, edge.style);
  return map;
}

function boundaryMap(boundary: Boundary): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set(BOUNDARY_FIELDS.TITLE, yText(boundary.title));
  map.set(BOUNDARY_FIELDS.RECT, { ...boundary.rect });
  map.set(BOUNDARY_FIELDS.COLOR, boundary.color);
  return map;
}

function stepMap(step: PresentationStep): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set(STEP_FIELDS.TITLE, yText(step.title));
  map.set(STEP_FIELDS.NOTES, yText(step.notes));
  map.set(STEP_FIELDS.ORDER, step.order);
  map.set(STEP_FIELDS.RECT, { ...step.rect });
  map.set(STEP_FIELDS.NODE_IDS, [...step.nodeIds]);
  map.set(STEP_FIELDS.EDGE_IDS, [...step.edgeIds]);
  return map;
}

/** Test/bootstrap hydration. Product mutations are introduced as commands in C06. */
export function hydrateGraphDocument(input: GraphProjection): Y.Doc {
  const graph = graphProjectionSchema.parse(input);
  const document = createGraphDocument();
  const roots = getGraphDocumentRoots(document);

  document.transact(() => {
    roots.meta.set(META_FIELDS.SCHEMA_VERSION, GRAPH_SCHEMA_VERSION);
    for (const node of graph.nodes) roots.nodes.set(node.id, nodeMap(node));
    for (const edge of graph.edges) roots.edges.set(edge.id, edgeMap(edge));
    for (const boundary of graph.boundaries)
      roots.boundaries.set(boundary.id, boundaryMap(boundary));
    for (const step of graph.steps) roots.steps.set(step.id, stepMap(step));
  });
  return document;
}
