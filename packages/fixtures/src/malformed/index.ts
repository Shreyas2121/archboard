import { FIXED_IDS } from '../ids.js';

export type PhysicalRootName =
  | 'meta'
  | 'nodes'
  | 'edges'
  | 'boundaries'
  | 'steps'
  | 'deletedNodes'
  | 'deletedEdges'
  | 'deletedBoundaries'
  | 'deletedSteps';

export interface MalformedPhysicalScenario {
  readonly name: string;
  readonly targetRoot: PhysicalRootName;
  readonly mutation:
    | 'replace-root-with-array'
    | 'replace-entity-map-with-scalar'
    | 'store-invalid-enum'
    | 'store-invalid-id-key'
    | 'mutate-immutable-field'
    | 'remove-accepted-entity'
    | 'store-false-tombstone'
    | 'remove-tombstone';
  readonly entityId?: string;
  readonly expectedInvariant: string;
}

export const malformedPhysicalScenarios: readonly MalformedPhysicalScenario[] = [
  {
    name: 'malformed-root-type',
    targetRoot: 'nodes',
    mutation: 'replace-root-with-array',
    expectedInvariant: 'Every fixed document root must be a Y.Map.',
  },
  {
    name: 'malformed-nested-entity',
    targetRoot: 'nodes',
    mutation: 'replace-entity-map-with-scalar',
    entityId: FIXED_IDS.NODE_A,
    expectedInvariant: 'Every stored entity must be a nested Y.Map.',
  },
  {
    name: 'malformed-stored-enum',
    targetRoot: 'nodes',
    mutation: 'store-invalid-enum',
    entityId: FIXED_IDS.NODE_A,
    expectedInvariant: 'Stored enum values must be recognized even when tombstoned.',
  },
  {
    name: 'malformed-id-key',
    targetRoot: 'edges',
    mutation: 'store-invalid-id-key',
    expectedInvariant: 'Entity map keys must be application UUIDs.',
  },
  {
    name: 'immutable-edge-endpoint-mutated',
    targetRoot: 'edges',
    mutation: 'mutate-immutable-field',
    entityId: FIXED_IDS.EDGE_A,
    expectedInvariant: 'Accepted edge endpoints and handles are immutable.',
  },
  {
    name: 'accepted-entity-physically-removed',
    targetRoot: 'nodes',
    mutation: 'remove-accepted-entity',
    entityId: FIXED_IDS.NODE_A,
    expectedInvariant: 'Accepted entities are deleted only through append-only tombstones.',
  },
  {
    name: 'false-tombstone-value',
    targetRoot: 'deletedNodes',
    mutation: 'store-false-tombstone',
    entityId: FIXED_IDS.NODE_A,
    expectedInvariant: 'Every tombstone value is literal true.',
  },
  {
    name: 'accepted-tombstone-removed',
    targetRoot: 'deletedEdges',
    mutation: 'remove-tombstone',
    entityId: FIXED_IDS.EDGE_A,
    expectedInvariant: 'Accepted tombstones are append-only.',
  },
] as const;

export interface CausalGapScenario {
  readonly name: string;
  readonly gapKind: 'structure' | 'delete-set';
  readonly entityId: string;
  readonly deliveryOrder: readonly ['dependent-update', 'dependency-update'];
  readonly expectedInvariant: string;
}

export const causalGapScenarios: readonly CausalGapScenario[] = [
  {
    name: 'out-of-order-structure-update',
    gapKind: 'structure',
    entityId: FIXED_IDS.NODE_A,
    deliveryOrder: ['dependent-update', 'dependency-update'],
    expectedInvariant: 'The dependent update is rejected until its missing structure is present.',
  },
  {
    name: 'out-of-order-delete-set-update',
    gapKind: 'delete-set',
    entityId: FIXED_IDS.NODE_B,
    deliveryOrder: ['dependent-update', 'dependency-update'],
    expectedInvariant: 'The delete set is rejected until its referenced clock range is present.',
  },
] as const;
