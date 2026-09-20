import {
  CODE_LANGUAGES,
  COLOR_TOKENS,
  COMPONENT_CATEGORIES,
  NODE_KINDS,
  graphNodeSchema,
  type GraphNode,
  type NodeKind,
  type Point,
} from '@archboard/contracts';

export const CARD_SIZES: Readonly<Record<NodeKind, GraphNode['size']>> = Object.freeze({
  [NODE_KINDS.COMPONENT]: Object.freeze({ width: 240, height: 140 }),
  [NODE_KINDS.CODE]: Object.freeze({ width: 360, height: 240 }),
  [NODE_KINDS.SCHEMA]: Object.freeze({ width: 360, height: 240 }),
  [NODE_KINDS.NOTE]: Object.freeze({ width: 240, height: 180 }),
});

const CARD_TITLES: Readonly<Record<NodeKind, string>> = Object.freeze({
  [NODE_KINDS.COMPONENT]: 'New component',
  [NODE_KINDS.CODE]: 'New code',
  [NODE_KINDS.SCHEMA]: 'New schema',
  [NODE_KINDS.NOTE]: 'New note',
});

export function createCardNode(kind: NodeKind, id: string, position: Point): GraphNode {
  const shared = {
    id,
    kind,
    position,
    size: CARD_SIZES[kind],
    title: CARD_TITLES[kind],
    color: COLOR_TOKENS.GRAY,
  };
  if (kind === NODE_KINDS.COMPONENT) {
    return graphNodeSchema.parse({
      ...shared,
      kind,
      content: {
        category: COMPONENT_CATEGORIES.GENERIC,
        description: '',
        technology: '',
        externalUrl: null,
      },
    });
  }
  if (kind === NODE_KINDS.CODE) {
    return graphNodeSchema.parse({
      ...shared,
      kind,
      content: { language: CODE_LANGUAGES.TEXT, body: '' },
    });
  }
  return graphNodeSchema.parse({ ...shared, kind, content: { body: '' } });
}
