import { PanelRightClose, PanelRightOpen, Scan } from 'lucide-react';

import { IconButton } from '@/app/components/icon-button';

import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

import { BoundaryInspector } from '@/features/editor/boundaries';

import { CardInspector } from '@/features/editor/inspector';

import { EditorActionsPanel } from '@/features/editor/history';
import { SelectionGeometryPanel } from '@/features/editor/selection';
import { EdgeInspector, KeyboardConnectionFlow } from '@/features/editor/connections';
import { SELECTION_KINDS } from '@/features/editor/state';
import { cn } from '@/lib/utils';

import type { EditorInspectorProps } from './editor-composition-types';
import { EditorInspectorSection } from './editor-inspector-section';
export function EditorInspector({
  discussion,
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
        className="min-h-0 overflow-hidden border-l bg-surface-panel max-md:hidden"
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
          {inspectorOpen && <h2 className="text-sm font-semibold">Inspector</h2>}
        </div>
        <CollapsibleContent
          forceMount
          className="h-[calc(100%-3.5rem)] min-w-0 overflow-x-hidden overflow-y-auto data-[state=closed]:hidden"
        >
          <Tabs defaultValue="properties" className="w-full">
            <TabsList className="m-3" aria-label="Inspector">
              <TabsTrigger value="properties">Properties</TabsTrigger>
              {discussion && <TabsTrigger value="discussion">Discussion</TabsTrigger>}
            </TabsList>
            <TabsContent value="properties">
              {selectedNode !== null && session !== null && projection !== null ? (
                <div>
                  <CardInspector
                    key={selectedNode.id}
                    node={selectedNode}
                    session={session}
                    disabled={!viewState.editable}
                  />
                  <EditorInspectorSection title="Geometry">
                    <SelectionGeometryPanel
                      projection={projection}
                      selection={selection}
                      session={session}
                      disabled={!viewState.editable}
                      onNotice={setConnectionNotice}
                    />
                  </EditorInspectorSection>
                  <EditorInspectorSection title="Connections">
                    <div className="px-4 pb-4">
                      <KeyboardConnectionFlow
                        nodes={projection.nodes}
                        initialSourceId={selectedNode.id}
                        disabled={!viewState.editable}
                        onCreate={createConnection}
                      />
                    </div>
                  </EditorInspectorSection>
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
                  <EditorInspectorSection title="Geometry">
                    <SelectionGeometryPanel
                      projection={projection}
                      selection={selection}
                      session={session}
                      disabled={!viewState.editable}
                      onNotice={setConnectionNotice}
                    />
                  </EditorInspectorSection>
                </div>
              ) : session !== null &&
                projection !== null &&
                selection.some(
                  ({ kind }) => kind === SELECTION_KINDS.NODE || kind === SELECTION_KINDS.BOUNDARY,
                ) ? (
                <>
                  <div className="p-4 text-sm font-semibold">{selection.length} selected</div>
                  <EditorInspectorSection title="Geometry">
                    <SelectionGeometryPanel
                      projection={projection}
                      selection={selection}
                      session={session}
                      disabled={!viewState.editable}
                      onNotice={setConnectionNotice}
                    />
                  </EditorInspectorSection>
                </>
              ) : (
                <div className="grid place-items-center px-4 py-6">
                  <div className="grid max-w-52 justify-items-center text-center">
                    <Scan className="mb-3 size-5 text-muted-foreground" aria-hidden="true" />
                    <h3 className="text-sm font-semibold">
                      {selection.length === 0 ? 'Nothing selected' : `${selection.length} selected`}
                    </h3>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">
                      Select a card, connection, or boundary to inspect its properties.
                    </p>
                  </div>
                </div>
              )}
              <EditorActionsPanel actions={editorCommands} disabled={!viewState.editable} />
            </TabsContent>
            {discussion && (
              <TabsContent value="discussion" forceMount className="data-[state=inactive]:hidden">
                {discussion}
              </TabsContent>
            )}
          </Tabs>
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
