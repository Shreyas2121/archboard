import {
  graphProjectionSchema,
  type ColorToken,
  type GraphNode,
  type GraphProjection,
  type Handle,
  type Point,
  type Rect,
} from '@archboard/contracts';
import {
  CARD_HEADER_HEIGHT,
  CARD_INSET,
  CORNER_RADIUS,
  DASH_LENGTH,
  IMAGE_HALF,
  IMAGE_PADDING,
  IMAGE_STROKE_WIDTH,
  LABEL_LINE_LIMIT,
  LABEL_WIDTH_LIMIT,
  MARKER_SIZE,
  STROKE_MARGIN,
  TEXT_CELL_WIDTH,
  TEXT_FONT_SIZE,
  TEXT_LINE_HEIGHT,
  escapeXml,
  imageDimensions,
  layoutImageText,
} from './image-layout.js';
export {
  escapeXml,
  imageDimensions,
  imageFileName,
  layoutImageText,
  IMAGE_SCALE_DOUBLE,
  type ImageScale,
} from './image-layout.js';

export interface ImageSelection {
  readonly id: string;
  readonly kind: 'node' | 'edge' | 'boundary';
}
export interface ImageExportOptions {
  readonly scope: 'diagram' | 'selection';
  readonly selection?: readonly ImageSelection[];
  readonly background: boolean;
  readonly theme: 'light' | 'dark';
}
export interface ControlledSvg {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
  readonly bounds: Readonly<Rect>;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly boundaryCount: number;
  readonly omittedEdges: number;
}
const controlled = new WeakSet<object>();
export function assertControlledSvg(value: ControlledSvg): void {
  if (!controlled.has(value))
    throw new Error('Rasterization accepts only an immutable renderer-generated SVG.');
}
const COLORS: Record<ColorToken, string> = {
  gray: '#657467',
  blue: '#3158c9',
  teal: '#176b70',
  green: '#286344',
  amber: '#815513',
  red: '#b3343d',
  violet: '#7750a8',
};
const THEMES = {
  light: {
    background: '#eeefe9',
    card: '#ffffff',
    text: '#202a34',
    muted: '#5d6872',
    edge: '#657467',
  },
  dark: {
    background: '#10151b',
    card: '#202833',
    text: '#e5eaf0',
    muted: '#a9b5c3',
    edge: '#9cacbd',
  },
} as const;
type Palette = (typeof THEMES)[keyof typeof THEMES];

export function selectImageGraph(graph: GraphProjection, options: ImageExportOptions) {
  if (
    !['diagram', 'selection'].includes(options.scope) ||
    !['light', 'dark'].includes(options.theme) ||
    typeof options.background !== 'boolean'
  )
    throw new Error('Choose a supported image scope, theme and background.');
  const frozen = graphProjectionSchema.parse(graph);
  const nodeIds = new Set(
    options.scope === 'diagram'
      ? frozen.nodes.map((node) => node.id)
      : options.selection?.filter((item) => item.kind === 'node').map((item) => item.id),
  );
  const edgeIds = new Set(
    options.selection?.filter((item) => item.kind === 'edge').map((item) => item.id),
  );
  if (options.scope === 'selection')
    for (const edge of frozen.edges) {
      if (edgeIds.has(edge.id)) {
        nodeIds.add(edge.sourceId);
        nodeIds.add(edge.targetId);
      }
    }
  const nodes = frozen.nodes.filter((node) => nodeIds.has(node.id));
  const liveIds = new Set(nodes.map((node) => node.id));
  const edges = frozen.edges.filter(
    (edge) => liveIds.has(edge.sourceId) && liveIds.has(edge.targetId),
  );
  const boundaryIds = new Set(
    options.selection?.filter((item) => item.kind === 'boundary').map((item) => item.id),
  );
  const boundaries = frozen.boundaries.filter(
    (boundary) => options.scope === 'diagram' || boundaryIds.has(boundary.id),
  );
  const omittedEdges = frozen.edges.filter(
    (edge) => (options.scope === 'diagram' || edgeIds.has(edge.id)) && !edges.includes(edge),
  ).length;
  if (!nodes.length && !boundaries.length)
    throw new Error(
      'No live cards or boundaries in this scope. Select content or choose the entire diagram.',
    );
  return { nodes, edges, boundaries, omittedEdges };
}

function endpoint(node: GraphNode, handle: Handle): Point {
  const { x, y } = node.position;
  const { width, height } = node.size;
  switch (handle) {
    case 'top':
      return { x: x + width / IMAGE_HALF, y };
    case 'right':
      return { x: x + width, y: y + height / IMAGE_HALF };
    case 'bottom':
      return { x: x + width / IMAGE_HALF, y: y + height };
    case 'left':
      return { x, y: y + height / IMAGE_HALF };
  }
}

function textLines(lines: readonly string[], x: number, y: number, color: string): string {
  return `<text fill="${color}" font-family="monospace" font-size="${TEXT_FONT_SIZE}">${lines
    .map((line, index) => {
      // Explicit character-cell widths avoid font-dependent labels extending beyond calculated bounds.
      const length = Array.from(line).length * TEXT_CELL_WIDTH;
      return `<tspan x="${x}" y="${y + index * TEXT_LINE_HEIGHT}"${length ? ` textLength="${length}" lengthAdjust="spacingAndGlyphs"` : ''}>${escapeXml(line)}</tspan>`;
    })
    .join('')}</text>`;
}

function card(node: GraphNode, index: number, palette: Palette): string {
  const { x, y } = node.position;
  const { width, height } = node.size;
  const innerWidth = width - IMAGE_HALF * CARD_INSET;
  const header = layoutImageText(node.title || 'Untitled', innerWidth, 1);
  const kind =
    node.kind === 'component'
      ? node.content.category
      : node.kind === 'code'
        ? `code · ${node.content.language}`
        : node.kind;
  const body =
    node.kind === 'component'
      ? `${node.content.technology}\n${node.content.description}${node.content.externalUrl ? `\n${node.content.externalUrl}` : ''}`
      : node.content.body;
  const lineCount = Math.max(
    1,
    Math.floor((height - CARD_HEADER_HEIGHT - IMAGE_HALF * CARD_INSET) / TEXT_LINE_HEIGHT),
  );
  const layout = layoutImageText(body, innerWidth, lineCount);
  const clip = `card-clip-${index}`;
  return (
    `<g><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${CORNER_RADIUS}" fill="${palette.card}" stroke="${COLORS[node.color]}" stroke-width="${IMAGE_STROKE_WIDTH}"/>` +
    `<defs><clipPath id="${clip}"><rect x="${x + CARD_INSET}" y="${y + CARD_INSET}" width="${innerWidth}" height="${height - IMAGE_HALF * CARD_INSET}"/></clipPath></defs>` +
    `<g clip-path="url(#${clip})">${textLines(header.lines, x + CARD_INSET, y + CARD_INSET + TEXT_FONT_SIZE, palette.text)}` +
    `${textLines([kind], x + CARD_INSET, y + CARD_HEADER_HEIGHT - CARD_INSET, palette.muted)}` +
    `${textLines(layout.lines, x + CARD_INSET, y + CARD_HEADER_HEIGHT + TEXT_FONT_SIZE, palette.text)}</g>` +
    `${layout.overflow || header.overflow ? textLines(['…'], x + width - IMAGE_HALF * CARD_INSET, y + height - CARD_INSET, palette.muted) : ''}</g>`
  );
}

/** Controlled world-coordinate primitives only. No DOM, markup, links, images, fonts or CSS input. */
export function renderControlledSvg(
  graph: GraphProjection,
  options: ImageExportOptions,
): ControlledSvg {
  const scoped = selectImageGraph(graph, options);
  const palette = THEMES[options.theme];
  const rectangles: Rect[] = [
    ...scoped.nodes.map((node) => ({ ...node.position, ...node.size })),
    ...scoped.boundaries.map((boundary) => boundary.rect),
  ];
  const nodes = new Map(scoped.nodes.map((node) => [node.id, node]));
  const edges = scoped.edges.map((edge) => {
    const source = endpoint(nodes.get(edge.sourceId)!, edge.sourceHandle);
    const target = endpoint(nodes.get(edge.targetId)!, edge.targetHandle);
    const center = { x: (source.x + target.x) / IMAGE_HALF, y: (source.y + target.y) / IMAGE_HALF };
    const label = [edge.label, edge.protocol].filter(Boolean).join(' · ');
    const layout = layoutImageText(label, LABEL_WIDTH_LIMIT, LABEL_LINE_LIMIT);
    const lines = layout.overflow ? [...layout.lines.slice(0, -1), '…'] : layout.lines;
    const width =
      Math.max(1, ...lines.map((line) => Array.from(line).length * TEXT_CELL_WIDTH)) +
      IMAGE_HALF * CARD_INSET;
    const height = lines.length * TEXT_LINE_HEIGHT + IMAGE_HALF * CARD_INSET;
    const labelRect = {
      x: center.x - width / IMAGE_HALF,
      y: center.y - height / IMAGE_HALF,
      width,
      height,
    };
    if (label) rectangles.push(labelRect);
    return { edge, source, target, labelRect, lines };
  });
  const margin = IMAGE_PADDING + STROKE_MARGIN;
  const minX = Math.min(...rectangles.map((rect) => rect.x)) - margin;
  const minY = Math.min(...rectangles.map((rect) => rect.y)) - margin;
  const maxX = Math.max(...rectangles.map((rect) => rect.x + rect.width)) + margin;
  const maxY = Math.max(...rectangles.map((rect) => rect.y + rect.height)) + margin;
  const bounds = Object.freeze({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
  const dimensions = imageDimensions(bounds.width, bounds.height);
  const boundaries = scoped.boundaries
    .map((boundary) => {
      const rect = boundary.rect;
      const title = layoutImageText(boundary.title, rect.width - IMAGE_HALF * CARD_INSET, 1);
      return `<g><rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="${CORNER_RADIUS}" fill="none" stroke="${COLORS[boundary.color]}" stroke-width="${IMAGE_STROKE_WIDTH}" stroke-dasharray="${DASH_LENGTH} ${DASH_LENGTH}"/>${textLines(title.overflow ? [...title.lines.slice(0, -1), '…'] : title.lines, rect.x + CARD_INSET, rect.y + CARD_INSET + TEXT_FONT_SIZE, palette.text)}</g>`;
    })
    .join('');
  const paths = edges
    .map(
      ({ edge, source, target }) =>
        `<path d="M ${source.x} ${source.y} L ${target.x} ${target.y}" fill="none" stroke="${palette.edge}" stroke-width="${IMAGE_STROKE_WIDTH}"${edge.style === 'dashed' ? ` stroke-dasharray="${DASH_LENGTH} ${DASH_LENGTH}"` : ''} marker-end="url(#arrow-end)"${edge.direction === 'bidirectional' ? ' marker-start="url(#arrow-start)"' : ''}/>`,
    )
    .join('');
  const labels = edges
    .filter(({ lines }) => lines.length)
    .map(
      ({ labelRect, lines }) =>
        `<g><rect x="${labelRect.x}" y="${labelRect.y}" width="${labelRect.width}" height="${labelRect.height}" rx="${CORNER_RADIUS}" fill="${palette.card}"/>${textLines(lines, labelRect.x + CARD_INSET, labelRect.y + CARD_INSET + TEXT_FONT_SIZE, palette.text)}</g>`,
    )
    .join('');
  const markers = `<defs><marker id="arrow-end" markerWidth="${MARKER_SIZE}" markerHeight="${MARKER_SIZE}" refX="${MARKER_SIZE}" refY="${MARKER_SIZE / IMAGE_HALF}" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L ${MARKER_SIZE} ${MARKER_SIZE / IMAGE_HALF} L 0 ${MARKER_SIZE} Z" fill="${palette.edge}"/></marker><marker id="arrow-start" markerWidth="${MARKER_SIZE}" markerHeight="${MARKER_SIZE}" refX="0" refY="${MARKER_SIZE / IMAGE_HALF}" orient="auto" markerUnits="userSpaceOnUse"><path d="M ${MARKER_SIZE} 0 L 0 ${MARKER_SIZE / IMAGE_HALF} L ${MARKER_SIZE} ${MARKER_SIZE} Z" fill="${palette.edge}"/></marker></defs>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.width}" height="${dimensions.height}" viewBox="${minX} ${minY} ${dimensions.width} ${dimensions.height}"><title>Archboard diagram</title>${markers}${options.background ? `<rect x="${minX}" y="${minY}" width="${dimensions.width}" height="${dimensions.height}" fill="${palette.background}"/>` : ''}${boundaries}${paths}${scoped.nodes.map((node, index) => card(node, index, palette)).join('')}${labels}</svg>`;
  const result = Object.freeze({
    svg,
    ...dimensions,
    bounds,
    nodeCount: scoped.nodes.length,
    edgeCount: scoped.edges.length,
    boundaryCount: scoped.boundaries.length,
    omittedEdges: scoped.omittedEdges,
  });
  controlled.add(result);
  return result;
}
