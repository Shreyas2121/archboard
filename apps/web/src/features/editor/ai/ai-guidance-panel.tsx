import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MAX_AI_PROMPT_CHARACTERS, aiResultForRequestSchema } from '@archboard/contracts';
import { boardStorageNamespaceKey } from '@archboard/sync-client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { EditorSession } from '@/features/editor/application';
import {
  useEditorSelection,
  readEditorSelection,
  useEditorUiActions,
} from '@/features/editor/state';
import { useAiReviewSession } from './use-ai-review-session';
import { AI_JSON_INDENT, aiValidationMessage } from './ai-review-model';
import { AiScopedEditReview } from './ai-scoped-edit-review';
import { AiPresentationReview } from './ai-presentation-review';
import {
  GUIDANCE_STARTERS,
  reviewAiGuidance,
  retainAiGuidanceExchange,
  aiGuidanceMatchesContext,
  currentAiGuidanceHighlights,
  type AiGuidanceHistory,
  type AiGuidanceTask,
  type AiPresentationMode,
} from './ai-guidance-model';

export function AiGuidancePanel({
  session,
  active,
}: {
  readonly session: EditorSession;
  readonly active: boolean;
}) {
  const { workflow, state, identity, online } = useAiReviewSession(session);
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const selection = useEditorSelection();
  const actions = useEditorUiActions();
  const [task, setTask] = useState<AiGuidanceTask>('explain-selection');
  const [prompt, setPrompt] = useState(GUIDANCE_STARTERS['explain-selection']);
  const [history, setHistory] = useState<AiGuidanceHistory>([]);
  const [problem, setProblem] = useState('');
  const [presentationMode, setPresentationMode] = useState<AiPresentationMode>('append');
  const reviewedSelection = useRef('');
  const selectionKey = () =>
    JSON.stringify(
      readEditorSelection()
        .map((item) => `${item.kind}:${item.id}`)
        .sort(),
    );
  const review = state.review;
  const current =
    !!review &&
    reviewedSelection.current ===
      JSON.stringify(selection.map((item) => `${item.kind}:${item.id}`).sort()) &&
    !!snapshot.projection &&
    aiGuidanceMatchesContext(
      review,
      snapshot.projection,
      selection,
      history,
      prompt,
      task,
      presentationMode,
    );
  const result = state.run?.content.status === 'available' ? state.run.content.result : null;
  let guidance = null;
  try {
    if (review && result) {
      const validated = aiResultForRequestSchema(review).parse(result);
      if (
        validated.kind === 'guidance' ||
        validated.kind === 'clarification' ||
        validated.kind === 'edits' ||
        validated.kind === 'presentation'
      )
        guidance = validated;
    }
  } catch {
    /* Invalid referenced entities are not shown or highlighted. */
  }
  const canReset =
    !state.busy &&
    state.phase !== 'uncertain' &&
    state.phase !== 'submitting' &&
    state.run?.content.status !== 'pending' &&
    state.run?.state !== 'outcome-unknown';
  const hasGuidance = guidance !== null;
  useEffect(() => {
    if (!identity) {
      setHistory([]);
      setPrompt(GUIDANCE_STARTERS['explain-selection']);
      setTask('explain-selection');
      setPresentationMode('append');
      setProblem('');
    }
  }, [identity]);
  useEffect(() => {
    if (!active || !identity || !current || !hasGuidance) actions.setPrivateAiHighlights(null);
    return () => actions.setPrivateAiHighlights(null);
  }, [actions, active, identity, current, hasGuidance, state.run?.id, state.run?.content.status]);
  if (!identity)
    return (
      <p className="p-4 text-sm">
        Guidance requires this account’s active owner or editor access. Private history is cleared
        when account or board access changes.
      </p>
    );
  return (
    <section className="grid gap-3 p-4" aria-label="Private architecture guidance">
      <h3 className="text-sm font-semibold">Understand selected architecture</h3>
      <p className="text-xs leading-5 text-muted-foreground">
        Select cards or connections, then review exactly what will be sent. Selected connections
        include their endpoints; connections between selected cards are included. Boundaries,
        unrelated cards are excluded. Existing presentation steps are included only for reviewed
        replacement. All fields of included cards, including code or note text, appear in the
        review. AI uses these descriptions and your private history; it cannot inspect files, fetch
        links or prove security. Guidance stays private. Scoped edits change the board only after a
        separate diff review and explicit Apply.
      </p>
      <Tabs
        value={task}
        onValueChange={(value) => {
          if (
            value === 'explain-selection' ||
            value === 'trace-flow' ||
            value === 'scoped-edit' ||
            value === 'presentation'
          ) {
            setTask(value);
            setPrompt(GUIDANCE_STARTERS[value]);
          }
        }}
      >
        <TabsList className="flex h-auto flex-wrap" aria-label="Guidance task">
          <TabsTrigger value="explain-selection" disabled={!workflow.editable() || !!state.run}>
            Explain selection
          </TabsTrigger>
          <TabsTrigger value="trace-flow" disabled={!workflow.editable() || !!state.run}>
            Trace request flow
          </TabsTrigger>
          <TabsTrigger value="scoped-edit" disabled={!workflow.editable() || !!state.run}>
            Propose scoped edits
          </TabsTrigger>
          <TabsTrigger value="presentation" disabled={!workflow.editable() || !!state.run}>
            Recruiter walkthrough
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {task === 'presentation' && (
        <section className="grid gap-2" aria-label="Presentation proposal mode">
          <Tabs
            value={presentationMode}
            onValueChange={(value) => {
              if (value === 'append' || value === 'replace-reviewed') setPresentationMode(value);
            }}
          >
            <TabsList className="flex h-auto flex-wrap">
              <TabsTrigger value="append" disabled={!workflow.editable() || !!state.run}>
                Append steps
              </TabsTrigger>
              <TabsTrigger value="replace-reviewed" disabled={!workflow.editable() || !!state.run}>
                Replace reviewed steps
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <p className="text-xs">
            Append sends selected architecture only. Replacement explicitly includes all existing
            step names, notes, rectangles, references and their referenced cards/connections in the
            complete review. Deleted references or exceeded review limits block replacement. Nothing
            is replaced until a separate review and Apply.
          </p>
        </section>
      )}
      <Label htmlFor="ai-guidance-prompt">Question or answers to earlier questions</Label>
      <Textarea
        id="ai-guidance-prompt"
        value={prompt}
        maxLength={MAX_AI_PROMPT_CHARACTERS}
        disabled={!workflow.editable() || !!state.run}
        onChange={(event) => setPrompt(event.target.value)}
      />
      <p className="text-xs">
        Private history: {history.length} messages. A complete exchange must fit the history limit;
        excess content is rejected rather than truncated.
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={!online || state.busy}
        onClick={() => void workflow.availability()}
      >
        Check guidance availability
      </Button>
      <p role="status" className="text-xs">
        {!online
          ? 'Offline. Guidance will not be queued.'
          : state.availability?.available
            ? `${state.availability.allowance.remainingFreshRuns} fresh requests remain in the current allowance.`
            : 'Check availability before requesting guidance.'}
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={!workflow.editable() || !!state.run}
        onClick={() => {
          try {
            const graph = session.getSnapshot().projection;
            const scope = session.resourceScope;
            if (!graph || !scope) throw new Error('Current board context is unavailable.');
            workflow.reviewGuidance(
              reviewAiGuidance(
                scope.boardId,
                task,
                prompt,
                graph,
                readEditorSelection(),
                history,
                presentationMode,
              ),
            );
            reviewedSelection.current = selectionKey();
            setProblem('');
          } catch (error) {
            setProblem(aiValidationMessage(error));
          }
        }}
      >
        Review selected context and history
      </Button>
      {review && (
        <section
          className="grid gap-2 rounded-lg border bg-card p-3"
          aria-label="Reviewed private guidance request"
        >
          <p className="text-sm">
            {review.boardContext!.graph.nodes.length} cards ·{' '}
            {review.boardContext!.graph.edges.length} connections · {review.history.length} history
            messages
            {review.task === 'presentation' &&
              ` · ${review.presentationMode ?? 'append'} · ${review.boardContext!.graph.steps.length} reviewed steps`}
          </p>
          <p className="text-xs">
            Review all text for secrets. This exact selection and history go to the cloud only when
            you choose Request guidance.
          </p>
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="outline">
                Read complete reviewed request
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
                {JSON.stringify(review, null, AI_JSON_INDENT)}
              </pre>
            </CollapsibleContent>
          </Collapsible>
          {!current && (
            <p role="status" className="text-xs">
              Selection, graph fields, question or history changed. Review current context before a
              new request or highlights.
            </p>
          )}
          <Button
            type="button"
            disabled={!current || !workflow.canGenerate()}
            onClick={() =>
              void workflow.generate(() => {
                const graph = session.getSnapshot().projection;
                return (
                  !!graph &&
                  reviewedSelection.current === selectionKey() &&
                  aiGuidanceMatchesContext(
                    review,
                    graph,
                    readEditorSelection(),
                    history,
                    prompt,
                    task,
                    presentationMode,
                  )
                );
              })
            }
          >
            {task === 'presentation'
              ? 'Request reviewed walkthrough proposal'
              : task === 'scoped-edit'
                ? 'Request edit proposal from this review'
                : 'Request guidance from this review'}
          </Button>
        </section>
      )}
      {(problem || state.problem) && (
        <p role="alert" className="whitespace-pre-wrap text-xs text-destructive">
          {problem || state.problem}
        </p>
      )}
      {state.retryAfterSeconds !== null && (
        <p className="text-xs">Wait {state.retryAfterSeconds} seconds before retrying.</p>
      )}
      {state.phase === 'uncertain' && (
        <Button
          type="button"
          variant="outline"
          disabled={!workflow.canRecover()}
          onClick={() => void workflow.recover()}
        >
          Recover the identical guidance request
        </Button>
      )}
      {state.run && (
        <>
          <p role="status" className="text-xs">
            {state.run.state.replaceAll('-', ' ')}.{' '}
            {state.run.content.status === 'expired'
              ? 'Private content expired; status reads do not regenerate it.'
              : state.run.state === 'outcome-unknown'
                ? 'The outcome and charge may be unknown. No automatic resubmission.'
                : ''}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={!online || state.busy}
            onClick={() => void workflow.refresh()}
          >
            Check status / reconnect
          </Button>
          {state.run.content.status === 'pending' && (
            <Button
              type="button"
              variant="outline"
              disabled={!online || state.busy}
              onClick={() => void workflow.cancel()}
            >
              Request cancellation
            </Button>
          )}
        </>
      )}
      {result && !guidance && (
        <p role="alert" className="text-xs text-destructive">
          The guidance did not match the reviewed context. No highlights or board changes were made.
        </p>
      )}
      {guidance && (
        <section
          className="grid gap-2 rounded-lg border bg-card p-3"
          aria-label="Guidance and grounded claims"
        >
          <p className="whitespace-pre-wrap text-sm">{guidance.explanation}</p>
          {guidance.kind !== 'clarification' && (
            <>
              {guidance.claims.map((claim, index) => (
                <p key={index} className="whitespace-pre-wrap text-xs">
                  {claim.provenance === 'provided'
                    ? 'Provided description'
                    : claim.provenance === 'evidenced'
                      ? 'Supplied evidence'
                      : 'Proposed / hypothetical'}
                  : {claim.text}
                  {claim.evidenceKeys.length ? ` (evidence: ${claim.evidenceKeys.join(', ')})` : ''}
                </p>
              ))}
              {guidance.assumptions.map((text, index) => (
                <p key={`assumption:${index}`} className="whitespace-pre-wrap text-xs">
                  Assumption: {text}
                </p>
              ))}
              {guidance.kind === 'guidance' && (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!current}
                    onClick={() => {
                      try {
                        const graph = session.getSnapshot().projection;
                        if (!graph || !review || !workflow.currentScope()) return;
                        if (
                          reviewedSelection.current !== selectionKey() ||
                          !aiGuidanceMatchesContext(
                            review,
                            graph,
                            readEditorSelection(),
                            history,
                            prompt,
                            task,
                          ) ||
                          state.run?.content.status !== 'available' ||
                          Date.parse(state.run.content.expiresAt) <= Date.now()
                        )
                          throw new Error(
                            'Guidance expired or selection changed. Review current context again.',
                          );
                        const highlights = currentAiGuidanceHighlights(review, guidance, graph);
                        actions.setPrivateAiHighlights({
                          scope: boardStorageNamespaceKey(session.getStorageNamespace()),
                          revision: session.getSnapshot().revision,
                          ...highlights,
                        });
                      } catch (error) {
                        setProblem(aiValidationMessage(error));
                      }
                    }}
                  >
                    Highlight references only in my view
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => actions.setPrivateAiHighlights(null)}
                  >
                    Clear private highlights
                  </Button>
                </>
              )}
              {guidance.kind === 'edits' && review && state.run && (
                <AiScopedEditReview
                  key={state.run.id}
                  session={session}
                  request={review}
                  proposal={guidance}
                  runId={state.run.id}
                  allowed={() => {
                    const run = workflow.snapshot().run;
                    return (
                      workflow.currentScope() &&
                      run?.id === state.run?.id &&
                      run?.content.status === 'available' &&
                      Date.parse(run.content.expiresAt) > Date.now()
                    );
                  }}
                />
              )}
              {guidance.kind === 'presentation' && review && state.run && (
                <AiPresentationReview
                  key={state.run.id}
                  session={session}
                  request={review}
                  proposal={guidance}
                  runId={state.run.id}
                  allowed={() => {
                    const run = workflow.snapshot().run;
                    return (
                      workflow.currentScope() &&
                      run?.id === state.run?.id &&
                      run?.content.status === 'available' &&
                      Date.parse(run.content.expiresAt) > Date.now()
                    );
                  }}
                />
              )}
            </>
          )}
          {guidance.questions.map((text, index) => (
            <p key={`question:${index}`} className="whitespace-pre-wrap text-xs">
              Question: {text}
            </p>
          ))}
          <p className="text-xs">
            Claims describe supplied information or suggestions. They are not observed code behavior
            or proof of security.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={
              !canReset ||
              (!current && guidance.kind !== 'edits' && guidance.kind !== 'presentation')
            }
            onClick={() => {
              try {
                if (!review) return;
                const next = retainAiGuidanceExchange(review, guidance);
                workflow.newDraft();
                setHistory(next);
                setPrompt('');
                setProblem('');
                actions.setPrivateAiHighlights(null);
              } catch (error) {
                setProblem(aiValidationMessage(error));
              }
            }}
          >
            Keep this exchange for a reviewed follow-up
          </Button>
        </section>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={!canReset}
        onClick={() => {
          workflow.newDraft();
          setHistory([]);
          setPrompt(GUIDANCE_STARTERS[task]);
          setProblem('');
          actions.setPrivateAiHighlights(null);
        }}
      >
        Clear private conversation and start again
      </Button>
    </section>
  );
}
