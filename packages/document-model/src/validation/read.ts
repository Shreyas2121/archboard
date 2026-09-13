import {
  ERROR_CODES,
  GRAPH_SCHEMA_VERSION,
  MAX_ENCODED_YJS_STATE_BYTES,
  NODE_KINDS,
  applicationIdSchema,
  boundarySchema,
  graphEdgeSchema,
  graphNodeSchema,
  presentationStepSchema,
  type Boundary,
  type GraphEdge,
  type GraphNode,
  type PresentationStep,
} from '@archboard/contracts';
import * as Y from 'yjs';

import {
  BOUNDARY_FIELDS,
  EDGE_FIELDS,
  META_FIELDS,
  NODE_FIELDS,
  STEP_FIELDS,
} from '../schema/constants.js';
import { getGraphDocumentRoots, type GraphDocumentRoots } from '../schema/document.js';
import { DocumentValidationError, type DocumentValidationIssue } from './error.js';

export interface PhysicalGraph {
  readonly roots: GraphDocumentRoots;
  readonly nodes: ReadonlyMap<string, GraphNode>;
  readonly edges: ReadonlyMap<string, GraphEdge>;
  readonly boundaries: ReadonlyMap<string, Boundary>;
  readonly steps: ReadonlyMap<string, PresentationStep>;
  readonly deletedNodes: ReadonlySet<string>;
  readonly deletedEdges: ReadonlySet<string>;
  readonly deletedBoundaries: ReadonlySet<string>;
  readonly deletedSteps: ReadonlySet<string>;
}

function invalid(path: readonly (string | number)[], message: string): never {
  throw new DocumentValidationError([{ path, message }]);
}

function assertExactKeys(
  map: Y.Map<unknown>,
  expected: readonly string[],
  path: readonly (string | number)[],
): void {
  const actual = [...map.keys()];
  const expectedSet = new Set(expected);
  const unexpected = actual.find((key) => !expectedSet.has(key));
  if (unexpected !== undefined)
    invalid([...path, unexpected], `Unexpected physical field "${unexpected}".`);
  const missing = expected.find((key) => !map.has(key));
  if (missing !== undefined)
    invalid([...path, missing], `Required physical field "${missing}" is missing.`);
}

function text(map: Y.Map<unknown>, key: string, path: readonly (string | number)[]): string {
  const value = map.get(key);
  if (!(value instanceof Y.Text))
    invalid([...path, key], `Physical field "${key}" must be Y.Text.`);
  return value.toString();
}

function atomic(map: Y.Map<unknown>, key: string, path: readonly (string | number)[]): unknown {
  const value = map.get(key);
  if (value instanceof Y.AbstractType) {
    invalid([...path, key], `Physical field "${key}" must be an atomic value.`);
  }
  return value;
}

interface ContractIssue {
  readonly code: string;
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

function contractFailure(
  issues: readonly ContractIssue[],
  prefix: readonly (string | number)[],
): never {
  const mapped: DocumentValidationIssue[] = issues.map((issue) => ({
    path: [
      ...prefix,
      ...issue.path.map((part) => (typeof part === 'number' ? part : String(part))),
    ],
    message: issue.message,
  }));
  const isLimit = issues.some((issue) => issue.code === 'too_big' || issue.code === 'too_small');
  throw new DocumentValidationError(
    mapped,
    isLimit ? ERROR_CODES.DOCUMENT_LIMIT : ERROR_CODES.DOCUMENT_INVALID,
  );
}

function validateId(id: string, path: readonly (string | number)[]): void {
  const result = applicationIdSchema.safeParse(id);
  if (!result.success) contractFailure(result.error.issues, path);
}

function readNode(id: string, map: Y.Map<unknown>, path: readonly (string | number)[]): GraphNode {
  const kind = atomic(map, NODE_FIELDS.KIND, path);
  const common = [
    NODE_FIELDS.KIND,
    NODE_FIELDS.POSITION,
    NODE_FIELDS.SIZE,
    NODE_FIELDS.TITLE,
    NODE_FIELDS.COLOR,
  ];
  let content: unknown;
  if (kind === NODE_KINDS.COMPONENT) {
    assertExactKeys(
      map,
      [
        ...common,
        NODE_FIELDS.CATEGORY,
        NODE_FIELDS.DESCRIPTION,
        NODE_FIELDS.TECHNOLOGY,
        NODE_FIELDS.EXTERNAL_URL,
      ],
      path,
    );
    content = {
      category: atomic(map, NODE_FIELDS.CATEGORY, path),
      description: text(map, NODE_FIELDS.DESCRIPTION, path),
      technology: text(map, NODE_FIELDS.TECHNOLOGY, path),
      externalUrl: atomic(map, NODE_FIELDS.EXTERNAL_URL, path),
    };
  } else if (kind === NODE_KINDS.CODE) {
    assertExactKeys(map, [...common, NODE_FIELDS.LANGUAGE, NODE_FIELDS.BODY], path);
    content = {
      language: atomic(map, NODE_FIELDS.LANGUAGE, path),
      body: text(map, NODE_FIELDS.BODY, path),
    };
  } else {
    assertExactKeys(map, [...common, NODE_FIELDS.BODY], path);
    content = { body: text(map, NODE_FIELDS.BODY, path) };
  }
  const candidate = {
    id,
    kind,
    position: atomic(map, NODE_FIELDS.POSITION, path),
    size: atomic(map, NODE_FIELDS.SIZE, path),
    title: text(map, NODE_FIELDS.TITLE, path),
    color: atomic(map, NODE_FIELDS.COLOR, path),
    content,
  };
  const result = graphNodeSchema.safeParse(candidate);
  if (!result.success) contractFailure(result.error.issues, path);
  return result.data;
}

function readEdge(id: string, map: Y.Map<unknown>, path: readonly (string | number)[]): GraphEdge {
  assertExactKeys(map, Object.values(EDGE_FIELDS), path);
  const candidate = {
    id,
    sourceId: atomic(map, EDGE_FIELDS.SOURCE_ID, path),
    targetId: atomic(map, EDGE_FIELDS.TARGET_ID, path),
    sourceHandle: atomic(map, EDGE_FIELDS.SOURCE_HANDLE, path),
    targetHandle: atomic(map, EDGE_FIELDS.TARGET_HANDLE, path),
    label: text(map, EDGE_FIELDS.LABEL, path),
    protocol: text(map, EDGE_FIELDS.PROTOCOL, path),
    direction: atomic(map, EDGE_FIELDS.DIRECTION, path),
    style: atomic(map, EDGE_FIELDS.STYLE, path),
  };
  const result = graphEdgeSchema.safeParse(candidate);
  if (!result.success) contractFailure(result.error.issues, path);
  return result.data;
}

function readBoundary(
  id: string,
  map: Y.Map<unknown>,
  path: readonly (string | number)[],
): Boundary {
  assertExactKeys(map, Object.values(BOUNDARY_FIELDS), path);
  const candidate = {
    id,
    title: text(map, BOUNDARY_FIELDS.TITLE, path),
    rect: atomic(map, BOUNDARY_FIELDS.RECT, path),
    color: atomic(map, BOUNDARY_FIELDS.COLOR, path),
  };
  const result = boundarySchema.safeParse(candidate);
  if (!result.success) contractFailure(result.error.issues, path);
  return result.data;
}

function readStep(
  id: string,
  map: Y.Map<unknown>,
  path: readonly (string | number)[],
): PresentationStep {
  assertExactKeys(map, Object.values(STEP_FIELDS), path);
  const nodeIds = atomic(map, STEP_FIELDS.NODE_IDS, path);
  const edgeIds = atomic(map, STEP_FIELDS.EDGE_IDS, path);
  if (!Array.isArray(nodeIds))
    invalid([...path, STEP_FIELDS.NODE_IDS], 'Step nodeIds must be an atomic array.');
  if (!Array.isArray(edgeIds))
    invalid([...path, STEP_FIELDS.EDGE_IDS], 'Step edgeIds must be an atomic array.');
  const candidate = {
    id,
    title: text(map, STEP_FIELDS.TITLE, path),
    notes: text(map, STEP_FIELDS.NOTES, path),
    order: atomic(map, STEP_FIELDS.ORDER, path),
    rect: atomic(map, STEP_FIELDS.RECT, path),
    nodeIds,
    edgeIds,
  };
  const result = presentationStepSchema.safeParse(candidate);
  if (!result.success) contractFailure(result.error.issues, path);
  return result.data;
}

function readEntities<T>(
  root: Y.Map<unknown>,
  rootName: string,
  reader: (id: string, map: Y.Map<unknown>, path: readonly (string | number)[]) => T,
): ReadonlyMap<string, T> {
  const entities = new Map<string, T>();
  for (const [id, value] of root.entries()) {
    const path = [rootName, id] as const;
    validateId(id, [rootName, id]);
    if (!(value instanceof Y.Map)) invalid(path, 'Every stored entity must be a nested Y.Map.');
    entities.set(id, reader(id, value, path));
  }
  return entities;
}

function readTombstones(root: Y.Map<unknown>, rootName: string): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const [id, value] of root.entries()) {
    validateId(id, [rootName, id]);
    if (value !== true) invalid([rootName, id], 'Every tombstone value must be literal true.');
    ids.add(id);
  }
  return ids;
}

export function readPhysicalGraph(document: Y.Doc): PhysicalGraph {
  const encodedBytes = Y.encodeStateAsUpdate(document).byteLength;
  if (encodedBytes > MAX_ENCODED_YJS_STATE_BYTES) {
    throw new DocumentValidationError(
      [{ path: [], message: `Encoded Yjs state exceeds ${MAX_ENCODED_YJS_STATE_BYTES} bytes.` }],
      ERROR_CODES.DOCUMENT_LIMIT,
    );
  }

  let roots: GraphDocumentRoots;
  try {
    roots = getGraphDocumentRoots(document);
  } catch {
    invalid([], 'Every fixed document root must be a Y.Map.');
  }
  assertExactKeys(roots.meta, [META_FIELDS.SCHEMA_VERSION], ['meta']);
  if (roots.meta.get(META_FIELDS.SCHEMA_VERSION) !== GRAPH_SCHEMA_VERSION) {
    invalid(['meta', META_FIELDS.SCHEMA_VERSION], `schemaVersion must be ${GRAPH_SCHEMA_VERSION}.`);
  }

  return {
    roots,
    nodes: readEntities(roots.nodes, 'nodes', readNode),
    edges: readEntities(roots.edges, 'edges', readEdge),
    boundaries: readEntities(roots.boundaries, 'boundaries', readBoundary),
    steps: readEntities(roots.steps, 'steps', readStep),
    deletedNodes: readTombstones(roots.deletedNodes, 'deletedNodes'),
    deletedEdges: readTombstones(roots.deletedEdges, 'deletedEdges'),
    deletedBoundaries: readTombstones(roots.deletedBoundaries, 'deletedBoundaries'),
    deletedSteps: readTombstones(roots.deletedSteps, 'deletedSteps'),
  };
}
