import type { AiDiagramProposal } from '@archboard/contracts';
import {
  projectLayoutInputSchema,
  semanticOrder,
  projectNodeSize,
  type ProjectLayoutInput,
} from '../project-context/project-context-layout';

// Compatibility for the retired assistant and its isolated regression fixtures.
// The active local importer owns geometry and worker lifecycle.
export {
  PROJECT_LAYOUT_TIMEOUT_MS as AI_LAYOUT_TIMEOUT_MS,
  PROJECT_LAYOUT_PADDING as AI_LAYOUT_PADDING,
  PROJECT_NODE_SIZES as AI_NODE_SIZES,
  projectLayoutInputSchema as aiLayoutInputSchema,
  projectLayoutPositionsSchema as aiLayoutPositionsSchema,
  projectLayoutGroups as aiLayoutGroups,
  validateProjectPositions as validateAiPositions,
  fallbackProjectLayout as fallbackAiLayout,
  enclosingProjectRect as enclosingAiRect,
  semanticOrder,
  type ProjectLayoutInput as AiLayoutInput,
  type ProjectLayoutPositions as AiLayoutPositions,
  type ProjectLayout as AiLayout,
} from '../project-context/project-context-layout';

export function aiLayoutInput(proposal: AiDiagramProposal): ProjectLayoutInput {
  return projectLayoutInputSchema.parse({
    nodes: [...proposal.nodes]
      .sort(semanticOrder)
      .map((node) => ({ key: node.key, size: projectNodeSize(node.kind, node.title) })),
    edges: [...proposal.edges]
      .sort(semanticOrder)
      .map(({ key, source, target }) => ({ key, source, target })),
    groups: [...proposal.boundaries]
      .sort(semanticOrder)
      .map(({ key, nodeKeys }) => ({ key, nodeKeys: [...nodeKeys].sort() })),
  });
}
