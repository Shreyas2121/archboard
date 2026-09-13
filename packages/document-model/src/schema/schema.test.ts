import { GRAPH_SCHEMA_VERSION, NODE_KINDS } from '@archboard/contracts';
import { allEntityGraphFixture, FIXED_IDS } from '@archboard/fixtures';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { NODE_FIELDS, STEP_FIELDS } from './constants.js';
import { createGraphDocument, getGraphDocumentRoots } from './document.js';
import { hydrateGraphDocument } from './hydrate.js';

describe('fixed Yjs schema', () => {
  it('creates all fixed roots as Y.Map with graph-only metadata', () => {
    const roots = getGraphDocumentRoots(createGraphDocument());

    for (const root of Object.values(roots)) expect(root).toBeInstanceOf(Y.Map);
    expect(roots.meta.toJSON()).toEqual({ schemaVersion: GRAPH_SCHEMA_VERSION });
  });

  it('stores IDs as keys, text as Y.Text, and geometry and references atomically', () => {
    const roots = getGraphDocumentRoots(hydrateGraphDocument(allEntityGraphFixture));
    const component = roots.nodes.get(FIXED_IDS.NODE_A);
    const code = roots.nodes.get(FIXED_IDS.NODE_B);
    const step = roots.steps.get(FIXED_IDS.STEP_A);

    expect(component).toBeInstanceOf(Y.Map);
    expect(code).toBeInstanceOf(Y.Map);
    expect(step).toBeInstanceOf(Y.Map);
    const componentMap = component as Y.Map<unknown>;
    const codeMap = code as Y.Map<unknown>;
    const stepMap = step as Y.Map<unknown>;
    expect(componentMap.has('id')).toBe(false);
    expect(componentMap.get(NODE_FIELDS.TITLE)).toBeInstanceOf(Y.Text);
    expect(componentMap.get(NODE_FIELDS.DESCRIPTION)).toBeInstanceOf(Y.Text);
    expect(componentMap.get(NODE_FIELDS.TECHNOLOGY)).toBeInstanceOf(Y.Text);
    expect(codeMap.get(NODE_FIELDS.BODY)).toBeInstanceOf(Y.Text);
    expect(componentMap.get(NODE_FIELDS.POSITION)).toEqual(
      allEntityGraphFixture.nodes[0]!.position,
    );
    expect(componentMap.get(NODE_FIELDS.POSITION)).not.toBeInstanceOf(Y.AbstractType);
    expect(stepMap.get(STEP_FIELDS.NODE_IDS)).toEqual(allEntityGraphFixture.steps[0]!.nodeIds);
    expect(stepMap.get(STEP_FIELDS.NODE_IDS)).not.toBeInstanceOf(Y.Array);
    expect(componentMap.get(NODE_FIELDS.KIND)).toBe(NODE_KINDS.COMPONENT);
  });
});
