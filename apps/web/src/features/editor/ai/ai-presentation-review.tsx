import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AiCreateRun, AiPresentationProposal } from '@archboard/contracts';
import { boardStorageNamespaceKey } from '@archboard/sync-client';
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
import { useEditorUiActions } from '@/features/editor/state';
import { localDurability } from '@/features/editor/portability/portability-policy';
import { AiApplyJournal } from './ai-apply-intent';
import { AiDiagramPreview } from './ai-diagram-preview';
import { AI_JSON_INDENT, aiValidationMessage } from './ai-review-model';
import {
  prepareAiPresentation,
  preflightAiPresentation,
  validateCurrentAiPresentation,
  applyReviewedAiPresentation,
  type AiPresentationDraft,
} from './ai-presentation';

export function AiPresentationReview({
  session,
  request,
  proposal,
  runId,
  allowed,
}: {
  readonly session: EditorSession;
  readonly request: AiCreateRun;
  readonly proposal: AiPresentationProposal;
  readonly runId: string;
  readonly allowed: () => boolean;
}) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const actions = useEditorUiActions();
  const journal = useMemo(
    () => new AiApplyJournal(session.getStorageNamespace(), localStorage),
    [session],
  );
  const applying = useRef(false);
  const [open, setOpen] = useState(false);
  const [applied, setApplied] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [problem, setProblem] = useState('');
  const [draft, setDraft] = useState<AiPresentationDraft | null>(null);
  const [preview, setPreview] = useState<ReturnType<typeof preflightAiPresentation> | null>(null);
  let stale = '';
  try {
    if (draft && !applied && !blocked && snapshot.projection)
      validateCurrentAiPresentation(draft, snapshot.projection);
  } catch (error) {
    stale = aiValidationMessage(error);
  }
  useEffect(() => () => actions.setPrivateAiHighlights(null), [actions]);
  const durability = localDurability(snapshot, navigator.onLine);
  const acknowledged =
    durability.authoritative &&
    durability.acknowledged &&
    !durability.persistencePending &&
    !durability.outboxPending;
  function prepare() {
    if (!allowed() || !session.canEdit()) return;
    try {
      const saved = journal.get(runId);
      if (saved) {
        setApplied(saved.state === 'applied');
        setBlocked(true);
        throw new Error(
          'A presentation Apply attempt is already recorded. Inspect saved steps; replay is blocked.',
        );
      }
      const source = session.captureGraphState();
      if (!source) throw new Error('Current board state is unavailable.');
      const next = prepareAiPresentation(
        source,
        request,
        proposal,
        draft ? { ids: draft.ids } : {},
      );
      const candidate = preflightAiPresentation(source, next);
      setDraft(next);
      setPreview(candidate);
      setProblem('');
      setOpen(true);
    } catch (error) {
      setProblem(aiValidationMessage(error));
    }
  }
  async function apply() {
    if (!draft || applied || blocked || applying.current) return;
    applying.current = true;
    try {
      applyReviewedAiPresentation(session, journal, runId, draft, allowed);
      setApplied(true);
      setOpen(false);
      setProblem('');
      actions.setPrivateAiHighlights(null);
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
    <section className="grid gap-2" aria-label="Reviewed recruiter walkthrough">
      {!applied && (
        <Button
          type="button"
          variant="outline"
          disabled={blocked || !allowed() || !session.canEdit()}
          onClick={prepare}
        >
          Prepare and review walkthrough steps
        </Button>
      )}
      {applied && (
        <p role="status" className="text-xs">
          Presentation steps applied locally.{' '}
          {acknowledged
            ? 'Current state has a committed server acknowledgment.'
            : 'Local persistence or committed acknowledgment may still be pending.'}{' '}
          Step creation/replacement remains outside Undo. Use the normal Steps panel to play or
          share them explicitly.
        </p>
      )}
      {(problem || stale) && (
        <p role="alert" className="text-xs text-destructive">
          {problem || stale}
        </p>
      )}
      {draft && !applied && !blocked && (
        <div className="grid gap-2" aria-label="Private proposed walkthrough highlights">
          <p className="text-xs">
            These proposed steps are private until Apply. Highlighting does not save steps, move the
            canvas, start presenting or change anyone else’s view.
          </p>
          {draft.steps.map((step) => (
            <Button
              key={step.id}
              type="button"
              variant="outline"
              disabled={!!stale || !allowed()}
              onClick={() => {
                try {
                  const current = session.getSnapshot();
                  if (!current.projection || !allowed()) return;
                  validateCurrentAiPresentation(draft, current.projection);
                  actions.setPrivateAiHighlights({
                    scope: boardStorageNamespaceKey(session.getStorageNamespace()),
                    revision: current.revision,
                    nodeIds: step.nodeIds,
                    edgeIds: step.edgeIds,
                  });
                  setProblem('');
                } catch (error) {
                  setProblem(aiValidationMessage(error));
                }
              }}
            >
              Highlight in my view: {step.title || 'Untitled step'}
            </Button>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={() => actions.setPrivateAiHighlights(null)}
          >
            Clear private walkthrough highlights
          </Button>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Review architecture walkthrough</DialogTitle>
            <DialogDescription>
              {proposal.mode === 'append'
                ? 'Append these ordered steps after existing steps. Existing steps remain intact.'
                : 'Replace every explicitly reviewed existing step with these new steps. The old step IDs will be tombstoned; this structural operation is outside Undo.'}{' '}
              Applying steps does not start shared presenter mode.
            </DialogDescription>
          </DialogHeader>
          {draft && preview && (
            <>
              <AiDiagramPreview graph={preview.graph} />
              {proposal.mode === 'replace-reviewed' && (
                <section
                  className="grid gap-2 rounded-lg border p-3"
                  aria-label="Existing steps to replace"
                >
                  <p className="text-sm font-semibold">Every reviewed step to replace</p>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
                    {JSON.stringify(request.boardContext!.graph.steps, null, AI_JSON_INDENT)}
                  </pre>
                </section>
              )}
              <ol className="grid gap-3" aria-label="Proposed ordered steps">
                {draft.steps.map((step) => (
                  <li key={step.id} className="grid gap-2 rounded-lg border p-3">
                    <p className="text-sm font-semibold">
                      {step.order + 1}. {step.title || 'Untitled step'}
                    </p>
                    <p className="whitespace-pre-wrap text-sm">
                      {step.notes || 'No speaker notes proposed.'}
                    </p>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
                      {JSON.stringify(
                        {
                          id: step.id,
                          nodeIds: step.nodeIds,
                          edgeIds: step.edgeIds,
                          viewportRect: step.rect,
                        },
                        null,
                        AI_JSON_INDENT,
                      )}
                    </pre>
                  </li>
                ))}
              </ol>
              <p className="text-xs">
                Viewport rectangles include referenced cards and connection endpoints. A step with
                no references frames the complete reviewed selection. Rectangles and final order are
                derived locally, never supplied by the model.
              </p>
              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="outline">
                    Inspect complete proposal, mapping and candidate
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
                    {JSON.stringify(
                      {
                        proposal,
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
                <p role="alert" className="text-xs text-destructive">
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
                  disabled={blocked || !allowed()}
                  onClick={prepare}
                >
                  Refresh candidate with original step IDs
                </Button>
                <Button
                  type="button"
                  disabled={!!stale || applied || blocked || !allowed() || !session.canEdit()}
                  onClick={() => void apply()}
                >
                  {proposal.mode === 'append'
                    ? 'Apply appended steps'
                    : 'Apply replacement of reviewed steps'}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
