import type { RefObject } from 'react';
import type { Viewport } from '@xyflow/react';
import type { GraphProjection } from '@archboard/contracts';
import type { EditorSession } from '@/features/editor/application';
import type { SelectionReference } from '@/features/editor/state';

export interface DiscussionPanelProps {
  readonly session: EditorSession;
  readonly projection: GraphProjection | null;
  readonly selection: readonly SelectionReference[];
  readonly canvas: RefObject<HTMLDivElement | null>;
  readonly viewport: Viewport;
  readonly readOnly: boolean;
}
