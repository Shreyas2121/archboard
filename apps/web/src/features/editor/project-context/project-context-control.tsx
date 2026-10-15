import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  projectContextFocusSchema,
  MAX_AI_CONTEXT_FILE_BYTES,
  type GraphProjection,
  type ProjectContextV1,
  type ProjectContextFocus,
} from '@archboard/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { EditorSession } from '../application';
import { getProjectionBounds } from '../canvas/projection-adapter';
import {
  PROJECT_CONTEXT_FOCUS_OPTIONS,
  DEFAULT_PROJECT_CONTEXT_FOCUS,
} from './project-context-focus';
import { ProjectContextPromptCard } from './project-context-prompt-card';
import { ProjectContextPreview } from './project-context-preview';
import { parseProjectContext, prepareProjectContext } from './project-context-draft';
import { preflightGraphAdditions } from './project-context-preflight';
import {
  CONTEXT_ADDITIVE_GAP,
  CONTEXT_INSTRUCTION_LIMIT,
  CONTEXT_PREVIEW_INDENT,
  projectContextError,
  type ProjectContextDraft,
} from './project-context-policy';

export function ProjectContextControl({
  session,
  readOnly,
  open,
  onOpenChange,
  onApplied,
}: {
  readonly session: EditorSession;
  readonly readOnly: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onApplied: (graph: GraphProjection) => void;
}) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const editable = !readOnly && session.canEdit();
  const [focus, setFocus] = useState<ProjectContextFocus>(DEFAULT_PROJECT_CONTEXT_FOCUS);
  const [instructions, setInstructions] = useState('');
  const [filename, setFilename] = useState('');
  const [context, setContext] = useState<ProjectContextV1 | null>(null);
  const [preview, setPreview] = useState<{
    draft: ProjectContextDraft;
    base: GraphProjection;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [applied, setApplied] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const applyLock = useRef(false);
  useEffect(
    () => () => {
      operation.current?.abort();
    },
    [],
  );
  useEffect(() => {
    if (editable) return;
    operation.current?.abort();
    setContext(null);
    setPreview(null);
    setFilename('');
    setInstructions('');
    setBusy(false);
    setApplied(false);
    setProblem('');
  }, [editable]);
  const current = preview?.base === snapshot.projection;

  async function prepare(selected?: File) {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setProblem('');
    setPreview(null);
    setApplied(false);
    if (selected) {
      setFilename(selected.name);
      setContext(null);
    }
    try {
      if (readOnly || !session.canEdit()) throw new Error('Editing is unavailable for this board.');
      let sourceContext = context;
      if (selected) {
        if (selected.size > MAX_AI_CONTEXT_FILE_BYTES)
          throw new Error('Project context exceeds 1 MiB. Select a smaller focused JSON file.');
        sourceContext = parseProjectContext(new Uint8Array(await selected.arrayBuffer()));
      }
      if (controller.signal.aborted) return;
      if (!sourceContext) throw new Error('Choose a project context JSON file first.');
      setContext(sourceContext);
      if (sourceContext.diagramFocus) setFocus(sourceContext.diagramFocus);
      const base = session.getSnapshot().projection;
      const source = session.captureGraphState();
      if (!base || !source) throw new Error('Wait until the board is editable before importing.');
      const bounds = getProjectionBounds(base);
      const draft = await prepareProjectContext(sourceContext, controller.signal, {
        origin: bounds
          ? { x: bounds.x + bounds.width + CONTEXT_ADDITIVE_GAP, y: bounds.y }
          : { x: 0, y: 0 },
      });
      if (controller.signal.aborted) return;
      if (!session.canEdit() || session.getSnapshot().projection !== base)
        throw new Error('The board changed. Prepare the preview again to use its current content.');
      preflightGraphAdditions(source, draft.graph);
      setPreview({ draft, base });
    } catch (cause) {
      if (!controller.signal.aborted) setProblem(projectContextError(cause));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function apply() {
    if (applyLock.current || applied || !preview || !current || !editable) return;
    applyLock.current = true;
    try {
      session.createProjectObjects(preview.draft.graph, preview.base);
      setApplied(true);
      setProblem('');
      onApplied(preview.draft.graph);
    } catch (cause) {
      setProblem(projectContextError(cause));
    } finally {
      applyLock.current = false;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Create a diagram from project JSON</DialogTitle>
          <DialogDescription>
            Import the components, connections and groups in your file. Preview and layout run on
            this device. Adding to a shared board shares the resulting diagram with its
            collaborators.
          </DialogDescription>
        </DialogHeader>
        {!editable ? (
          <p role="status">Open an editable board in a wider window to import a project.</p>
        ) : (
          <>
            <div className="grid gap-2">
              <Label htmlFor="project-context-focus">Diagram type for extraction</Label>
              <Select
                value={focus}
                disabled={busy}
                onValueChange={(value) => setFocus(projectContextFocusSchema.parse(value))}
              >
                <SelectTrigger id="project-context-focus" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PROJECT_CONTEXT_FOCUS_OPTIONS).map(([key, option]) => (
                    <SelectItem key={key} value={key}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {PROJECT_CONTEXT_FOCUS_OPTIONS[focus].description} Copy a prompt for each diagram
                type and import the resulting file separately. This selector does not filter a
                loaded file or change a diagram already on the board.
              </p>
              <Label htmlFor="project-context-instructions">
                Extraction instructions (optional)
              </Label>
              <Textarea
                id="project-context-instructions"
                value={instructions}
                maxLength={CONTEXT_INSTRUCTION_LIMIT}
                disabled={busy}
                placeholder="For example: focus on the order lifecycle."
                onChange={(event) => setInstructions(event.target.value)}
              />
              <ProjectContextPromptCard focus={focus} instructions={instructions} disabled={busy} />
              <Label htmlFor="project-context-file">
                Project context JSON (UTF-8, up to 1 MiB)
              </Label>
              <Input
                id="project-context-file"
                type="file"
                accept=".json,application/json"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void prepare(file);
                  event.target.value = '';
                }}
              />
              {filename && <p className="break-all text-xs">Selected: {filename}</p>}
              {busy && <p role="status">Validating and arranging the project locally…</p>}
              {problem && (
                <p role="alert" className="whitespace-pre-wrap text-sm text-destructive">
                  {problem}
                </p>
              )}
              {context && !busy && !applied && (
                <Button type="button" variant="outline" onClick={() => void prepare()}>
                  Prepare preview again
                </Button>
              )}
            </div>
            {preview && (
              <section className="grid min-w-0 gap-3" aria-label="Project diagram review">
                <h2 className="text-base font-semibold">{preview.draft.context.project.name}</h2>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {preview.draft.context.project.description}
                </p>
                <p className="text-sm">
                  {preview.draft.graph.nodes.length} cards · {preview.draft.graph.edges.length}{' '}
                  connections · {preview.draft.graph.boundaries.length} groups
                </p>
                <p className="text-xs text-muted-foreground">
                  {preview.draft.layout.status === 'fallback'
                    ? 'Automatic layout was unavailable. This complete preview uses a grid.'
                    : 'Arranged locally from your JSON.'}{' '}
                  Component descriptions and connection labels come directly from the file.
                </p>
                <ProjectContextPreview graph={preview.draft.graph} />
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="outline">
                      Review file details and evidence
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="grid gap-2 pt-2">
                    <p className="text-xs text-muted-foreground">
                      Evidence, constraints and unknowns are available here for review. Keep the
                      original JSON as their reference; the board stores the diagram.
                    </p>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
                      {JSON.stringify(preview.draft.context, null, CONTEXT_PREVIEW_INDENT)}
                    </pre>
                  </CollapsibleContent>
                </Collapsible>
                {!applied && !current && (
                  <p role="status">
                    The board changed. Prepare the preview again before adding it.
                  </p>
                )}
                {!applied && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Adds beside existing content. Structural additions use delete/restore
                      afterward.
                    </p>
                    <Button type="button" disabled={!current || busy || !editable} onClick={apply}>
                      Add diagram to this board
                    </Button>
                  </>
                )}
                {applied && (
                  <p role="status">Diagram added. Check the board’s save status in the toolbar.</p>
                )}
              </section>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
