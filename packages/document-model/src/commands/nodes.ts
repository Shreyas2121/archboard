import { graphNodeSchema, type ColorToken, type GraphNode, type Point } from '@archboard/contracts';
import type * as Y from 'yjs';

import { NODE_FIELDS } from '../schema/constants.js';
import { getGraphDocumentRoots } from '../schema/document.js';
import { setNodePositions } from './batch.js';
import { GraphCommandError } from './error.js';
import {
  LOCAL_EDIT_ORIGIN,
  LOCAL_STRUCTURAL_ORIGIN,
  assertFreshId,
  assertLiveCapacity,
  liveNode,
  nodeMap,
  parseNode,
  replaceText,
  requireText,
} from './internal.js';

type NodeSize = GraphNode['size'];
type ComponentNode = Extract<GraphNode, { kind: 'component' }>;
type CodeNode = Extract<GraphNode, { kind: 'code' }>;
type ComponentCategory = ComponentNode['content']['category'];
type CodeLanguage = CodeNode['content']['language'];
const MINIMUM_ALIGNMENT_NODES = 2;
const HALF = 2;

export function createNode(document: Y.Doc, input: GraphNode): void {
  const node = parseNode(input);
  assertFreshId(document, node.id);
  assertLiveCapacity(document, { nodes: 1 });
  document.transact(
    () => getGraphDocumentRoots(document).nodes.set(node.id, nodeMap(node)),
    LOCAL_STRUCTURAL_ORIGIN,
  );
}

function editNode(
  document: Y.Doc,
  id: string,
  mutateCandidate: (node: GraphNode) => GraphNode,
  apply: (map: Y.Map<unknown>) => void,
): void {
  const candidate = graphNodeSchema.parse(mutateCandidate(liveNode(document, id)));
  void candidate;
  const map = getGraphDocumentRoots(document).nodes.get(id) as Y.Map<unknown>;
  document.transact(() => apply(map), LOCAL_EDIT_ORIGIN);
}

function editTextField(
  document: Y.Doc,
  id: string,
  field: string,
  value: string,
  candidate: (node: GraphNode) => GraphNode,
): void {
  editNode(document, id, candidate, (map) =>
    replaceText(requireText(map.get(field), `Node ${id}`, field), value),
  );
}

export const setNodeTitle = (document: Y.Doc, id: string, title: string): void =>
  editTextField(document, id, NODE_FIELDS.TITLE, title, (node) => ({ ...node, title }));

export const moveNode = (document: Y.Doc, id: string, position: Point): void =>
  editNode(
    document,
    id,
    (node) => ({ ...node, position }),
    (map) => map.set(NODE_FIELDS.POSITION, { ...position }),
  );

export const resizeNode = (document: Y.Doc, id: string, size: NodeSize): void =>
  editNode(
    document,
    id,
    (node) => ({ ...node, size }),
    (map) => map.set(NODE_FIELDS.SIZE, { ...size }),
  );

export const setNodeColor = (document: Y.Doc, id: string, color: ColorToken): void =>
  editNode(
    document,
    id,
    (node) => ({ ...node, color }),
    (map) => map.set(NODE_FIELDS.COLOR, color),
  );

function requireKind<K extends GraphNode['kind']>(
  node: GraphNode,
  kind: K,
): Extract<GraphNode, { kind: K }> {
  if (node.kind !== kind) throw new GraphCommandError(`Node ${node.id} is not a ${kind} node.`);
  return node as Extract<GraphNode, { kind: K }>;
}

export const setComponentCategory = (
  document: Y.Doc,
  id: string,
  category: ComponentCategory,
): void =>
  editNode(
    document,
    id,
    (value) => {
      const node = requireKind(value, 'component');
      return { ...node, content: { ...node.content, category } };
    },
    (map) => map.set(NODE_FIELDS.CATEGORY, category),
  );

export const setComponentDescription = (document: Y.Doc, id: string, description: string): void =>
  editTextField(document, id, NODE_FIELDS.DESCRIPTION, description, (value) => {
    const node = requireKind(value, 'component');
    return { ...node, content: { ...node.content, description } };
  });

export const setComponentTechnology = (document: Y.Doc, id: string, technology: string): void =>
  editTextField(document, id, NODE_FIELDS.TECHNOLOGY, technology, (value) => {
    const node = requireKind(value, 'component');
    return { ...node, content: { ...node.content, technology } };
  });

export const setComponentExternalUrl = (
  document: Y.Doc,
  id: string,
  externalUrl: string | null,
): void =>
  editNode(
    document,
    id,
    (value) => {
      const node = requireKind(value, 'component');
      return { ...node, content: { ...node.content, externalUrl } };
    },
    (map) => map.set(NODE_FIELDS.EXTERNAL_URL, externalUrl),
  );

export const setCodeLanguage = (document: Y.Doc, id: string, language: CodeLanguage): void =>
  editNode(
    document,
    id,
    (value) => {
      const node = requireKind(value, 'code');
      return { ...node, content: { ...node.content, language } };
    },
    (map) => map.set(NODE_FIELDS.LANGUAGE, language),
  );

export const setNodeBody = (document: Y.Doc, id: string, body: string): void =>
  editTextField(document, id, NODE_FIELDS.BODY, body, (value) => {
    if (value.kind === 'component') {
      throw new GraphCommandError(`Component node ${id} does not have a body field.`);
    }
    if (value.kind === 'code') return { ...value, content: { ...value.content, body } };
    if (value.kind === 'schema') return { ...value, content: { body } };
    return { ...value, content: { body } };
  });

export function alignNodes(
  document: Y.Doc,
  nodeIds: readonly string[],
  axis: 'x' | 'y',
  coordinate: number,
): void {
  const uniqueIds = [...new Set(nodeIds)];
  const changes = uniqueIds.map((id) => {
    const node = liveNode(document, id);
    const position = { ...node.position, [axis]: coordinate };
    graphNodeSchema.parse({ ...node, position });
    return { id, position };
  });
  const roots = getGraphDocumentRoots(document);
  document.transact(() => {
    for (const { id, position } of changes) {
      (roots.nodes.get(id) as Y.Map<unknown>).set(NODE_FIELDS.POSITION, position);
    }
  }, LOCAL_EDIT_ORIGIN);
}

export const NODE_ALIGNMENTS = {
  LEFT: 'left',
  HORIZONTAL_CENTER: 'horizontal-center',
  RIGHT: 'right',
  TOP: 'top',
  VERTICAL_CENTER: 'vertical-center',
  BOTTOM: 'bottom',
} as const;

export type NodeAlignment = (typeof NODE_ALIGNMENTS)[keyof typeof NODE_ALIGNMENTS];

export function alignNodeGeometry(
  document: Y.Doc,
  nodeIds: readonly string[],
  alignment: NodeAlignment,
): void {
  const nodes = [...new Set(nodeIds)].map((id) => liveNode(document, id));
  if (nodes.length < MINIMUM_ALIGNMENT_NODES) {
    throw new GraphCommandError('Select at least two nodes to align.');
  }
  const left = Math.min(...nodes.map(({ position }) => position.x));
  const right = Math.max(...nodes.map(({ position, size }) => position.x + size.width));
  const top = Math.min(...nodes.map(({ position }) => position.y));
  const bottom = Math.max(...nodes.map(({ position, size }) => position.y + size.height));
  const horizontalCenter = (left + right) / HALF;
  const verticalCenter = (top + bottom) / HALF;
  const positions = nodes.map((node) => {
    switch (alignment) {
      case NODE_ALIGNMENTS.LEFT:
        return { id: node.id, position: { ...node.position, x: left } };
      case NODE_ALIGNMENTS.HORIZONTAL_CENTER:
        return {
          id: node.id,
          position: { ...node.position, x: horizontalCenter - node.size.width / HALF },
        };
      case NODE_ALIGNMENTS.RIGHT:
        return {
          id: node.id,
          position: { ...node.position, x: right - node.size.width },
        };
      case NODE_ALIGNMENTS.TOP:
        return { id: node.id, position: { ...node.position, y: top } };
      case NODE_ALIGNMENTS.VERTICAL_CENTER:
        return {
          id: node.id,
          position: { ...node.position, y: verticalCenter - node.size.height / HALF },
        };
      case NODE_ALIGNMENTS.BOTTOM:
        return {
          id: node.id,
          position: { ...node.position, y: bottom - node.size.height },
        };
    }
  });
  setNodePositions(document, positions);
}
