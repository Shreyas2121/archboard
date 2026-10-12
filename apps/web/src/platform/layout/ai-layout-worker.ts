import ELK, { type ELK as ElkEngine } from 'elkjs/lib/elk-api.js';
import workerUrl from 'elkjs/lib/elk-worker.min.js?url';
import {
  aiLayoutInputSchema,
  validateAiPositions,
  type AiLayoutInput,
} from '@/features/editor/ai/ai-diagram-geometry';

/** Native ELK execution remains inside the terminable worker tree. */
export async function runAiLayeredLayout(value: AiLayoutInput, engine?: Pick<ElkEngine, 'layout'>) {
  const input = aiLayoutInputSchema.parse(value);
  // The bundled shim cannot initialize inside a module worker. Use ELK's native
  // worker entry instead. Terminating the owner also terminates its subworker;
  // normal completion explicitly releases it before returning geometry.
  const owned = engine ? undefined : new ELK({ workerUrl });
  const elk = engine ?? owned!;
  try {
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
  } finally {
    owned?.terminateWorker();
  }
}
