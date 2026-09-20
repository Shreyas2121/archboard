import {
  EDGE_DIRECTIONS,
  EDGE_STYLES,
  graphEdgeSchema,
  type GraphEdge,
  type Handle,
} from '@archboard/contracts';

export interface ConnectionEndpoints {
  readonly sourceId: string;
  readonly sourceHandle: Handle;
  readonly targetId: string;
  readonly targetHandle: Handle;
}

function assertDifferentNodes(endpoints: ConnectionEndpoints): void {
  if (endpoints.sourceId === endpoints.targetId) {
    throw new Error('A card cannot connect to itself. Choose a different target card.');
  }
}

export function createConnectionEdge(id: string, endpoints: ConnectionEndpoints): GraphEdge {
  assertDifferentNodes(endpoints);
  return graphEdgeSchema.parse({
    id,
    ...endpoints,
    label: '',
    protocol: '',
    direction: EDGE_DIRECTIONS.FORWARD,
    style: EDGE_STYLES.SOLID,
  });
}

export function createReplacementEdge(
  id: string,
  original: GraphEdge,
  endpoints: ConnectionEndpoints,
): GraphEdge {
  assertDifferentNodes(endpoints);
  return graphEdgeSchema.parse({ ...original, id, ...endpoints });
}
