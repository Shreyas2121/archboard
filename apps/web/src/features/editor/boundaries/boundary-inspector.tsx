import {
  COLOR_TOKENS,
  MAX_BOUNDARY_TITLE_CHARACTERS,
  boundarySchema,
  type Boundary,
} from '@archboard/contracts';

import type { EditorSession } from '@/features/editor/application';
import { AtomicSelectField, ProductTextField } from '@/features/editor/inspector';

const COLOR_OPTIONS = Object.values(COLOR_TOKENS);

interface BoundaryInspectorProps {
  readonly boundary: Boundary;
  readonly session: EditorSession;
  readonly disabled: boolean;
  readonly onNotice: (message: string) => void;
}

export function BoundaryInspector({
  boundary,
  session,
  disabled,
  onNotice,
}: BoundaryInspectorProps) {
  return (
    <div className="grid content-start gap-5 p-4">
      <div>
        <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Boundary
        </p>
        <p className="mt-1 truncate text-sm font-semibold">
          {boundary.title || 'Untitled boundary'}
        </p>
      </div>
      <ProductTextField
        session={session}
        target={{ entity: 'boundary', id: boundary.id, field: 'title' }}
        label="Title"
        value={boundary.title}
        limit={MAX_BOUNDARY_TITLE_CHARACTERS}
        disabled={disabled}
      />
      <AtomicSelectField
        label="Color"
        value={boundary.color}
        options={COLOR_OPTIONS}
        disabled={disabled}
        onValueChange={(color) => {
          if (!boundarySchema.safeParse({ ...boundary, color }).success) {
            onNotice('The boundary color is invalid and was not saved.');
            return;
          }
          try {
            session.setBoundaryColor(boundary.id, color);
            onNotice('Boundary updated.');
          } catch {
            onNotice('The boundary could not be updated.');
          }
        }}
      />
      <p className="rounded-lg border bg-muted/30 p-3 text-xs leading-5 text-muted-foreground">
        Boundaries are visual groupings only. Moving or resizing one never moves cards inside it;
        overlap and nesting have no semantic meaning.
      </p>
    </div>
  );
}
