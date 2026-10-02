import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ObjectNavigationPanel } from '@/features/editor/selection/object-navigation-panel';
import { useRemovedControlFocus } from '@/features/editor/selection/use-removed-control-focus';
import { PanelRightClose, PanelRightOpen, Scan } from 'lucide-react';
import { MAX_LIVE_EDGES } from '@archboard/contracts';

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
  narrowScreen,
  compactOpen,
  setCompactOpen,
  presentation,
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

  const focusRecovery = useRemovedControlFocus('browse-objects');
  const contents = (
    <div {...focusRecovery}>
      <Tabs defaultValue="properties" className="w-full">
        <TabsList className="m-3" aria-label="Inspector">
          <TabsTrigger value="properties">Properties</TabsTrigger>
          {presentation && <TabsTrigger value="steps">Steps</TabsTrigger>}
          {discussion && <TabsTrigger value="discussion">Discussion</TabsTrigger>}
        </TabsList>
        <TabsContent value="properties">
          {projection && (
            <ObjectNavigationPanel
              projection={projection}
              selection={selection}
              setSelection={actions.setSelection}
            />
          )}
          <div
            id="selected-object-properties"
            role="region"
            aria-label="Selected object properties"
            tabIndex={-1}
            className="focus-visible:outline-2 focus-visible:outline-ring"
          >
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
                      disabled={!viewState.editable || projection.edges.length >= MAX_LIVE_EDGES}
                      onCreate={createConnection}
                    />
                    {projection.edges.length >= MAX_LIVE_EDGES && (
                      <p className="mt-2 text-xs">
                        The board has reached its {MAX_LIVE_EDGES}-connection limit. Delete unused
                        connections before creating more.
                      </p>
                    )}
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
          </div>
          <EditorActionsPanel actions={editorCommands} disabled={!viewState.editable} />
        </TabsContent>
        {presentation && <TabsContent value="steps">{presentation}</TabsContent>}
        {discussion && (
          <TabsContent value="discussion" forceMount className="data-[state=inactive]:hidden">
            {discussion}
          </TabsContent>
        )}
      </Tabs>
      <Button
        type="button"
        className="m-3"
        variant="outline"
        onClick={() => {
          if (narrowScreen) setCompactOpen(false);
          else document.getElementById('architecture-canvas')?.focus();
        }}
      >
        Return to canvas
      </Button>
    </div>
  );
  if (narrowScreen)
    return (
      <Dialog open={compactOpen} onOpenChange={setCompactOpen}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            (
              document.getElementById('exit-presentation') ??
              document.getElementById('board-panels') ??
              document.getElementById('architecture-canvas')
            )?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Board panels</DialogTitle>
            <DialogDescription>
              Read properties, discussion and presentation steps. Use a wider window to edit.
            </DialogDescription>
          </DialogHeader>
          {contents}
        </DialogContent>
      </Dialog>
    );
  return (
    <>
      <Collapsible
        aria-label="Board inspector"
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
            aria-expanded={inspectorOpen}
            aria-controls="inspector-content"
            label={inspectorOpen ? 'Collapse inspector' : 'Expand inspector'}
            variant="ghost"
            onClick={actions.toggleInspector}
          >
            {inspectorOpen ? <PanelRightClose /> : <PanelRightOpen />}
          </IconButton>
          {inspectorOpen && <h2 className="text-sm font-semibold">Inspector</h2>}
        </div>
        <CollapsibleContent
          id="inspector-content"
          forceMount
          className="h-[calc(100%-3.5rem)] min-w-0 overflow-x-hidden overflow-y-auto data-[state=closed]:hidden"
        >
          {contents}
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
