import {
  CODE_LANGUAGES,
  COLOR_TOKENS,
  COMPONENT_CATEGORIES,
  EDGE_DIRECTIONS,
  EDGE_STYLES,
} from '@archboard/contracts';
import {
  FIXED_IDS,
  FIXTURE_NAMESPACES,
  allEntityGraphFixture,
  fixtureId,
} from '@archboard/fixtures';
import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';

import { projectGraphDocument } from '../projection/project.js';
import { createGraphDocument, getGraphDocumentRoots } from '../schema/document.js';
import { hydrateGraphDocument } from '../schema/hydrate.js';
import { validateGraphDocument } from '../validation/validate.js';
import { editBoundary } from './boundaries.js';
import {
  tombstoneBoundary,
  tombstoneEdge,
  tombstoneNode,
  tombstonePresentationStep,
} from './deletion.js';
import { createEdge, editEdge, replaceEdge } from './edges.js';
import { GraphCommandError } from './error.js';
import {
  alignNodes,
  createNode,
  moveNode,
  resizeNode,
  setCodeLanguage,
  setComponentCategory,
  setComponentDescription,
  setComponentExternalUrl,
  setComponentTechnology,
  setNodeBody,
  setNodeColor,
  setNodeTitle,
} from './nodes.js';
import { restoreDeletedObjects } from './restore.js';
import { createBoundary } from './boundaries.js';
import { createPresentationStep, editPresentationStep, reorderPresentationSteps } from './steps.js';
import { editGraphText } from './text.js';

const REPLACEMENT_EDGE_ORDINAL = 100;
const REPLACEMENT_EDGE_ID = fixtureId(FIXTURE_NAMESPACES.EDGE, REPLACEMENT_EDGE_ORDINAL);
const RESTORE_OFFSET = 1_000;
const ALIGNED_Y = 50;
const EXPECTED_MULTI_OBJECT_TRANSACTIONS = 2;
const TITLE_EDIT_INDEX = 4;
const TITLE_EDIT_DELETE_COUNT = 11;

describe('graph commands', () => {
  it('creates every fully initialized entity in one transaction', () => {
    const document = createGraphDocument();
    let transactions = 0;
    document.on('afterTransaction', () => (transactions += 1));

    for (const node of allEntityGraphFixture.nodes) createNode(document, node);
    for (const edge of allEntityGraphFixture.edges) createEdge(document, edge);
    for (const boundary of allEntityGraphFixture.boundaries) createBoundary(document, boundary);
    for (const step of allEntityGraphFixture.steps) createPresentationStep(document, step);

    const entityCount =
      allEntityGraphFixture.nodes.length +
      allEntityGraphFixture.edges.length +
      allEntityGraphFixture.boundaries.length +
      allEntityGraphFixture.steps.length;
    expect(transactions).toBe(entityCount);
    expect(projectGraphDocument(document)).toEqual(allEntityGraphFixture);
    expect(() => validateGraphDocument(document)).not.toThrow();
  });

  it('edits every mutable field and applies multi-object operations atomically', () => {
    const document = hydrateGraphDocument(allEntityGraphFixture);
    setNodeTitle(document, FIXED_IDS.NODE_A, 'Client');
    moveNode(document, FIXED_IDS.NODE_A, { x: 10, y: 20 });
    resizeNode(document, FIXED_IDS.NODE_A, { width: 300, height: 200 });
    setNodeColor(document, FIXED_IDS.NODE_A, COLOR_TOKENS.RED);
    setComponentCategory(document, FIXED_IDS.NODE_A, COMPONENT_CATEGORIES.EXTERNAL);
    setComponentDescription(document, FIXED_IDS.NODE_A, 'External client');
    setComponentTechnology(document, FIXED_IDS.NODE_A, 'Browser');
    setComponentExternalUrl(document, FIXED_IDS.NODE_A, 'https://example.com/client');
    setCodeLanguage(document, FIXED_IDS.NODE_B, CODE_LANGUAGES.SQL);
    setNodeBody(document, FIXED_IDS.NODE_B, 'select 1');
    setNodeBody(document, FIXED_IDS.NODE_C, 'items(id)');
    setNodeBody(document, FIXED_IDS.NODE_D, 'Remember this.');
    editEdge(document, FIXED_IDS.EDGE_A, {
      label: 'Response',
      protocol: 'HTTP/2',
      direction: EDGE_DIRECTIONS.BIDIRECTIONAL,
      style: EDGE_STYLES.DASHED,
    });
    editBoundary(document, FIXED_IDS.BOUNDARY_A, {
      title: 'System',
      rect: { x: 0, y: 0, width: 900, height: 700 },
      color: COLOR_TOKENS.BLUE,
    });
    editPresentationStep(document, FIXED_IDS.STEP_A, {
      title: 'Updated request',
      notes: 'Updated notes',
      order: 5,
      rect: { x: 0, y: 0, width: 700, height: 300 },
      nodeIds: [FIXED_IDS.NODE_A],
      edgeIds: [],
    });

    let alignmentTransactions = 0;
    document.on('afterTransaction', () => (alignmentTransactions += 1));
    alignNodes(document, [FIXED_IDS.NODE_A, FIXED_IDS.NODE_B], 'y', ALIGNED_Y);
    reorderPresentationSteps(document, [
      { id: FIXED_IDS.STEP_A, order: 2 },
      { id: FIXED_IDS.STEP_B, order: 1 },
    ]);
    expect(alignmentTransactions).toBe(EXPECTED_MULTI_OBJECT_TRANSACTIONS);

    const graph = projectGraphDocument(document);
    expect(graph.nodes.find(({ id }) => id === FIXED_IDS.NODE_A)).toMatchObject({
      title: 'Client',
      position: { x: 10, y: ALIGNED_Y },
      size: { width: 300, height: 200 },
      color: COLOR_TOKENS.RED,
      content: {
        category: COMPONENT_CATEGORIES.EXTERNAL,
        description: 'External client',
        technology: 'Browser',
        externalUrl: 'https://example.com/client',
      },
    });
    expect(graph.nodes.find(({ id }) => id === FIXED_IDS.NODE_B)).toMatchObject({
      position: { x: 400, y: ALIGNED_Y },
      content: { language: CODE_LANGUAGES.SQL, body: 'select 1' },
    });
    expect(graph.edges[0]).toMatchObject({ label: 'Response', protocol: 'HTTP/2' });
    expect(graph.steps.map(({ id }) => id)).toEqual([FIXED_IDS.STEP_B, FIXED_IDS.STEP_A]);
    expect(() => validateGraphDocument(document)).not.toThrow();
  });

  it('reconnects by tombstoning an edge and creating a fresh replacement', () => {
    const document = hydrateGraphDocument(allEntityGraphFixture);
    replaceEdge(document, FIXED_IDS.EDGE_A, {
      ...allEntityGraphFixture.edges[0]!,
      id: REPLACEMENT_EDGE_ID,
      sourceId: FIXED_IDS.NODE_B,
      targetId: FIXED_IDS.NODE_A,
    });

    const roots = getGraphDocumentRoots(document);
    expect(roots.deletedEdges.get(FIXED_IDS.EDGE_A)).toBe(true);
    expect(roots.edges.has(FIXED_IDS.EDGE_A)).toBe(true);
    expect(projectGraphDocument(document).edges.map(({ id }) => id)).toContain(REPLACEMENT_EDGE_ID);
  });

  it('applies collaborative text edits incrementally without replacing the Y.Text', () => {
    const document = hydrateGraphDocument(allEntityGraphFixture);
    const nodeMap = getGraphDocumentRoots(document).nodes.get(FIXED_IDS.NODE_A) as Y.Map<unknown>;
    const title = nodeMap.get('title');
    editGraphText(
      document,
      { entity: 'node', id: FIXED_IDS.NODE_A, field: 'title' },
      { index: TITLE_EDIT_INDEX, deleteCount: TITLE_EDIT_DELETE_COUNT, insert: 'client' },
    );

    expect(nodeMap.get('title')).toBe(title);
    expect(projectGraphDocument(document).nodes[0]?.title).toBe('Web client');
  });

  it('uses append-only tombstones and rejects edits or ID reuse after deletion', () => {
    const document = hydrateGraphDocument(allEntityGraphFixture);
    tombstoneNode(document, FIXED_IDS.NODE_A);
    tombstoneEdge(document, FIXED_IDS.EDGE_B);
    tombstoneBoundary(document, FIXED_IDS.BOUNDARY_A);
    tombstonePresentationStep(document, FIXED_IDS.STEP_A);
    tombstoneNode(document, FIXED_IDS.NODE_A);

    const roots = getGraphDocumentRoots(document);
    expect(roots.nodes.has(FIXED_IDS.NODE_A)).toBe(true);
    expect(roots.deletedNodes.get(FIXED_IDS.NODE_A)).toBe(true);
    expect(() => setNodeTitle(document, FIXED_IDS.NODE_A, 'Resurrected')).toThrow(
      GraphCommandError,
    );
    expect(() => createNode(document, allEntityGraphFixture.nodes[0]!)).toThrow(GraphCommandError);
    expect(projectGraphDocument(document)).toMatchObject({ boundaries: [] });
  });

  it('rejects invalid values and immutable edge fields before mutating the document', () => {
    const document = hydrateGraphDocument(allEntityGraphFixture);
    const before = projectGraphDocument(document);
    expect(() => moveNode(document, FIXED_IDS.NODE_A, { x: Number.NaN, y: 0 })).toThrow();
    expect(() =>
      editEdge(document, FIXED_IDS.EDGE_A, {
        sourceId: FIXED_IDS.NODE_D,
      } as never),
    ).toThrow(/immutable/);
    expect(projectGraphDocument(document)).toEqual(before);
  });

  it('restores captures with fresh IDs, remaps internal edges, and retains tombstones', () => {
    const document = hydrateGraphDocument(allEntityGraphFixture);
    for (const node of allEntityGraphFixture.nodes) tombstoneNode(document, node.id);
    for (const edge of allEntityGraphFixture.edges) tombstoneEdge(document, edge.id);
    for (const boundary of allEntityGraphFixture.boundaries)
      tombstoneBoundary(document, boundary.id);
    for (const step of allEntityGraphFixture.steps) tombstonePresentationStep(document, step.id);

    let ordinal = RESTORE_OFFSET;
    const restored = restoreDeletedObjects(document, allEntityGraphFixture, (kind) => {
      const namespace =
        kind === 'node'
          ? FIXTURE_NAMESPACES.NODE
          : kind === 'edge'
            ? FIXTURE_NAMESPACES.EDGE
            : kind === 'boundary'
              ? FIXTURE_NAMESPACES.BOUNDARY
              : FIXTURE_NAMESPACES.STEP;
      return fixtureId(namespace, ordinal++);
    });

    expect(
      restored.graph.nodes.every(
        ({ id }) => !allEntityGraphFixture.nodes.some((node) => node.id === id),
      ),
    ).toBe(true);
    expect(restored.graph.edges[0]?.sourceId).toBe(restored.idMap.get(FIXED_IDS.NODE_A));
    expect(restored.graph.steps[0]?.edgeIds).toEqual([restored.idMap.get(FIXED_IDS.EDGE_A)]);
    expect(getGraphDocumentRoots(document).deletedNodes.get(FIXED_IDS.NODE_A)).toBe(true);
    expect(projectGraphDocument(document)).toEqual(restored.graph);
  });
});
