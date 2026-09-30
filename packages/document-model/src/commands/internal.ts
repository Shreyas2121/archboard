import {
  boundarySchema,
  graphEdgeSchema,
  graphNodeSchema,
  MAX_LIVE_BOUNDARIES,
  MAX_LIVE_EDGES,
  MAX_LIVE_NODES,
  MAX_LIVE_PRESENTATION_STEPS,
  presentationStepSchema,
  type Boundary,
  type GraphEdge,
  type GraphNode,
  type PresentationStep,
} from '@archboard/contracts';
import * as Y from 'yjs';

import { BOUNDARY_FIELDS, EDGE_FIELDS, NODE_FIELDS, STEP_FIELDS } from '../schema/constants.js';
import { getGraphDocumentRoots } from '../schema/document.js';
import { readPhysicalGraph, type PhysicalGraph } from '../validation/read.js';
import { GraphCommandError } from './error.js';

export const LOCAL_EDIT_ORIGIN = Symbol('archboard.local-edit');
export const LOCAL_STRUCTURAL_ORIGIN = Symbol('archboard.local-structural');

export function yText(value: string): Y.Text {
  const text = new Y.Text();
  text.insert(0, value);
  return text;
}

export function nodeMap(node: GraphNode): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set(NODE_FIELDS.KIND, node.kind);
  map.set(NODE_FIELDS.POSITION, { ...node.position });
  map.set(NODE_FIELDS.SIZE, { ...node.size });
  map.set(NODE_FIELDS.TITLE, yText(node.title));
  map.set(NODE_FIELDS.COLOR, node.color);
  if (node.kind === 'component') {
    map.set(NODE_FIELDS.CATEGORY, node.content.category);
    map.set(NODE_FIELDS.DESCRIPTION, yText(node.content.description));
    map.set(NODE_FIELDS.TECHNOLOGY, yText(node.content.technology));
    map.set(NODE_FIELDS.EXTERNAL_URL, node.content.externalUrl);
  } else if (node.kind === 'code') {
    map.set(NODE_FIELDS.LANGUAGE, node.content.language);
    map.set(NODE_FIELDS.BODY, yText(node.content.body));
  } else {
    map.set(NODE_FIELDS.BODY, yText(node.content.body));
  }
  return map;
}

export function edgeMap(edge: GraphEdge): Y.Map<unknown> {
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

export function boundaryMap(boundary: Boundary): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set(BOUNDARY_FIELDS.TITLE, yText(boundary.title));
  map.set(BOUNDARY_FIELDS.RECT, { ...boundary.rect });
  map.set(BOUNDARY_FIELDS.COLOR, boundary.color);
  return map;
}

export function stepMap(step: PresentationStep): Y.Map<unknown> {
  const map = new Y.Map<unknown>();
  map.set(STEP_FIELDS.TITLE, yText(step.title));
  map.set(STEP_FIELDS.NOTES, yText(step.notes));
  map.set(STEP_FIELDS.ORDER, step.order);
  map.set(STEP_FIELDS.RECT, { ...step.rect });
  map.set(STEP_FIELDS.NODE_IDS, [...step.nodeIds]);
  map.set(STEP_FIELDS.EDGE_IDS, [...step.edgeIds]);
  return map;
}

export function assertFreshId(document: Y.Doc, id: string): void {
  const roots = getGraphDocumentRoots(document);
  const entityRoots = [roots.nodes, roots.edges, roots.boundaries, roots.steps];
  const tombstoneRoots = [
    roots.deletedNodes,
    roots.deletedEdges,
    roots.deletedBoundaries,
    roots.deletedSteps,
  ];
  if ([...entityRoots, ...tombstoneRoots].some((root) => root.has(id))) {
    throw new GraphCommandError(`Entity ID ${id} has already been used.`);
  }
}

export interface EntityCountIncrease {
  readonly nodes?: number;
  readonly edges?: number;
  readonly boundaries?: number;
  readonly steps?: number;
}

export function assertLiveCapacity(
  document: Y.Doc,
  increase: EntityCountIncrease,
  graph: PhysicalGraph = readPhysicalGraph(document),
): void {
  const liveCount = <T>(entities: ReadonlyMap<string, T>, deleted: ReadonlySet<string>): number =>
    [...entities.keys()].filter((id) => !deleted.has(id)).length;
  const checks = [
    ['nodes', liveCount(graph.nodes, graph.deletedNodes), increase.nodes ?? 0, MAX_LIVE_NODES],
    ['edges', liveCount(graph.edges, graph.deletedEdges), increase.edges ?? 0, MAX_LIVE_EDGES],
    [
      'boundaries',
      liveCount(graph.boundaries, graph.deletedBoundaries),
      increase.boundaries ?? 0,
      MAX_LIVE_BOUNDARIES,
    ],
    [
      'steps',
      liveCount(graph.steps, graph.deletedSteps),
      increase.steps ?? 0,
      MAX_LIVE_PRESENTATION_STEPS,
    ],
  ] as const;
  for (const [kind, current, added, maximum] of checks) {
    if (current + added > maximum)
      throw new GraphCommandError(`Creating ${kind} would exceed the live entity limit.`);
  }
}

export function liveNode(
  document: Y.Doc,
  id: string,
  graph: PhysicalGraph = readPhysicalGraph(document),
): GraphNode {
  const node = graph.nodes.get(id);
  if (node === undefined) throw new GraphCommandError(`Node ${id} does not exist.`);
  if (graph.deletedNodes.has(id)) throw new GraphCommandError(`Node ${id} is deleted.`);
  return node;
}

export function liveEdge(document: Y.Doc, id: string): GraphEdge {
  const graph = readPhysicalGraph(document);
  const edge = graph.edges.get(id);
  if (edge === undefined) throw new GraphCommandError(`Edge ${id} does not exist.`);
  if (graph.deletedEdges.has(id)) throw new GraphCommandError(`Edge ${id} is deleted.`);
  return edge;
}

export function liveBoundary(
  document: Y.Doc,
  id: string,
  graph: PhysicalGraph = readPhysicalGraph(document),
): Boundary {
  const boundary = graph.boundaries.get(id);
  if (boundary === undefined) throw new GraphCommandError(`Boundary ${id} does not exist.`);
  if (graph.deletedBoundaries.has(id)) throw new GraphCommandError(`Boundary ${id} is deleted.`);
  return boundary;
}

export function liveStep(document: Y.Doc, id: string): PresentationStep {
  const graph = readPhysicalGraph(document);
  const step = graph.steps.get(id);
  if (step === undefined) throw new GraphCommandError(`Step ${id} does not exist.`);
  if (graph.deletedSteps.has(id)) throw new GraphCommandError(`Step ${id} is deleted.`);
  return step;
}

export const parseNode = (node: GraphNode): GraphNode => graphNodeSchema.parse(node);
export const parseEdge = (edge: GraphEdge): GraphEdge => graphEdgeSchema.parse(edge);
export const parseBoundary = (boundary: Boundary): Boundary => boundarySchema.parse(boundary);
export const parseStep = (step: PresentationStep): PresentationStep =>
  presentationStepSchema.parse(step);

export function replaceText(text: Y.Text, value: string): void {
  if (text.length > 0) text.delete(0, text.length);
  if (value.length > 0) text.insert(0, value);
}

export function requireText(value: unknown, entity: string, field: string): Y.Text {
  if (!(value instanceof Y.Text)) {
    throw new GraphCommandError(`${entity} field ${field} is not collaborative text.`);
  }
  return value;
}
