import {
  EDGE_DIRECTIONS,
  EDGE_STYLES,
  MAX_EDGE_LABEL_CHARACTERS,
  MAX_EDGE_PROTOCOL_CHARACTERS,
  graphEdgeSchema,
  type GraphEdge,
  type GraphNode,
} from '@archboard/contracts';

import type { EditorSession } from '@/features/editor/application';
import { AtomicSelectField, ProductTextField } from '@/features/editor/inspector';

const DIRECTION_OPTIONS = Object.values(EDGE_DIRECTIONS);
const STYLE_OPTIONS = Object.values(EDGE_STYLES);
const ID_PREVIEW_LENGTH = 8;

interface EdgeInspectorProps {
  readonly edge: GraphEdge;
  readonly nodes: readonly GraphNode[];
  readonly session: EditorSession;
  readonly disabled: boolean;
  readonly onNotice: (message: string) => void;
}

export function EdgeInspector({ edge, nodes, session, disabled, onNotice }: EdgeInspectorProps) {
  const nodeName = (id: string): string =>
    nodes.find((node) => node.id === id)?.title || `Card ${id.slice(0, ID_PREVIEW_LENGTH)}`;
  const applyCandidate = (candidate: GraphEdge, action: () => void): void => {
    if (!graphEdgeSchema.safeParse(candidate).success) {
      onNotice('The connection change is invalid and was not saved.');
      return;
    }
    try {
      action();
      onNotice('Connection updated.');
    } catch {
      onNotice('The connection could not be updated.');
    }
  };

  return (
    <div className="grid content-start gap-4 p-4">
      <div>
        <p className="text-xs font-medium capitalize text-muted-foreground">Connection</p>
        <p className="mt-1 break-words text-sm font-semibold">
          {edge.label || 'Unlabeled connection'}
        </p>
      </div>
      <ProductTextField
        session={session}
        target={{ entity: 'edge', id: edge.id, field: 'label' }}
        label="Label"
        value={edge.label}
        limit={MAX_EDGE_LABEL_CHARACTERS}
        disabled={disabled}
      />
      <ProductTextField
        session={session}
        target={{ entity: 'edge', id: edge.id, field: 'protocol' }}
        label="Protocol"
        value={edge.protocol}
        limit={MAX_EDGE_PROTOCOL_CHARACTERS}
        disabled={disabled}
      />
      <AtomicSelectField
        label="Direction"
        value={edge.direction}
        options={DIRECTION_OPTIONS}
        disabled={disabled}
        onValueChange={(direction) =>
          applyCandidate({ ...edge, direction }, () =>
            session.editConnection(edge.id, { direction }),
          )
        }
      />
      <AtomicSelectField
        label="Style"
        value={edge.style}
        options={STYLE_OPTIONS}
        disabled={disabled}
        onValueChange={(style) =>
          applyCandidate({ ...edge, style }, () => session.editConnection(edge.id, { style }))
        }
      />
      <div className="grid gap-2 border-t pt-3">
        <p className="text-xs font-semibold">Immutable endpoints</p>
        <dl className="grid gap-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Source</dt>
            <dd className="mt-0.5 break-words">
              {nodeName(edge.sourceId)} · {edge.sourceHandle}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Target</dt>
            <dd className="mt-0.5 break-words">
              {nodeName(edge.targetId)} · {edge.targetHandle}
            </dd>
          </div>
        </dl>
        <p className="text-xs leading-4 text-muted-foreground">
          Drag either selected edge endpoint to reconnect. Reconnection creates a fresh connection.
        </p>
      </div>
    </div>
  );
}
