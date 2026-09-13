import { ERROR_CODES, MAX_NODE_TITLE_CHARACTERS, NODE_KINDS } from '@archboard/contracts';
import {
  FIXED_IDS,
  FIXTURE_NAMESPACES,
  createLimitGraphFixture,
  fixtureId,
  minimalGraphFixture,
} from '@archboard/fixtures';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { EDGE_FIELDS, NODE_FIELDS } from '../schema/constants.js';
import { createGraphDocument, getGraphDocumentRoots } from '../schema/document.js';
import { hydrateGraphDocument } from '../schema/hydrate.js';
import { DocumentValidationError } from './error.js';
import { validateGraphDocument } from './validate.js';

function cloneDocument(source: Y.Doc): Y.Doc {
  const clone = createGraphDocument();
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(source));
  return clone;
}

function expectInvalid(action: () => void, pathPart?: string): DocumentValidationError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(DocumentValidationError);
    const validationError = error as DocumentValidationError;
    expect(validationError.code).toBe(ERROR_CODES.DOCUMENT_INVALID);
    if (pathPart !== undefined) expect(validationError.issues[0]?.path).toContain(pathPart);
    return validationError;
  }
  throw new Error('Expected document validation to fail.');
}

describe('physical document validation', () => {
  it('rejects a fixed root with the wrong shared type', () => {
    const document = new Y.Doc();
    document.getArray('nodes');
    document.getMap('meta').set('schemaVersion', 1);
    expectInvalid(() => validateGraphDocument(document));
  });

  it('rejects scalar entities, invalid IDs, false tombstones, and non-Y.Text text', () => {
    const scalar = hydrateGraphDocument(minimalGraphFixture);
    getGraphDocumentRoots(scalar).nodes.set(FIXED_IDS.NODE_A, 'not-a-map');
    expectInvalid(() => validateGraphDocument(scalar), FIXED_IDS.NODE_A);

    const invalidId = hydrateGraphDocument(minimalGraphFixture);
    const roots = getGraphDocumentRoots(invalidId);
    const edgeTemplate = roots.edges.get(FIXED_IDS.EDGE_A) as Y.Map<unknown>;
    roots.edges.set('not-a-uuid', edgeTemplate.clone());
    expectInvalid(() => validateGraphDocument(invalidId), 'not-a-uuid');

    const falseTombstone = hydrateGraphDocument(minimalGraphFixture);
    getGraphDocumentRoots(falseTombstone).deletedNodes.set(FIXED_IDS.NODE_A, false);
    expectInvalid(() => validateGraphDocument(falseTombstone), FIXED_IDS.NODE_A);

    const scalarText = hydrateGraphDocument(minimalGraphFixture);
    const node = getGraphDocumentRoots(scalarText).nodes.get(FIXED_IDS.NODE_A) as Y.Map<unknown>;
    node.set(NODE_FIELDS.TITLE, 'not-ytext');
    expectInvalid(() => validateGraphDocument(scalarText), NODE_FIELDS.TITLE);
  });

  it('validates tombstoned values rather than only the visible projection', () => {
    const document = hydrateGraphDocument(minimalGraphFixture);
    const roots = getGraphDocumentRoots(document);
    roots.deletedNodes.set(FIXED_IDS.NODE_A, true);
    const node = roots.nodes.get(FIXED_IDS.NODE_A) as Y.Map<unknown>;
    node.set(NODE_FIELDS.KIND, 'unknown-kind');

    expectInvalid(() => validateGraphDocument(document), FIXED_IDS.NODE_A);

    const oversized = hydrateGraphDocument(minimalGraphFixture);
    const oversizedRoots = getGraphDocumentRoots(oversized);
    oversizedRoots.deletedNodes.set(FIXED_IDS.NODE_A, true);
    const title = (oversizedRoots.nodes.get(FIXED_IDS.NODE_A) as Y.Map<unknown>).get(
      NODE_FIELDS.TITLE,
    ) as Y.Text;
    title.insert(0, 'x'.repeat(MAX_NODE_TITLE_CHARACTERS));
    expect(() => validateGraphDocument(oversized)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.DOCUMENT_LIMIT }),
    );
  });

  it('rejects physical removal and mutation of immutable identity fields', () => {
    const accepted = hydrateGraphDocument(minimalGraphFixture);

    const removed = cloneDocument(accepted);
    getGraphDocumentRoots(removed).nodes.delete(FIXED_IDS.NODE_A);
    expectInvalid(() => validateGraphDocument(removed, accepted), FIXED_IDS.NODE_A);

    const changedKind = cloneDocument(accepted);
    const node = getGraphDocumentRoots(changedKind).nodes.get(FIXED_IDS.NODE_A) as Y.Map<unknown>;
    node.set(NODE_FIELDS.KIND, NODE_KINDS.NOTE);
    node.delete(NODE_FIELDS.CATEGORY);
    node.delete(NODE_FIELDS.DESCRIPTION);
    node.delete(NODE_FIELDS.TECHNOLOGY);
    node.delete(NODE_FIELDS.EXTERNAL_URL);
    node.set(NODE_FIELDS.BODY, new Y.Text('replacement'));
    expectInvalid(() => validateGraphDocument(changedKind, accepted), NODE_FIELDS.KIND);

    const changedEndpoint = cloneDocument(accepted);
    const edge = getGraphDocumentRoots(changedEndpoint).edges.get(
      FIXED_IDS.EDGE_A,
    ) as Y.Map<unknown>;
    edge.set(EDGE_FIELDS.TARGET_ID, FIXED_IDS.NODE_A);
    expectInvalid(() => validateGraphDocument(changedEndpoint, accepted), EDGE_FIELDS.TARGET_ID);
  });

  it('rejects removal of an accepted tombstone', () => {
    const accepted = hydrateGraphDocument(minimalGraphFixture);
    getGraphDocumentRoots(accepted).deletedEdges.set(FIXED_IDS.EDGE_A, true);
    const candidate = cloneDocument(accepted);
    getGraphDocumentRoots(candidate).deletedEdges.delete(FIXED_IDS.EDGE_A);

    expectInvalid(() => validateGraphDocument(candidate, accepted), FIXED_IDS.EDGE_A);
  });

  it('accepts the limit fixture and rejects one additional live entity', () => {
    const document = hydrateGraphDocument(createLimitGraphFixture());
    expect(() => validateGraphDocument(document)).not.toThrow();

    const nodes = getGraphDocumentRoots(document).nodes;
    const extraId = fixtureId(FIXTURE_NAMESPACES.NODE, nodes.size + 1);
    const template = nodes.get(FIXED_IDS.NODE_A) as Y.Map<unknown>;
    nodes.set(extraId, template.clone());
    expect(() => validateGraphDocument(document)).toThrowError(
      expect.objectContaining({ code: ERROR_CODES.DOCUMENT_LIMIT }),
    );
  });
});
