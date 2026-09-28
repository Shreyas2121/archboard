import { useSyncExternalStore } from 'react';
import { Panel, ViewportPortal } from '@xyflow/react';
import { MousePointer2 } from 'lucide-react';
import type { GraphProjection } from '@archboard/contracts';
import type { TransientPresence } from '@archboard/sync-client';

import { cn } from '@/lib/utils';
import { PRESENCE_COLORS } from './presence-colors';

export function PresenceOverlay({
  presence,
  projection,
}: {
  readonly presence: TransientPresence;
  readonly projection: GraphProjection;
}) {
  const peers = useSyncExternalStore(
    presence.subscribe,
    presence.getSnapshot,
    presence.getSnapshot,
  );
  const geometry = new Map([
    ...projection.nodes.map((node) => [node.id, { ...node.position, ...node.size }] as const),
    ...projection.boundaries.map((boundary) => [boundary.id, boundary.rect] as const),
  ]);
  return (
    <>
      <Panel position="top-right" className="pointer-events-none flex flex-col gap-1">
        {peers.map((peer) => (
          <span
            key={peer.connectionId}
            className={cn(
              'rounded-md border bg-card px-2 py-1 text-xs shadow-sm',
              PRESENCE_COLORS[peer.user.color],
            )}
          >
            {peer.user.name || 'Collaborator'} ·{' '}
            {peer.presence.selectedCount ?? peer.presence.selectedIds.length} selected
          </span>
        ))}
      </Panel>
      <ViewportPortal>
        {peers.map((peer) => (
          <div
            key={peer.connectionId}
            // React Flow raises selected nodes to z-index 1000; peer labels remain above them.
            className={cn(
              'pointer-events-none absolute inset-0 z-[1001]',
              PRESENCE_COLORS[peer.user.color],
            )}
          >
            {peer.presence.selectedIds.map((id) => {
              const rect = geometry.get(id);
              if (rect === undefined) return null;
              // World geometry comes from the current document and must follow viewport transforms.
              return (
                <div
                  key={id}
                  data-presence-selection={id}
                  className="absolute rounded-lg border-2 border-current opacity-60"
                  style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
                />
              );
            })}
            {peer.presence.dragPreview?.positions.map(({ id, position }) => {
              const rect = geometry.get(id);
              if (rect === undefined) return null;
              // A transient outline never replaces committed canvas geometry.
              return (
                <div
                  key={id}
                  data-presence-preview={id}
                  className="absolute rounded-lg border-2 border-dashed border-current bg-card/40"
                  style={{
                    left: position.x,
                    top: position.y,
                    width: rect.width,
                    height: rect.height,
                  }}
                >
                  <span className="rounded bg-card px-1 text-xs">
                    {peer.user.name || 'Collaborator'}
                  </span>
                </div>
              );
            })}
            {peer.presence.cursor !== null && (
              <div
                data-presence-cursor={peer.connectionId}
                className="absolute flex items-start gap-1"
                // Cursor coordinates are runtime world positions.
                style={{ left: peer.presence.cursor.x, top: peer.presence.cursor.y }}
              >
                <MousePointer2 className="size-4 fill-current" aria-hidden="true" />
                <span className="whitespace-nowrap rounded bg-card px-1 text-xs">
                  {peer.user.name || 'Collaborator'}
                </span>
              </div>
            )}
          </div>
        ))}
      </ViewportPortal>
    </>
  );
}
