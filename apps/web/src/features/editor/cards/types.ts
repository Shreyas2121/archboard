import type { GraphNode } from '@archboard/contracts';

export type ExtractedGraphNode<Kind extends GraphNode['kind']> = Extract<GraphNode, { kind: Kind }>;
