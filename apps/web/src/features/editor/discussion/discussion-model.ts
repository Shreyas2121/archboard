import type {
  GraphProjection,
  ThreadAnchor,
  CreateThread,
  CreateComment,
} from '@archboard/contracts';
import type { SelectionReference } from '@/features/editor/state';
import type { SharingAuthority } from '@/features/boards/board-sharing-policy';

const HALF = 2;
const RETRY_WINDOW_MS = 82_800_000; // Leave one hour before server retention expires.

export function discussionWriteAllowed(access: SharingAuthority): boolean {
  return (
    access.accountMatches &&
    access.authenticated &&
    access.online &&
    access.fresh &&
    !access.denied &&
    !access.archived &&
    (access.role === 'owner' || access.role === 'editor')
  );
}

export function localAnchor(
  anchor: ThreadAnchor,
  graph: GraphProjection | null,
): ThreadAnchor | null {
  if (anchor.type === 'point') return anchor;
  if (!graph) return null;
  if (anchor.type === 'node') {
    const node = graph.nodes.find(({ id }) => id === anchor.id);
    return node
      ? {
          type: 'node',
          id: node.id,
          label: node.title,
          position: {
            x: node.position.x + node.size.width / HALF,
            y: node.position.y + node.size.height / HALF,
          },
        }
      : null;
  }
  const edge = graph.edges.find(({ id }) => id === anchor.id);
  const source = graph.nodes.find(({ id }) => id === edge?.sourceId);
  const target = graph.nodes.find(({ id }) => id === edge?.targetId);
  return edge && source && target
    ? {
        type: 'edge',
        id: edge.id,
        label: edge.label,
        position: {
          x:
            (source.position.x +
              source.size.width / HALF +
              target.position.x +
              target.size.width / HALF) /
            HALF,
          y:
            (source.position.y +
              source.size.height / HALF +
              target.position.y +
              target.size.height / HALF) /
            HALF,
        },
      }
    : null;
}

export function selectedAnchor(
  selection: readonly SelectionReference[],
  graph: GraphProjection | null,
): ThreadAnchor | null {
  const selected = selection.length === 1 ? selection[0] : undefined;
  if (!selected || (selected.kind !== 'node' && selected.kind !== 'edge')) return null;
  return localAnchor(
    { type: selected.kind, id: selected.id, label: '', position: { x: 0, y: 0 } },
    graph,
  );
}

export function anchorLabel(anchor: ThreadAnchor): string {
  return anchor.type === 'point'
    ? `Point (${anchor.position.x}, ${anchor.position.y})`
    : `${anchor.type === 'node' ? 'Card' : 'Connection'}: ${anchor.label || 'Untitled'}`;
}

export interface DiscussionRequest {
  readonly key: string;
  readonly startedAt: number;
  readonly operation:
    | { readonly kind: 'thread'; readonly input: CreateThread }
    | { readonly kind: 'reply'; readonly threadId: string; readonly input: CreateComment };
}

export function anchorDraftKey(anchor: ThreadAnchor): string {
  return anchor.type === 'point'
    ? `point:${anchor.position.x}:${anchor.position.y}`
    : `${anchor.type}:${anchor.id}`;
}

export function canRetryDiscussion(request: DiscussionRequest, now: number): boolean {
  return now >= request.startedAt && now - request.startedAt < RETRY_WINDOW_MS;
}

export function creationFailureUncertain(
  previous: boolean,
  writeStarted: boolean,
  definiteRejection: boolean,
): boolean {
  // A failed preflight/rejected retry cannot disprove an earlier lost response.
  // Only confirmation of the original keyed creation releases that uncertainty.
  return previous || (writeStarted && !definiteRejection);
}
