import { EDGE_DIRECTIONS, EDGE_STYLES, HANDLES, type GraphProjection } from '@archboard/contracts';
import {
  CONVERGENCE_SEEDS,
  FIXED_IDS,
  concurrencyScenarios,
  type ConcurrencyScenario,
  type FixtureOperation,
} from '@archboard/fixtures';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { tombstoneNode } from '../commands/deletion.js';
import { createEdge } from '../commands/edges.js';
import { createNode, moveNode, resizeNode, setNodeTitle } from '../commands/nodes.js';
import { editPresentationStep } from '../commands/steps.js';
import { editGraphText } from '../commands/text.js';
import { projectGraphDocument } from '../projection/project.js';
import { hydrateGraphDocument } from '../schema/hydrate.js';
import { applyHydrationUpdate, applyRemoteUpdate } from '../undo/origins.js';
import { createLocalUndoManager } from '../undo/undo.js';

const RANDOMIZED_DELIVERIES_PER_SEED = 12;
const RANDOMIZED_RECEIVER_COUNT = 3;
const CONVERGENCE_TEST_BUDGET_MS = 10_000;
const CONVERGENCE_TEST_TIMEOUT_MS = 15_000;
const UINT32_RANGE = 0x1_0000_0000;
const PRNG_MULTIPLIER = 1_664_525;
const PRNG_INCREMENT = 1_013_904_223;
const RECEIVER_SEED_STRIDE = 997;
const RUN_SEED_STRIDE = 7_919;

interface ReplicaHarness {
  readonly document: Y.Doc;
  readonly updates: Uint8Array[];
  readonly undo: Y.UndoManager;
}

function scenario(name: string): ConcurrencyScenario {
  const value = concurrencyScenarios.find((candidate) => candidate.name === name);
  if (value === undefined) throw new Error(`Missing concurrency scenario ${name}.`);
  return value;
}

function baselineUpdate(graph: GraphProjection): Uint8Array {
  return Y.encodeStateAsUpdate(hydrateGraphDocument(graph));
}

function createReplica(baseline: Uint8Array): ReplicaHarness {
  const document = new Y.Doc();
  applyHydrationUpdate(document, baseline);
  const updates: Uint8Array[] = [];
  document.on('update', (update, origin) => {
    if (origin !== undefined) updates.push(new Uint8Array(update));
  });
  return { document, updates, undo: createLocalUndoManager(document) };
}

function applyOperation(replica: ReplicaHarness, operation: FixtureOperation): void {
  switch (operation.type) {
    case 'set-node-title':
      setNodeTitle(replica.document, operation.nodeId, operation.title);
      break;
    case 'move-node':
      moveNode(replica.document, operation.nodeId, operation.position);
      break;
    case 'resize-node':
      resizeNode(replica.document, operation.nodeId, {
        width: operation.width,
        height: operation.height,
      });
      break;
    case 'insert-node-text':
      editGraphText(
        replica.document,
        { entity: 'node', id: operation.nodeId, field: operation.field },
        { index: operation.index, deleteCount: 0, insert: operation.text },
      );
      break;
    case 'tombstone-node':
      tombstoneNode(replica.document, operation.nodeId);
      break;
    case 'create-node':
      createNode(replica.document, operation.node);
      break;
    case 'create-edge':
      createEdge(replica.document, {
        id: operation.edgeId,
        sourceId: operation.sourceId,
        targetId: operation.targetId,
        sourceHandle: HANDLES.RIGHT,
        targetHandle: HANDLES.LEFT,
        label: 'Concurrent edge',
        protocol: 'HTTPS',
        direction: EDGE_DIRECTIONS.FORWARD,
        style: EDGE_STYLES.SOLID,
      });
      break;
    case 'set-step-order':
      editPresentationStep(replica.document, operation.stepId, { order: operation.order });
      break;
    case 'undo-last-local':
      replica.undo.undo();
      break;
  }
}

function applyOperations(replica: ReplicaHarness, operations: readonly FixtureOperation[]): void {
  for (const operation of operations) applyOperation(replica, operation);
}

function synchronize(replicas: readonly ReplicaHarness[]): GraphProjection[] {
  const updates = replicas.flatMap((replica) => replica.updates);
  for (const replica of replicas) {
    for (const update of updates) applyRemoteUpdate(replica.document, update);
  }
  return replicas.map((replica) => projectGraphDocument(replica.document));
}

function executeScenario(input: ConcurrencyScenario): GraphProjection[] {
  const baseline = baselineUpdate(input.initialGraph);
  const replicaA = createReplica(baseline);
  const replicaB = createReplica(baseline);
  applyOperations(replicaA, input.replicaA);
  applyOperations(replicaB, input.replicaB);
  return synchronize([replicaA, replicaB]);
}

function expectConverged(projections: readonly GraphProjection[]): void {
  expect(projections.length).toBeGreaterThan(1);
  for (const projection of projections.slice(1)) expect(projection).toEqual(projections[0]);
}

function node(projection: GraphProjection, id: string) {
  const value = projection.nodes.find((candidate) => candidate.id === id);
  if (value === undefined) throw new Error(`Projected node ${id} is missing.`);
  return value;
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, PRNG_MULTIPLIER) + PRNG_INCREMENT) >>> 0;
    return state / UINT32_RANGE;
  };
}

function shuffledWithDuplicates(updates: readonly Uint8Array[], seed: number): Uint8Array[] {
  const shuffled = updates.flatMap((update) => [update, update]);
  const next = random(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(next() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other]!, shuffled[index]!];
  }
  return shuffled;
}

describe('independent Yjs replica convergence', () => {
  it('proves A02: concurrent rename and move both survive', () => {
    const projections = executeScenario(scenario('concurrent-rename-and-move'));
    expectConverged(projections);
    expect(node(projections[0]!, FIXED_IDS.NODE_A)).toMatchObject({
      title: 'Renamed by A',
      position: { x: 80, y: 40 },
    });
  });

  it('proves A03: concurrent Y.Text inserts converge without whole-field loss', () => {
    const projections = executeScenario(scenario('concurrent-text-inserts'));
    expectConverged(projections);
    const result = node(projections[0]!, FIXED_IDS.NODE_D);
    if (result.kind !== 'note') throw new Error('Text scenario must target a note node.');
    expect(result.content.body).toContain('A');
    expect(result.content.body).toContain('B');
    expect(result.content.body).toContain('Commit before ACK.');
  });

  it('proves A04: concurrent moves converge without choosing a wall-clock winner', () => {
    const input = scenario('concurrent-moves');
    const projections = executeScenario(input);
    expectConverged(projections);
    const position = node(projections[0]!, FIXED_IDS.NODE_A).position;
    const proposedPositions = [
      (input.replicaA[0] as Extract<FixtureOperation, { type: 'move-node' }>).position,
      (input.replicaB[0] as Extract<FixtureOperation, { type: 'move-node' }>).position,
    ];
    expect(proposedPositions).toContainEqual(position);
  });

  it('proves A05: tombstones win over edits and incident-edge creation', () => {
    const deleteEdit = executeScenario(scenario('delete-versus-edit'));
    const deleteEdge = executeScenario(scenario('delete-node-versus-incident-edge'));
    expectConverged(deleteEdit);
    expectConverged(deleteEdge);
    for (const projection of [...deleteEdit, ...deleteEdge]) {
      expect(projection.nodes.some(({ id }) => id === FIXED_IDS.NODE_A)).toBe(false);
      expect(
        projection.edges.some(
          ({ sourceId, targetId }) =>
            sourceId === FIXED_IDS.NODE_A || targetId === FIXED_IDS.NODE_A,
        ),
      ).toBe(false);
    }
  });

  it.each(['move-and-resize', 'concurrent-object-creation', 'concurrent-step-reordering'] as const)(
    'converges for %s',
    (name) => {
      const projections = executeScenario(scenario(name));
      expectConverged(projections);
      if (name === 'move-and-resize') {
        expect(node(projections[0]!, FIXED_IDS.NODE_A)).toMatchObject({
          position: { x: 50, y: 75 },
          size: { width: 360, height: 220 },
        });
      } else if (name === 'concurrent-object-creation') {
        expect(projections[0]!.nodes).toHaveLength(
          scenario(name).initialGraph.nodes.length +
            scenario(name).replicaA.length +
            scenario(name).replicaB.length,
        );
      } else {
        expect(projections[0]!.steps.map(({ id }) => id)).toEqual([
          FIXED_IDS.STEP_B,
          FIXED_IDS.STEP_A,
        ]);
      }
    },
  );

  it('proves A13: undo after a remote edit preserves the remote contribution', () => {
    const input = scenario('local-undo-after-remote-edit');
    const baseline = baselineUpdate(input.initialGraph);
    const local = createReplica(baseline);
    const remote = createReplica(baseline);
    applyOperation(local, input.replicaA[0]!);
    applyOperations(remote, input.replicaB);
    for (const update of remote.updates) applyRemoteUpdate(local.document, update);
    applyOperation(local, input.replicaA[1]!);

    const projections = synchronize([local, remote]);
    expectConverged(projections);
    expect(node(projections[0]!, FIXED_IDS.NODE_A)).toMatchObject({
      title: 'Web application',
      position: { x: 700, y: 400 },
    });
  });

  it(
    'converges under seeded reordered and duplicate delivery within the test budget',
    () => {
      const startedAt = performance.now();
      for (const input of concurrencyScenarios) {
        for (const seed of CONVERGENCE_SEEDS) {
          for (let run = 0; run < RANDOMIZED_DELIVERIES_PER_SEED; run += 1) {
            const baseline = baselineUpdate(input.initialGraph);
            const sourceA = createReplica(baseline);
            const sourceB = createReplica(baseline);
            applyOperations(sourceA, input.replicaA);
            applyOperations(sourceB, input.replicaB);
            const completeUpdateSet = [...sourceA.updates, ...sourceB.updates];
            const receivers = Array.from({ length: RANDOMIZED_RECEIVER_COUNT }, (_, index) => {
              const receiver = createReplica(baseline);
              const deliverySeed = seed + run * RUN_SEED_STRIDE + index * RECEIVER_SEED_STRIDE;
              for (const update of shuffledWithDuplicates(completeUpdateSet, deliverySeed)) {
                applyRemoteUpdate(receiver.document, update);
              }
              return receiver;
            });
            expectConverged(receivers.map(({ document }) => projectGraphDocument(document)));
          }
        }
      }
      expect(performance.now() - startedAt).toBeLessThanOrEqual(CONVERGENCE_TEST_BUDGET_MS);
    },
    CONVERGENCE_TEST_TIMEOUT_MS,
  );
});
