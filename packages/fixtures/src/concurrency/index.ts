import { NODE_KINDS, type GraphNode, type GraphProjection, type Point } from '@archboard/contracts';

import { allEntityGraphFixture, minimalGraphFixture } from '../graph/index.js';
import { FIXED_IDS, FIXTURE_NAMESPACES, fixtureId } from '../ids.js';

const CONVERGENCE_SEED_A = 0x1a2b_3c4d;
const CONVERGENCE_SEED_B = 0x5e6f_7081;
const CONVERGENCE_SEED_C = 0x2468_ace0;
const CONVERGENCE_SEED_D = 0x1357_9bdf;
const CREATED_NODE_A_ORDINAL = 101;
const CREATED_NODE_B_ORDINAL = 102;
const INCIDENT_EDGE_ORDINAL = 103;

export const CONVERGENCE_SEEDS = [
  CONVERGENCE_SEED_A,
  CONVERGENCE_SEED_B,
  CONVERGENCE_SEED_C,
  CONVERGENCE_SEED_D,
] as const;

export type FixtureOperation =
  | { readonly type: 'set-node-title'; readonly nodeId: string; readonly title: string }
  | { readonly type: 'move-node'; readonly nodeId: string; readonly position: Point }
  | {
      readonly type: 'resize-node';
      readonly nodeId: string;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly type: 'insert-node-text';
      readonly nodeId: string;
      readonly field: 'body';
      readonly index: number;
      readonly text: string;
    }
  | { readonly type: 'tombstone-node'; readonly nodeId: string }
  | { readonly type: 'create-node'; readonly node: GraphNode }
  | {
      readonly type: 'create-edge';
      readonly edgeId: string;
      readonly sourceId: string;
      readonly targetId: string;
    }
  | { readonly type: 'set-step-order'; readonly stepId: string; readonly order: number }
  | { readonly type: 'undo-last-local' };

export interface ConcurrencyScenario {
  readonly name: string;
  readonly seed: number;
  readonly initialGraph: GraphProjection;
  readonly replicaA: readonly FixtureOperation[];
  readonly replicaB: readonly FixtureOperation[];
  readonly expectedInvariant: string;
}

const CREATED_NODE_A: GraphNode = {
  id: fixtureId(FIXTURE_NAMESPACES.NODE, CREATED_NODE_A_ORDINAL),
  kind: NODE_KINDS.NOTE,
  position: { x: 0, y: 500 },
  size: { width: 200, height: 120 },
  title: 'Replica A',
  color: 'blue',
  content: { body: 'Created by A' },
};

const CREATED_NODE_B: GraphNode = {
  ...CREATED_NODE_A,
  id: fixtureId(FIXTURE_NAMESPACES.NODE, CREATED_NODE_B_ORDINAL),
  title: 'Replica B',
  content: { body: 'Created by B' },
};

export const concurrencyScenarios: readonly ConcurrencyScenario[] = [
  {
    name: 'concurrent-rename-and-move',
    seed: CONVERGENCE_SEEDS[0],
    initialGraph: minimalGraphFixture,
    replicaA: [{ type: 'set-node-title', nodeId: FIXED_IDS.NODE_A, title: 'Renamed by A' }],
    replicaB: [{ type: 'move-node', nodeId: FIXED_IDS.NODE_A, position: { x: 80, y: 40 } }],
    expectedInvariant: 'The title and position changes both survive.',
  },
  {
    name: 'concurrent-text-inserts',
    seed: CONVERGENCE_SEEDS[1],
    initialGraph: allEntityGraphFixture,
    replicaA: [
      { type: 'insert-node-text', nodeId: FIXED_IDS.NODE_D, field: 'body', index: 0, text: 'A' },
    ],
    replicaB: [
      { type: 'insert-node-text', nodeId: FIXED_IDS.NODE_D, field: 'body', index: 0, text: 'B' },
    ],
    expectedInvariant: 'Both text inserts survive without whole-field loss.',
  },
  {
    name: 'concurrent-moves',
    seed: CONVERGENCE_SEEDS[2],
    initialGraph: minimalGraphFixture,
    replicaA: [{ type: 'move-node', nodeId: FIXED_IDS.NODE_A, position: { x: 100, y: 120 } }],
    replicaB: [{ type: 'move-node', nodeId: FIXED_IDS.NODE_A, position: { x: 300, y: 320 } }],
    expectedInvariant: 'All replicas converge without asserting a wall-clock winner.',
  },
  {
    name: 'delete-versus-edit',
    seed: CONVERGENCE_SEEDS[3],
    initialGraph: minimalGraphFixture,
    replicaA: [{ type: 'tombstone-node', nodeId: FIXED_IDS.NODE_A }],
    replicaB: [{ type: 'set-node-title', nodeId: FIXED_IDS.NODE_A, title: 'Stale edit' }],
    expectedInvariant: 'The tombstone hides the edited node on every replica.',
  },
  {
    name: 'move-and-resize',
    seed: CONVERGENCE_SEEDS[0],
    initialGraph: minimalGraphFixture,
    replicaA: [{ type: 'move-node', nodeId: FIXED_IDS.NODE_A, position: { x: 50, y: 75 } }],
    replicaB: [{ type: 'resize-node', nodeId: FIXED_IDS.NODE_A, width: 360, height: 220 }],
    expectedInvariant: 'Position and size both survive because they are separate fields.',
  },
  {
    name: 'delete-node-versus-incident-edge',
    seed: CONVERGENCE_SEEDS[1],
    initialGraph: minimalGraphFixture,
    replicaA: [{ type: 'tombstone-node', nodeId: FIXED_IDS.NODE_A }],
    replicaB: [
      {
        type: 'create-edge',
        edgeId: fixtureId(FIXTURE_NAMESPACES.EDGE, INCIDENT_EDGE_ORDINAL),
        sourceId: FIXED_IDS.NODE_A,
        targetId: FIXED_IDS.NODE_B,
      },
    ],
    expectedInvariant: 'The deleted node and every incident edge are absent from projection.',
  },
  {
    name: 'concurrent-object-creation',
    seed: CONVERGENCE_SEEDS[2],
    initialGraph: minimalGraphFixture,
    replicaA: [{ type: 'create-node', node: CREATED_NODE_A }],
    replicaB: [{ type: 'create-node', node: CREATED_NODE_B }],
    expectedInvariant: 'Both uniquely identified objects survive.',
  },
  {
    name: 'concurrent-step-reordering',
    seed: CONVERGENCE_SEEDS[3],
    initialGraph: allEntityGraphFixture,
    replicaA: [{ type: 'set-step-order', stepId: FIXED_IDS.STEP_A, order: 2 }],
    replicaB: [{ type: 'set-step-order', stepId: FIXED_IDS.STEP_B, order: -1 }],
    expectedInvariant: 'Every replica sorts the final steps by order and then ID.',
  },
  {
    name: 'local-undo-after-remote-edit',
    seed: CONVERGENCE_SEEDS[0],
    initialGraph: minimalGraphFixture,
    replicaA: [
      { type: 'set-node-title', nodeId: FIXED_IDS.NODE_A, title: 'Local title' },
      { type: 'undo-last-local' },
    ],
    replicaB: [{ type: 'move-node', nodeId: FIXED_IDS.NODE_A, position: { x: 700, y: 400 } }],
    expectedInvariant: 'Undo removes only the local title change and preserves the remote move.',
  },
] as const;
