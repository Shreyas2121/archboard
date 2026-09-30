import { PanelRightClose, PanelRightOpen, Scan } from 'lucide-react';

import { IconButton } from '@/app/components/icon-button';

import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';

import { BoundaryInspector } from '@/features/editor/boundaries';

import { CardInspector } from '@/features/editor/inspector';

import { EditorActionsPanel } from '@/features/editor/history';
import { SelectionGeometryPanel } from '@/features/editor/selection';
import { EdgeInspector, KeyboardConnectionFlow } from '@/features/editor/connections';
import { SELECTION_KINDS } from '@/features/editor/state';
import { cn } from '@/lib/utils';

import type { EditorInspectorProps } from './editor-composition-types';
export function EditorInspector({
  inspectorOpen,
  actions,
  editorCommands,
  viewState,
  session,
  projection,
  selection,
  setConnectionNotice,
  createConnection,
}: EditorInspectorProps) {
  const selectedNode =
    selection.length === 1 && selection[0]?.kind === SELECTION_KINDS.NODE
      ? (projection?.nodes.find(({ id }) => id === selection[0]?.id) ?? null)
      : null;
  const selectedEdge =
    selection.length === 1 && selection[0]?.kind === SELECTION_KINDS.EDGE
      ? (projection?.edges.find(({ id }) => id === selection[0]?.id) ?? null)
      : null;
  const selectedBoundary =
    selection.length === 1 && selection[0]?.kind === SELECTION_KINDS.BOUNDARY
      ? (projection?.boundaries.find(({ id }) => id === selection[0]?.id) ?? null)
      : null;

  return (
    <>
      <Collapsible
        className="min-h-0 overflow-hidden border-l bg-card max-md:hidden"
        open={inspectorOpen}
      >
        <div
          className={cn(
            'flex h-14 items-center gap-3 border-b px-3',
            !inspectorOpen && 'justify-center',
          )}
        >
          <IconButton
            label={inspectorOpen ? 'Collapse inspector' : 'Expand inspector'}
            variant="ghost"
            onClick={actions.toggleInspector}
          >
            {inspectorOpen ? <PanelRightClose /> : <PanelRightOpen />}
          </IconButton>
          {inspectorOpen && (
            <div>
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Details
              </p>
              <h2 className="text-sm font-semibold">Inspector</h2>
            </div>
          )}
        </div>
        <CollapsibleContent className="h-[calc(100%-3.5rem)] overflow-y-auto">
          <EditorActionsPanel actions={editorCommands} disabled={!viewState.editable} />
          {selectedNode !== null && session !== null && projection !== null ? (
            <div>
              <CardInspector
                key={selectedNode.id}
                node={selectedNode}
                session={session}
                disabled={!viewState.editable}
              />
              <SelectionGeometryPanel
                projection={projection}
                selection={selection}
                session={session}
                disabled={!viewState.editable}
                onNotice={setConnectionNotice}
              />
              <div className="border-t p-4">
                <KeyboardConnectionFlow
                  nodes={projection.nodes}
                  initialSourceId={selectedNode.id}
                  disabled={!viewState.editable}
                  onCreate={createConnection}
                />
              </div>
            </div>
          ) : selectedEdge !== null && session !== null && projection !== null ? (
            <EdgeInspector
              key={selectedEdge.id}
              edge={selectedEdge}
              nodes={projection.nodes}
              session={session}
              disabled={!viewState.editable}
              onNotice={setConnectionNotice}
            />
          ) : selectedBoundary !== null && session !== null && projection !== null ? (
            <div>
              <BoundaryInspector
                key={selectedBoundary.id}
                boundary={selectedBoundary}
                session={session}
                disabled={!viewState.editable}
                onNotice={setConnectionNotice}
              />
              <SelectionGeometryPanel
                projection={projection}
                selection={selection}
                session={session}
                disabled={!viewState.editable}
                onNotice={setConnectionNotice}
              />
            </div>
          ) : session !== null &&
            projection !== null &&
            selection.some(
              ({ kind }) => kind === SELECTION_KINDS.NODE || kind === SELECTION_KINDS.BOUNDARY,
            ) ? (
            <SelectionGeometryPanel
              projection={projection}
              selection={selection}
              session={session}
              disabled={!viewState.editable}
              onNotice={setConnectionNotice}
            />
          ) : (
            <div className="grid h-full place-items-center p-5">
              <div className="grid max-w-52 justify-items-center text-center">
                <Scan className="mb-4 size-7 text-muted-foreground" aria-hidden="true" />
                <h3 className="text-sm font-semibold">
                  {selection.length === 0 ? 'Nothing selected' : `${selection.length} selected`}
                </h3>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {selection.length === 1
                    ? 'Editing for this element arrives with its dedicated tool.'
                    : 'Select one card on the canvas to inspect its properties.'}
                </p>
              </div>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
