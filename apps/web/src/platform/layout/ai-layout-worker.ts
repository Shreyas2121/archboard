import ELK from 'elkjs/lib/elk.bundled.js';
import {
  aiLayoutInputSchema,
  validateAiPositions,
  type AiLayoutInput,
} from '@/features/editor/ai/ai-diagram-geometry';

/** The bundled engine executes inside our terminable worker, never on the UI thread. */
export async function runAiLayeredLayout(value: AiLayoutInput) {
  const input = aiLayoutInputSchema.parse(value);
  // No nested native worker: ELK's bundled shim runs in this outer worker. The
  // owner terminates the outer worker; its shim has no terminate() implementation.
  const elk = new ELK();
  const graph = await elk.layout({
    id: 'diagram',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.randomSeed': '1',
      'elk.spacing.nodeNode': '100',
      'elk.layered.spacing.nodeNodeBetweenLayers': '100',
      'elk.padding': '[top=40,left=40,bottom=40,right=40]',
    },
    children: input.nodes.map((node) => ({ id: node.key, ...node.size })),
    edges: input.edges.map((edge) => ({
      id: edge.key,
      sources: [edge.source],
      targets: [edge.target],
    })),
  });
  return validateAiPositions(
    input,
    graph.children?.map((node) => ({
      key: node.id,
      position: { x: node.x, y: node.y },
    })),
  );
}
