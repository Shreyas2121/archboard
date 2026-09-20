import { NODE_KINDS, graphNodeSchema, type GraphNode, type Point } from '@archboard/contracts';

import { createCardNode } from '@/features/editor/cards';

export function createClipboardNote(id: string, position: Point, text: string): GraphNode {
  const note = createCardNode(NODE_KINDS.NOTE, id, position);
  return graphNodeSchema.parse({ ...note, content: { body: text } });
}
