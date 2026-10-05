import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AiCreateRun, AiEditProposal } from '@archboard/contracts';
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
import { AiDiagramPreview } from './ai-diagram-preview';
import { AiApplyJournal } from './ai-apply-intent';
import { AI_JSON_INDENT, aiValidationMessage } from './ai-review-model';
import {
  prepareAiEdit,
  validateCurrentAiEdit,
  applyReviewedAiEdit,
  preflightAiEdit,
  type AiEditDraft,
} from './ai-scoped-edits';

export function AiScopedEditReview({
  session,
  request,
  proposal,
  runId,
  allowed,
}: {
  readonly session: EditorSession;
  readonly request: AiCreateRun;
  readonly proposal: AiEditProposal;
  readonly runId: string;
  readonly allowed: () => boolean;
}) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const journal = useMemo(
    () => new AiApplyJournal(session.getStorageNamespace(), localStorage),
    [session],
  );
  const applying = useRef(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AiEditDraft | null>(null);
  const [preview, setPreview] = useState<ReturnType<typeof preflightAiEdit> | null>(null);
  const [applied, setApplied] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [problem, setProblem] = useState('');
  let stale = '';
  try {
    if (draft && !applied && !blocked && snapshot.projection)
      validateCurrentAiEdit(draft, snapshot.projection);
  } catch (error) {
    stale = aiValidationMessage(error);
  }
  const durability = localDurability(snapshot, navigator.onLine);
  const acknowledged =
    durability.authoritative &&
    durability.acknowledged &&
    !durability.persistencePending &&
    !durability.outboxPending;
  function prepare() {
    if (!allowed() || !session.canEdit()) return;
    try {
      const previous = journal.get(runId);
      if (previous) {
        setApplied(previous.state === 'applied');
        setBlocked(true);
        throw new Error(
          'An Apply intent already exists for this edit. Inspect the board; replay is blocked even after Undo or reload.',
        );
      }
      const source = session.captureGraphState();
      if (!source) throw new Error('Writable board state is unavailable.');
      const next = draft ?? prepareAiEdit(source, request, proposal);
      const candidate = preflightAiEdit(source, next);
      setDraft(next);
      setPreview(candidate);
      setProblem('');
      setOpen(true);
    } catch (error) {
      setProblem(aiValidationMessage(error));
    }
  }
  async function apply() {
    if (!draft || applying.current || applied || blocked) return;
    applying.current = true;
    try {
      applyReviewedAiEdit(session, journal, runId, draft, allowed);
      setApplied(true);
      setOpen(false);
      setProblem('');
      await session.whenLocalWritesIdle();
      if (allowed()) journal.complete(runId);
    } catch (error) {
      try {
        if (journal.get(runId)) setBlocked(true);
      } catch {
        setBlocked(true);
      }
      if (allowed()) setProblem(aiValidationMessage(error));
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
          disabled={blocked || !allowed() || !session.canEdit()}
          onClick={prepare}
        >
          Review scoped edit diff
        </Button>
      )}
      {applied && (
        <p role="status" className="text-xs">
          Applied locally.{' '}
          {acknowledged
            ? 'Current state has a committed server acknowledgment.'
            : 'Local persistence or server acknowledgment may still be pending.'}{' '}
          Text/property edits use normal Undo; additions remain outside Undo. Reapplying this run is
          blocked.
        </p>
      )}
      {(problem || stale) && (
        <p role="alert" className="text-xs text-destructive">
          {problem || stale}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Review scoped architecture edits</DialogTitle>
            <DialogDescription>
              Review every before/after field and proposed addition. Apply checks current fields
              again. Existing endpoints and kinds stay immutable; deletion and reconnection are
              unavailable.
            </DialogDescription>
          </DialogHeader>
          {draft && preview && (
            <>
              <p className="text-xs">
                The canvas is a private candidate view. Unrelated changes made after preparation are
                preserved at Apply. Refresh this preview if you need to inspect them.
              </p>
              <AiDiagramPreview graph={preview.graph} />
              <section className="grid gap-3" aria-label="Before and after edit diff">
                {draft.proposal.operations.map((operation, index) => {
                  const before =
                    operation.type === 'rename-node'
                      ? operation.expectedTitle
                      : operation.type === 'label-edge'
                        ? { label: operation.expectedLabel, protocol: operation.expectedProtocol }
                        : 'expected' in operation
                          ? operation.expected
                          : 'expectedBody' in operation
                            ? operation.expectedBody
                            : 'New object';
                  const after =
                    operation.type === 'rename-node'
                      ? operation.title
                      : operation.type === 'label-edge'
                        ? { label: operation.label, protocol: operation.protocol }
                        : 'content' in operation
                          ? operation.content
                          : 'body' in operation
                            ? operation.body
                            : operation.type === 'add-node'
                              ? operation.node
                              : operation.edge;
                  return (
                    <div key={index} className="grid gap-2 rounded-lg border p-3">
                      <p className="break-all text-sm font-medium">
                        {operation.type}:{' '}
                        {'nodeId' in operation
                          ? operation.nodeId
                          : 'edgeId' in operation
                            ? operation.edgeId
                            : operation.type === 'add-node'
                              ? operation.node.key
                              : operation.edge.key}
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div>
                          <p className="text-xs font-semibold">Before / required current value</p>
                          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
                            {JSON.stringify(before, null, AI_JSON_INDENT)}
                          </pre>
                        </div>
                        <div>
                          <p className="text-xs font-semibold">After / proposed value</p>
                          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
                            {JSON.stringify(after, null, AI_JSON_INDENT)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </section>
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline">
                    Inspect complete candidate and stable addition IDs
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
                    {JSON.stringify(
                      {
                        proposal: draft.proposal,
                        ids: draft.ids,
                        graph: preview.graph,
                        updateBytes: preview.updateBytes,
                        stateBytes: preview.stateBytes,
                      },
                      null,
                      AI_JSON_INDENT,
                    )}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
              {stale && (
                <p role="alert" className="text-sm text-destructive">
                  {stale}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Reject / close without applying
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!!stale || !allowed()}
                  onClick={prepare}
                >
                  Refresh candidate preview
                </Button>
                <Button
                  type="button"
                  disabled={!!stale || blocked || applied || !allowed() || !session.canEdit()}
                  onClick={() => void apply()}
                >
                  Apply reviewed scoped edits
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
