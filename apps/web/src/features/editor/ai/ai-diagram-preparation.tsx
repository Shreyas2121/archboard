import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AiDiagramProposal, GraphProjection } from '@archboard/contracts';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { EditorSession } from '@/features/editor/application';
import { localDurability } from '@/features/editor/portability/portability-policy';
import { getProjectionBounds } from '@/features/editor/canvas/projection-adapter';
import { prepareAiDiagramDraft, type AiDiagramDraft } from './ai-diagram-draft';
import { AiApplyJournal, applyReviewedAiDiagram } from './ai-apply-intent';
import { semanticOrder } from './ai-diagram-geometry';
import { AiDiagramPreview } from './ai-diagram-preview';
import { AiNewBoard } from './ai-new-board';

const ADDITIVE_GAP = 80;
const PREVIEW_INDENT = 2;
export function AiDiagramPreparation({
  proposal,
  session,
  allowed,
  runId,
}: {
  readonly proposal: AiDiagramProposal;
  readonly session: EditorSession;
  readonly allowed: () => boolean;
  readonly runId: string;
}) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const operation = useRef<AbortController | null>(null);
  const applying = useRef(false);
  const journal = useMemo(
    () => new AiApplyJournal(session.getStorageNamespace(), localStorage),
    [session],
  );
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState('');
  const [state, setState] = useState<{
    projection: GraphProjection | null;
    busy: boolean;
    draft?: AiDiagramDraft;
  } | null>(null);
  useEffect(() => () => operation.current?.abort(), [proposal, session, snapshot.projection]);
  const current = state?.projection === snapshot.projection ? state : null;
  const draft = current?.draft;
  const durability = localDurability(snapshot, navigator.onLine);
  const acknowledged =
    durability.authoritative &&
    durability.acknowledged &&
    !durability.persistencePending &&
    !durability.outboxPending;
  async function prepare() {
    if (!allowed() || !session.canEdit()) return;
    operation.current?.abort();
    const abort = new AbortController();
    operation.current = abort;
    setError('');
    const projection = session.getSnapshot().projection;
    setState({ projection, busy: true });
    try {
      const saved = journal.get(runId);
      if (saved) {
        const presence = session.inspectAiCreatedIds(saved.ids);
        if (saved.state === 'applied' || presence === 'present') {
          setApplied(true);
          setState(null);
          return;
        }
        if (presence === 'partial')
          throw new Error(
            'Some original Apply IDs already exist. Recovery is blocked to avoid duplication.',
          );
      }
      const source = session.captureGraphState();
      if (!source) throw new Error('Editing is unavailable.');
      const bounds = projection ? getProjectionBounds(projection) : null;
      const keys = [...proposal.nodes, ...proposal.edges, ...proposal.boundaries, ...proposal.steps]
        .sort(semanticOrder)
        .map((entity) => entity.key);
      let index = 0;
      const prepared = await prepareAiDiagramDraft(proposal, source, abort.signal, {
        ...(saved
          ? {
              allocate: () => {
                const id = saved.ids[keys[index++]!];
                if (!id) throw new Error('Original Apply mapping is incomplete.');
                return id;
              },
            }
          : {}),
        origin: bounds
          ? { x: bounds.x + bounds.width + ADDITIVE_GAP, y: bounds.y }
          : { x: 0, y: 0 },
      });
      if (abort.signal.aborted || !allowed() || session.getSnapshot().projection !== projection)
        return;
      setState({ projection, busy: false, draft: prepared });
      setOpen(true);
    } catch (cause) {
      if (!abort.signal.aborted && allowed()) {
        setError(cause instanceof Error ? cause.message : 'Diagram preparation failed.');
        setState(null);
      }
    }
  }
  async function apply() {
    if (applying.current || !draft || applied) return;
    applying.current = true;
    setError('');
    try {
      // Storage succeeds before graph mutation; the existing writer lock serializes tabs.
      applyReviewedAiDiagram(session, journal, runId, draft, state?.projection ?? null, allowed);
      setApplied(true);
      setOpen(false);
      // Crashes before this flag is durable recover by the same immutable created IDs.
      await session.whenLocalWritesIdle();
      if (allowed()) journal.complete(runId);
    } catch (cause) {
      if (allowed())
        setError(cause instanceof Error ? cause.message : 'Apply could not be confirmed.');
    } finally {
      applying.current = false;
    }
  }
  return (
    <div className="grid gap-2">
      {!applied && (
        <Button
          type="button"
          variant="outline"
          disabled={current?.busy || !session.canEdit()}
          onClick={() => (draft ? setOpen(true) : void prepare())}
        >
          {current?.busy
            ? 'Preparing diagram...'
            : draft
              ? 'Review diagram preview'
              : 'Prepare diagram preview / recover Apply'}
        </Button>
      )}
      {applied && (
        <p role="status" className="text-xs">
          This proposal was applied locally.{' '}
          {acknowledged
            ? 'Saved to server after committed acknowledgment.'
            : durability.persistencePending
              ? 'Local persistence is pending; server acknowledgment is not confirmed.'
              : 'Saved on this device; server acknowledgment is pending.'}{' '}
          Structural additions use delete/restore afterward.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Review generated architecture</DialogTitle>
            <DialogDescription>
              Apply adds this diagram to the current board and shares its content with
              collaborators. Your private prompt and conversation stay private. Review assumptions
              first. Structural additions use delete/restore rather than Undo.
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <>
              <p className="text-sm">
                {draft.graph.nodes.length} cards · {draft.graph.edges.length} connections ·{' '}
                {draft.graph.boundaries.length} boundaries · {draft.graph.steps.length} presentation
                steps
              </p>
              <p className="text-xs">
                {draft.layout.status === 'fallback'
                  ? `Grid fallback (${draft.layout.reason}).`
                  : 'Layered layout.'}{' '}
                No board changes have been made.
              </p>
              <AiDiagramPreview graph={draft.graph} />
              <p className="whitespace-pre-wrap text-sm">{draft.commentary.explanation}</p>
              {draft.commentary.assumptions.map((text, index) => (
                <p key={`assumption:${index}`} className="whitespace-pre-wrap text-xs">
                  Assumption: {text}
                </p>
              ))}
              {draft.commentary.questions.map((text, index) => (
                <p key={`question:${index}`} className="whitespace-pre-wrap text-xs">
                  Question: {text}
                </p>
              ))}
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline">
                    Read full diagram and claims
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
                    {JSON.stringify(
                      { graph: draft.graph, claims: draft.commentary.claims },
                      null,
                      PREVIEW_INDENT,
                    )}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
              <Button
                type="button"
                disabled={!session.canEdit() || !allowed() || applied}
                onClick={() => void apply()}
              >
                Apply additions to this board
              </Button>
              {session.resourceScope && (
                <AiNewBoard
                  accountId={session.resourceScope.accountId}
                  boardId={session.resourceScope.boardId}
                  runId={runId}
                  journal={journal}
                  draft={draft}
                  allowed={allowed}
                />
              )}
            </>
          ) : (
            <p role="alert">
              The board changed. Close this preview and prepare it again before applying.
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              operation.current?.abort();
              setState(null);
              setOpen(false);
            }}
          >
            Discard preview
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
