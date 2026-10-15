import ELK, { type ELK as ElkEngine, type ElkNode } from 'elkjs/lib/elk-api.js';
import workerUrl from 'elkjs/lib/elk-worker.min.js?url';
import {
  projectLayoutInputSchema,
  projectLayoutGroups,
  validateProjectPositions,
  type ProjectLayoutInput,
} from '@/features/editor/project-context/project-context-layout';

/** Native ELK execution remains inside the terminable worker tree. */
export async function runProjectLayeredLayout(
  value: ProjectLayoutInput,
  engine?: Pick<ElkEngine, 'layout'>,
) {
  const input = projectLayoutInputSchema.parse(value);
  // The bundled shim cannot initialize inside a module worker. Use ELK's native
  // worker entry instead. Terminating the owner also terminates its subworker;
  // normal completion explicitly releases it before returning geometry.
  const owned = engine ? undefined : new ELK({ workerUrl });
  const elk = engine ?? owned!;
  try {
    const groups = projectLayoutGroups(input);
    const grouped = new Set(groups.flatMap((group) => group.nodeKeys));
    const layoutOptions = {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.randomSeed': '1',
      'elk.spacing.nodeNode': '100',
      'elk.layered.spacing.nodeNodeBetweenLayers': '220',
      'elk.spacing.edgeNode': '32',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.padding': '[top=40,left=40,bottom=40,right=40]',
    };
    const graph = await elk.layout({
      id: '__archboard_layout_root__',
      layoutOptions,
      children: [
        ...groups.map((group) => ({
          id: group.key,
          // ELK does not inherit a compound parent's spacing into its children.
          layoutOptions,
          children: input.nodes
            .filter((node) => group.nodeKeys.includes(node.key))
            .map((node) => ({ id: node.key, ...node.size })),
        })),
        ...input.nodes
          .filter((node) => !grouped.has(node.key))
          .map((node) => ({ id: node.key, ...node.size })),
      ],
      edges: input.edges.map((edge) => ({
        id: edge.key,
        sources: [edge.source],
        targets: [edge.target],
      })),
    });
    const positions: { key: string; position: { x: number; y: number } }[] = [];
    const collect = (node: ElkNode, x: number, y: number) => {
      for (const child of node.children ?? []) {
        if (!Number.isFinite(child.x) || !Number.isFinite(child.y))
          throw new Error('Layout coordinates are missing.');
        const position = { x: x + child.x!, y: y + child.y! };
        if (child.children) collect(child, position.x, position.y);
        else positions.push({ key: child.id, position });
      }
    };
    collect(graph, 0, 0);
    return validateProjectPositions(input, positions);
  } finally {
    owned?.terminateWorker();
  }
}
