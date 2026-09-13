import {
  CODE_LANGUAGES,
  EDGE_DIRECTIONS,
  EDGE_STYLES,
  HANDLES,
  MAX_CLIENT_UPDATE_BYTES,
  MAX_ENCODED_YJS_STATE_BYTES,
  MAX_LIVE_BOUNDARIES,
  MAX_LIVE_EDGES,
  MAX_LIVE_NODES,
  MAX_LIVE_PRESENTATION_STEPS,
  MAX_WS_FRAME_BYTES,
  NODE_KINDS,
  applicationIdSchema,
  clientMessageSchema,
  graphProjectionSchema,
  serverMessageSchema,
} from '@archboard/contracts';
import { describe, expect, it } from 'vitest';

import { CONVERGENCE_SEEDS, concurrencyScenarios } from './concurrency/index.js';
import {
  LIMIT_GRAPH_COUNTS,
  TYPICAL_GRAPH_COUNTS,
  allEntityGraphFixture,
  buildGraphFixture,
  createLimitGraphFixture,
  createTypicalGraphFixture,
  minimalGraphFixture,
} from './graph/index.js';
import { FIXED_IDS } from './ids.js';
import {
  createInvalidContractFixtures,
  rawWebSocketFrameOverLimitFixture,
  zeroBytesAsCanonicalBase64,
} from './limits/index.js';
import { causalGapScenarios, malformedPhysicalScenarios } from './malformed/index.js';

const EXPECTED_MINIMAL_NODE_COUNT = 2;
const EXPECTED_MINIMAL_EDGE_COUNT = 1;
const EXPECTED_ALL_ENTITY_NODE_COUNT = 4;
const EXPECTED_ALL_ENTITY_EDGE_COUNT = 2;
const EXPECTED_ALL_ENTITY_STEP_COUNT = 2;
const EXPECTED_CONCURRENCY_SCENARIO_COUNT = 9;
const EXPECTED_MALFORMED_SCENARIO_COUNT = 8;
const EXPECTED_CAUSAL_GAP_SCENARIO_COUNT = 2;

describe('valid graph fixtures', () => {
  it.each([
    ['minimal', minimalGraphFixture],
    ['all-entity', allEntityGraphFixture],
    ['typical', createTypicalGraphFixture()],
    ['limit', createLimitGraphFixture()],
  ])('validates the %s graph through the shared contract', (_name, graph) => {
    expect(graphProjectionSchema.safeParse(graph).success).toBe(true);
  });

  it('keeps the minimal graph focused on two components and one connection', () => {
    expect(minimalGraphFixture.nodes).toHaveLength(EXPECTED_MINIMAL_NODE_COUNT);
    expect(minimalGraphFixture.nodes.every(({ kind }) => kind === NODE_KINDS.COMPONENT)).toBe(true);
    expect(minimalGraphFixture.edges).toHaveLength(EXPECTED_MINIMAL_EDGE_COUNT);
    expect(minimalGraphFixture.boundaries).toEqual([]);
    expect(minimalGraphFixture.steps).toEqual([]);
  });

  it('covers all node kinds, handles, edge styles, and directions', () => {
    expect(allEntityGraphFixture.nodes).toHaveLength(EXPECTED_ALL_ENTITY_NODE_COUNT);
    expect(new Set(allEntityGraphFixture.nodes.map(({ kind }) => kind))).toEqual(
      new Set(Object.values(NODE_KINDS)),
    );
    expect(allEntityGraphFixture.edges).toHaveLength(EXPECTED_ALL_ENTITY_EDGE_COUNT);
    expect(
      new Set(
        allEntityGraphFixture.edges.flatMap(({ sourceHandle, targetHandle }) => [
          sourceHandle,
          targetHandle,
        ]),
      ),
    ).toEqual(new Set(Object.values(HANDLES)));
    expect(new Set(allEntityGraphFixture.edges.map(({ style }) => style))).toEqual(
      new Set(Object.values(EDGE_STYLES)),
    );
    expect(new Set(allEntityGraphFixture.edges.map(({ direction }) => direction))).toEqual(
      new Set(Object.values(EDGE_DIRECTIONS)),
    );
    expect(allEntityGraphFixture.steps).toHaveLength(EXPECTED_ALL_ENTITY_STEP_COUNT);
  });

  it('builds deterministic typical-size data from named counts', () => {
    const first = createTypicalGraphFixture();
    const second = createTypicalGraphFixture();

    expect(first).toEqual(second);
    expect(first.nodes).toHaveLength(TYPICAL_GRAPH_COUNTS.nodeCount);
    expect(first.edges).toHaveLength(TYPICAL_GRAPH_COUNTS.edgeCount);
    expect(first.boundaries).toHaveLength(TYPICAL_GRAPH_COUNTS.boundaryCount);
    expect(first.steps).toHaveLength(TYPICAL_GRAPH_COUNTS.stepCount);
  });

  it('builds exact live-count limits and maximum valid content', () => {
    const graph = createLimitGraphFixture();

    expect(graph.nodes).toHaveLength(LIMIT_GRAPH_COUNTS.nodeCount);
    expect(graph.edges).toHaveLength(LIMIT_GRAPH_COUNTS.edgeCount);
    expect(graph.boundaries).toHaveLength(LIMIT_GRAPH_COUNTS.boundaryCount);
    expect(graph.steps).toHaveLength(LIMIT_GRAPH_COUNTS.stepCount);
    expect(LIMIT_GRAPH_COUNTS).toEqual({
      nodeCount: MAX_LIVE_NODES,
      edgeCount: MAX_LIVE_EDGES,
      boundaryCount: MAX_LIVE_BOUNDARIES,
      stepCount: MAX_LIVE_PRESENTATION_STEPS,
    });
    expect(graph.nodes.find(({ kind }) => kind === NODE_KINDS.CODE)?.content).toMatchObject({
      language: CODE_LANGUAGES.SHELL,
    });
  });

  it('rejects invalid builder counts before allocating fixtures', () => {
    expect(() =>
      buildGraphFixture({ nodeCount: -1, edgeCount: 0, boundaryCount: 0, stepCount: 0 }),
    ).toThrow('nodeCount');
    expect(() =>
      buildGraphFixture({ nodeCount: 0, edgeCount: 1, boundaryCount: 0, stepCount: 0 }),
    ).toThrow('at least one node');
  });
});

describe('invalid and one-over-limit fixtures', () => {
  it('fails every candidate through the intended shared-contract path', () => {
    const fixtures = createInvalidContractFixtures();

    for (const fixture of fixtures) {
      let result;
      try {
        result =
          fixture.schema === 'graph'
            ? graphProjectionSchema.safeParse(fixture.candidate)
            : fixture.schema === 'client-message'
              ? clientMessageSchema.safeParse(fixture.candidate)
              : serverMessageSchema.safeParse(fixture.candidate);
      } catch (error) {
        throw new Error(`${fixture.name} threw instead of returning validation issues.`, {
          cause: error,
        });
      }

      expect(result.success, fixture.name).toBe(false);
      if (!result.success) {
        expect(
          result.error.issues.some((issue) => issue.path.join('.') === fixture.expectedPath),
          `${fixture.name} should fail at ${fixture.expectedPath}`,
        ).toBe(true);
      }
    }
  });

  it('constructs canonical zero-byte payloads at exact and one-over limits', () => {
    for (const byteLength of [
      MAX_CLIENT_UPDATE_BYTES,
      MAX_CLIENT_UPDATE_BYTES + 1,
      MAX_ENCODED_YJS_STATE_BYTES,
      MAX_ENCODED_YJS_STATE_BYTES + 1,
    ]) {
      const encoded = zeroBytesAsCanonicalBase64(byteLength);
      expect(Buffer.from(encoded, 'base64').byteLength).toBe(byteLength);
    }
  });

  it('describes the raw frame boundary without allocating transport data', () => {
    expect(rawWebSocketFrameOverLimitFixture.maximumBytes).toBe(MAX_WS_FRAME_BYTES);
    expect(rawWebSocketFrameOverLimitFixture.byteLength).toBe(MAX_WS_FRAME_BYTES + 1);
  });
});

describe('future model scenario inputs', () => {
  it('uses fixed valid application UUIDs and deterministic convergence seeds', () => {
    for (const id of Object.values(FIXED_IDS)) {
      expect(applicationIdSchema.safeParse(id).success).toBe(true);
    }
    expect(new Set(CONVERGENCE_SEEDS).size).toBe(CONVERGENCE_SEEDS.length);
  });

  it('defines every required framework-neutral concurrency scenario', () => {
    expect(concurrencyScenarios).toHaveLength(EXPECTED_CONCURRENCY_SCENARIO_COUNT);
    expect(new Set(concurrencyScenarios.map(({ name }) => name)).size).toBe(
      concurrencyScenarios.length,
    );

    for (const scenario of concurrencyScenarios) {
      expect(graphProjectionSchema.safeParse(scenario.initialGraph).success, scenario.name).toBe(
        true,
      );
      expect(scenario.replicaA.length).toBeGreaterThan(0);
      expect(scenario.replicaB.length).toBeGreaterThan(0);
    }
  });

  it('describes malformed physical and causal-gap cases without importing Yjs', () => {
    expect(malformedPhysicalScenarios).toHaveLength(EXPECTED_MALFORMED_SCENARIO_COUNT);
    expect(causalGapScenarios).toHaveLength(EXPECTED_CAUSAL_GAP_SCENARIO_COUNT);
    expect(new Set(malformedPhysicalScenarios.map(({ name }) => name)).size).toBe(
      malformedPhysicalScenarios.length,
    );
    expect(new Set(causalGapScenarios.map(({ gapKind }) => gapKind))).toEqual(
      new Set(['structure', 'delete-set']),
    );
  });
});
