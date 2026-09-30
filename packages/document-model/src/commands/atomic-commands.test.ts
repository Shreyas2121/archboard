import { MAX_GRAPH_COORDINATE } from '@archboard/contracts';
import {
  FIXED_IDS,
  FIXTURE_NAMESPACES,
  allEntityGraphFixture,
  createLimitGraphFixture,
  fixtureId,
  minimalGraphFixture,
} from '@archboard/fixtures';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { accessGraphText } from '../access/text.js';
import { projectGraphDocument } from '../projection/project.js';
import { getGraphDocumentRoots } from '../schema/document.js';
import { hydrateGraphDocument } from '../schema/hydrate.js';
import { createLocalUndoManager, stopLocalUndoCapture } from '../undo/undo.js';
import { editGraphText } from './text.js';
import * as physicalReads from '../validation/read.js';
import { restoreDeletedObjects } from './restore.js';
import {
  createGraphObjects,
  deleteGraphObjects,
  rectanglesIntersect,
  setGraphGeometry,
  setNodePositions,
} from './batch.js';
import { createEdge, replaceEdge } from './edges.js';
import { NODE_ALIGNMENTS, alignNodeGeometry, type NodeAlignment } from './nodes.js';

const encodedState = (document: Y.Doc): number[] => [...Y.encodeStateAsUpdate(document)];
const EXTERNAL_EDGE_ORDINAL = 99;
const FIRST_CREATED_ORDINAL = 101;
const SECOND_CREATED_ORDINAL = 102;
const MISSING_NODE_ORDINAL = 999;
const OVER_LIMIT_NODE_ORDINAL = 10_000;

describe('atomic editor commands', () => {
  it('reads one physical graph for bulk geometry and deletion prevalidation', () => {
    const document = hydrateGraphDocument(allEntityGraphFixture);
    const read = vi.spyOn(physicalReads, 'readPhysicalGraph');
    try {
      setGraphGeometry(document, {
        nodes: allEntityGraphFixture.nodes.map(({ id, position }) => ({ id, position })),
        boundaries: allEntityGraphFixture.boundaries.map(({ id, rect }) => ({ id, rect })),
      });
      expect(read).toHaveBeenCalledTimes(1);
      read.mockClear();
      alignNodeGeometry(
        document,
        allEntityGraphFixture.nodes.map(({ id }) => id),
        NODE_ALIGNMENTS.LEFT,
      );
      expect(read).toHaveBeenCalledTimes(1);
      read.mockClear();
      deleteGraphObjects(document, {
        nodeIds: allEntityGraphFixture.nodes.map(({ id }) => id),
        boundaryIds: allEntityGraphFixture.boundaries.map(({ id }) => id),
      });
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      read.mockRestore();
      document.destroy();
    }
  });
  it('uses positive-area intersection for selection rectangles', () => {
    const selection = { x: 0, y: 0, width: 100, height: 100 };
    expect(rectanglesIntersect(selection, { x: 20, y: 20, width: 30, height: 30 })).toBe(true);
    expect(rectanglesIntersect(selection, { x: 90, y: 90, width: 30, height: 30 })).toBe(true);
    expect(rectanglesIntersect(selection, { x: 120, y: 20, width: 30, height: 30 })).toBe(false);
    expect(rectanglesIntersect(selection, { x: 100, y: 20, width: 30, height: 30 })).toBe(false);
  });

  it('commits a multi-node drag as one local update', () => {
    const document = hydrateGraphDocument(minimalGraphFixture);
    const transactions = vi.fn();
    const updates = vi.fn();
    document.on('afterTransaction', transactions);
    document.on('update', updates);

    setNodePositions(document, [
      { id: FIXED_IDS.NODE_A, position: { x: 32, y: 48 } },
      { id: FIXED_IDS.NODE_B, position: { x: 432, y: 48 } },
    ]);

    expect(transactions).toHaveBeenCalledTimes(1);
    expect(updates).toHaveBeenCalledTimes(1);
    expect(projectGraphDocument(document).nodes.map(({ position }) => position)).toEqual([
      { x: 32, y: 48 },
      { x: 432, y: 48 },
    ]);
  });

  it('moves and resizes nodes and boundaries in absolute world coordinates atomically', () => {
    const document = hydrateGraphDocument(allEntityGraphFixture);
    const transactions = vi.fn();
    const updates = vi.fn();
    document.on('afterTransaction', transactions);
    document.on('update', updates);

    setGraphGeometry(document, {
      nodes: [
        {
          id: FIXED_IDS.NODE_A,
          position: { x: 120, y: 140 },
          size: { width: 320, height: 180 },
        },
      ],
      boundaries: [
        {
          id: FIXED_IDS.BOUNDARY_A,
          rect: { x: -40, y: -20, width: 720, height: 560 },
        },
      ],
    });

    const graph = projectGraphDocument(document);
    expect(transactions).toHaveBeenCalledTimes(1);
    expect(updates).toHaveBeenCalledTimes(1);
    expect(graph.nodes.find(({ id }) => id === FIXED_IDS.NODE_A)).toMatchObject({
      position: { x: 120, y: 140 },
      size: { width: 320, height: 180 },
    });
    expect(graph.boundaries[0]?.rect).toEqual({ x: -40, y: -20, width: 720, height: 560 });
  });

  it('leaves encoded document bytes unchanged when any geometry member is invalid', () => {
    const document = hydrateGraphDocument(allEntityGraphFixture);
    const before = encodedState(document);

    expect(() =>
      setGraphGeometry(document, {
        nodes: [
          { id: FIXED_IDS.NODE_A, position: { x: 10, y: 20 } },
          {
            id: FIXED_IDS.NODE_B,
            position: { x: MAX_GRAPH_COORDINATE + 1, y: 0 },
          },
        ],
        boundaries: [{ id: FIXED_IDS.BOUNDARY_A, rect: { x: 0, y: 0, width: 0, height: 100 } }],
      }),
    ).toThrow();
    expect(encodedState(document)).toEqual(before);
    expect(() =>
      setNodePositions(document, [
        { id: fixtureId(FIXTURE_NAMESPACES.NODE, MISSING_NODE_ORDINAL), position: { x: 0, y: 0 } },
      ]),
    ).toThrow(/does not exist/);
    expect(encodedState(document)).toEqual(before);
  });

  it('preflights IDs, references, geometry, and capacity before batch creation', () => {
    const document = hydrateGraphDocument(minimalGraphFixture);
    const before = encodedState(document);
    const freshNodeId = fixtureId(FIXTURE_NAMESPACES.NODE, FIRST_CREATED_ORDINAL);
    const duplicate = { ...minimalGraphFixture.nodes[0]!, id: freshNodeId };

    expect(() => createGraphObjects(document, { nodes: [duplicate, duplicate] })).toThrow(
      /duplicate/i,
    );
    expect(() =>
      createGraphObjects(document, {
        edges: [
          {
            ...minimalGraphFixture.edges[0]!,
            id: fixtureId(FIXTURE_NAMESPACES.EDGE, FIRST_CREATED_ORDINAL),
            targetId: fixtureId(FIXTURE_NAMESPACES.NODE, MISSING_NODE_ORDINAL),
          },
        ],
      }),
    ).toThrow(/outside the live batch/);
    expect(encodedState(document)).toEqual(before);

    const fullDocument = hydrateGraphDocument(createLimitGraphFixture());
    const fullBefore = encodedState(fullDocument);
    expect(() =>
      createGraphObjects(fullDocument, {
        nodes: [
          {
            ...minimalGraphFixture.nodes[0]!,
            id: fixtureId(FIXTURE_NAMESPACES.NODE, OVER_LIMIT_NODE_ORDINAL),
          },
        ],
      }),
    ).toThrow(/limit/);
    expect(encodedState(fullDocument)).toEqual(fullBefore);
  });

  it('creates a duplicate or paste batch in one structural transaction', () => {
    const document = hydrateGraphDocument(minimalGraphFixture);
    const nodeA = {
      ...minimalGraphFixture.nodes[0]!,
      id: fixtureId(FIXTURE_NAMESPACES.NODE, FIRST_CREATED_ORDINAL),
      position: { x: 32, y: 32 },
    };
    const nodeB = {
      ...minimalGraphFixture.nodes[1]!,
      id: fixtureId(FIXTURE_NAMESPACES.NODE, SECOND_CREATED_ORDINAL),
      position: { x: 432, y: 32 },
    };
    const edge = {
      ...minimalGraphFixture.edges[0]!,
      id: fixtureId(FIXTURE_NAMESPACES.EDGE, FIRST_CREATED_ORDINAL),
      sourceId: nodeA.id,
      targetId: nodeB.id,
    };
    const transactions = vi.fn();
    const updates = vi.fn();
    document.on('afterTransaction', transactions);
    document.on('update', updates);

    createGraphObjects(document, { nodes: [nodeA, nodeB], edges: [edge] });

    expect(transactions).toHaveBeenCalledTimes(1);
    expect(updates).toHaveBeenCalledTimes(1);
    expect(projectGraphDocument(document)).toMatchObject({
      nodes: expect.arrayContaining([expect.objectContaining({ id: nodeA.id })]),
      edges: expect.arrayContaining([expect.objectContaining({ id: edge.id })]),
    });
  });

  it('rejects self-loops, missing endpoints, and malformed handles before edge mutation', () => {
    const document = hydrateGraphDocument(minimalGraphFixture);
    const before = encodedState(document);
    const edge = {
      ...minimalGraphFixture.edges[0]!,
      id: fixtureId(FIXTURE_NAMESPACES.EDGE, FIRST_CREATED_ORDINAL),
    };

    expect(() => createEdge(document, { ...edge, targetId: edge.sourceId })).toThrow(/itself/);
    expect(() =>
      createEdge(document, {
        ...edge,
        targetId: fixtureId(FIXTURE_NAMESPACES.NODE, MISSING_NODE_ORDINAL),
      }),
    ).toThrow(/does not exist/);
    expect(() => createEdge(document, { ...edge, sourceHandle: 'diagonal' } as never)).toThrow();
    expect(() =>
      replaceEdge(document, minimalGraphFixture.edges[0]!.id, {
        ...edge,
        targetId: edge.sourceId,
      }),
    ).toThrow(/itself/);
    expect(encodedState(document)).toEqual(before);
  });

  it.each([
    [
      NODE_ALIGNMENTS.LEFT,
      [
        { x: 10, y: 20 },
        { x: 10, y: 180 },
      ],
    ],
    [
      NODE_ALIGNMENTS.HORIZONTAL_CENTER,
      [
        { x: 160, y: 20 },
        { x: 100, y: 180 },
      ],
    ],
    [
      NODE_ALIGNMENTS.RIGHT,
      [
        { x: 310, y: 20 },
        { x: 190, y: 180 },
      ],
    ],
    [
      NODE_ALIGNMENTS.TOP,
      [
        { x: 10, y: 20 },
        { x: 190, y: 20 },
      ],
    ],
    [
      NODE_ALIGNMENTS.VERTICAL_CENTER,
      [
        { x: 10, y: 140 },
        { x: 190, y: 100 },
      ],
    ],
    [
      NODE_ALIGNMENTS.BOTTOM,
      [
        { x: 10, y: 260 },
        { x: 190, y: 180 },
      ],
    ],
  ] as const)('aligns unequal node sizes with one %s transaction', (alignment, expected) => {
    const document = hydrateGraphDocument(minimalGraphFixture);
    setGraphGeometry(document, {
      nodes: [
        { id: FIXED_IDS.NODE_A, position: { x: 10, y: 20 }, size: { width: 200, height: 100 } },
        { id: FIXED_IDS.NODE_B, position: { x: 190, y: 180 }, size: { width: 320, height: 180 } },
      ],
    });
    let transactions = 0;
    document.on('afterTransaction', () => (transactions += 1));

    alignNodeGeometry(document, [FIXED_IDS.NODE_A, FIXED_IDS.NODE_B], alignment as NodeAlignment);

    expect(projectGraphDocument(document).nodes.map(({ position }) => position)).toEqual(expected);
    expect(transactions).toBe(1);
  });

  it('tracks geometry but excludes structural batches from local undo', () => {
    const document = hydrateGraphDocument(minimalGraphFixture);
    const undo = createLocalUndoManager(document);
    const createdNode = {
      ...minimalGraphFixture.nodes[0]!,
      id: fixtureId(FIXTURE_NAMESPACES.NODE, FIRST_CREATED_ORDINAL),
    };

    createGraphObjects(document, { nodes: [createdNode] });
    setNodePositions(document, [{ id: FIXED_IDS.NODE_A, position: { x: 64, y: 80 } }]);
    stopLocalUndoCapture(undo);
    undo.undo();

    const graph = projectGraphDocument(document);
    expect(graph.nodes.find(({ id }) => id === FIXED_IDS.NODE_A)?.position).toEqual({ x: 0, y: 0 });
    expect(graph.nodes.map(({ id }) => id)).toContain(createdNode.id);
  });

  it('captures and tombstones selected objects and internal edges but retains external edges', () => {
    const document = hydrateGraphDocument(allEntityGraphFixture);
    const externalEdge = {
      ...allEntityGraphFixture.edges[0]!,
      id: fixtureId(FIXTURE_NAMESPACES.EDGE, EXTERNAL_EDGE_ORDINAL),
      targetId: FIXED_IDS.NODE_C,
    };
    createEdge(document, externalEdge);
    const transactions = vi.fn();
    const updates = vi.fn();
    document.on('afterTransaction', transactions);
    document.on('update', updates);

    const capture = deleteGraphObjects(document, {
      nodeIds: [FIXED_IDS.NODE_A, FIXED_IDS.NODE_B],
      boundaryIds: [FIXED_IDS.BOUNDARY_A],
    });

    const roots = getGraphDocumentRoots(document);
    expect(transactions).toHaveBeenCalledTimes(1);
    expect(updates).toHaveBeenCalledTimes(1);
    expect(capture.edges.map(({ id }) => id)).toEqual([FIXED_IDS.EDGE_A]);
    expect(roots.deletedEdges.get(FIXED_IDS.EDGE_A)).toBe(true);
    expect(roots.deletedEdges.has(externalEdge.id)).toBe(false);
    expect(projectGraphDocument(document).edges.map(({ id }) => id)).toEqual([FIXED_IDS.EDGE_B]);

    let ordinal = 200;
    const restored = restoreDeletedObjects(document, capture, (kind) =>
      fixtureId(
        kind === 'node'
          ? FIXTURE_NAMESPACES.NODE
          : kind === 'edge'
            ? FIXTURE_NAMESPACES.EDGE
            : kind === 'boundary'
              ? FIXTURE_NAMESPACES.BOUNDARY
              : FIXTURE_NAMESPACES.STEP,
        ordinal++,
      ),
    );
    expect(restored.graph.edges[0]).toMatchObject({
      sourceId: restored.idMap.get(FIXED_IDS.NODE_A),
      targetId: restored.idMap.get(FIXED_IDS.NODE_B),
    });
    expect(roots.deletedNodes.get(FIXED_IDS.NODE_A)).toBe(true);
    expect(roots.deletedEdges.has(externalEdge.id)).toBe(false);
    expect(projectGraphDocument(document).edges.map(({ id }) => id)).not.toContain(externalEdge.id);
  });

  it('offers read-and-subscribe text access without exposing writable document roots', () => {
    const document = hydrateGraphDocument(minimalGraphFixture);
    const access = accessGraphText(document, {
      entity: 'node',
      id: FIXED_IDS.NODE_A,
      field: 'title',
    });
    const listener = vi.fn();
    const unsubscribe = access.subscribe(listener);

    editGraphText(
      document,
      { entity: 'node', id: FIXED_IDS.NODE_A, field: 'title' },
      { index: 0, deleteCount: 3, insert: 'Desktop' },
    );
    expect(access.value).toBe('Desktop application');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('rejects a restore with unresolved references without changing document bytes', () => {
    const document = hydrateGraphDocument(minimalGraphFixture);
    const before = encodedState(document);
    const capture = {
      ...minimalGraphFixture,
      nodes: [],
      edges: [
        {
          ...minimalGraphFixture.edges[0]!,
          id: fixtureId(FIXTURE_NAMESPACES.EDGE, FIRST_CREATED_ORDINAL),
          sourceId: fixtureId(FIXTURE_NAMESPACES.NODE, MISSING_NODE_ORDINAL),
        },
      ],
    };

    expect(() =>
      restoreDeletedObjects(document, capture, (kind) =>
        fixtureId(
          kind === 'edge' ? FIXTURE_NAMESPACES.EDGE : FIXTURE_NAMESPACES.NODE,
          SECOND_CREATED_ORDINAL,
        ),
      ),
    ).toThrow(/outside the live batch/);
    expect(encodedState(document)).toEqual(before);
  });
});
