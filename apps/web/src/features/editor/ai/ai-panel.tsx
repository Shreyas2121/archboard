import { useState } from 'react';
import { MAX_AI_PROMPT_CHARACTERS } from '@archboard/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import type { EditorSession } from '@/features/editor/application';
import { downloadAiContext } from '@/platform/download/ai-context-download';
import { useAiReviewSession } from './use-ai-review-session';
import { AiContextFormFields } from './ai-context-form';
import { AiContextReview } from './ai-context-review';
import { AI_JSON_INDENT, contextFromForm, aiValidationMessage } from './ai-review-model';
import { AiDiagramPreparation } from './ai-diagram-preparation';
import { AiApplyRecovery } from './ai-apply-recovery';

export function AiPanel({
  session,
  readOnly,
}: {
  readonly session: EditorSession;
  readonly readOnly: boolean;
}) {
  const { workflow, state, online, identity } = useAiReviewSession(session);
  const [exportError, setExportError] = useState('');
  if (!identity || readOnly)
    return (
      <section className="p-4 text-sm" aria-label="AI assistant">
        AI generation requires this account’s active owner or editor access in a wider window.
        Private drafts are cleared when account or board access changes.
      </section>
    );
  const editable = workflow.editable();
  const result = state.run?.content.status === 'available' ? state.run.content.result : null;
  const terminal =
    state.run && state.run.content.status !== 'pending' && state.run.state !== 'outcome-unknown';
  return (
    <section className="grid min-w-0 gap-4 p-4" aria-label="Private AI assistant">
      <div>
        <h3 className="text-sm font-semibold">Describe your architecture</h3>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Your prompt and the context shown in your review are sent to Archboard’s cloud AI service
          only when you choose Generate. Files are never read automatically. Review what you share,
          remove secrets, and check generated suggestions before using them. Drafts stay in this
          session and are not shared with collaborators.
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={!online || state.busy}
        onClick={() => void workflow.availability()}
      >
        Check AI availability
      </Button>
      {!state.run && !state.intent && !state.busy && (
        <AiApplyRecovery
          session={session}
          allowed={() => workflow.currentScope()}
          recover={(runId) => {
            if (online) void workflow.refresh(runId);
          }}
        />
      )}
      <div role="status" className="text-xs leading-5">
        {!online
          ? 'Offline. Generation is disabled and will not be queued.'
          : state.availability?.available === true
            ? `AI is available. ${state.availability.allowance.remainingFreshRuns} fresh requests remain in the current allowance.`
            : state.availability
              ? `AI is unavailable: ${state.availability.reason.replaceAll('-', ' ')}.`
              : 'Check availability before generating.'}
        {state.availability?.allowance?.remainingMicroUsd === '0' && (
          <p>The application’s AI spending allowance is reached. A reset time is not guaranteed.</p>
        )}
      </div>
      <Label htmlFor="ai-prompt">What would you like to diagram?</Label>
      <Textarea
        id="ai-prompt"
        value={state.prompt}
        maxLength={MAX_AI_PROMPT_CHARACTERS}
        disabled={!editable}
        aria-describedby="ai-prompt-help"
        onChange={(event) => workflow.draft({ prompt: event.target.value })}
      />
      <p id="ai-prompt-help" className="text-xs text-muted-foreground">
        Up to {MAX_AI_PROMPT_CHARACTERS} characters. The current board graph is not included in this
        request.
      </p>
      <Tabs
        value={state.mode}
        onValueChange={(mode) => {
          if (mode === 'prompt' || mode === 'form' || mode === 'file') workflow.draft({ mode });
        }}
      >
        <TabsList className="flex h-auto max-w-full flex-wrap" aria-label="Context input">
          <TabsTrigger value="prompt" disabled={!editable}>
            Prompt only
          </TabsTrigger>
          <TabsTrigger value="form" disabled={!editable}>
            Guided context
          </TabsTrigger>
          <TabsTrigger value="file" disabled={!editable}>
            JSON file
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {state.mode === 'form' && (
        <>
          <AiContextFormFields
            form={state.form}
            disabled={!editable}
            change={(form) => workflow.draft({ form })}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              try {
                downloadAiContext(contextFromForm(state.form));
                setExportError('');
              } catch (error) {
                setExportError(aiValidationMessage(error));
              }
            }}
          >
            Export context JSON
          </Button>
        </>
      )}
      {state.mode === 'file' && (
        <div className="grid gap-2">
          <Label htmlFor="ai-context-file">
            One project context JSON file (UTF-8, up to 1 MiB)
          </Label>
          <Input
            id="ai-context-file"
            type="file"
            accept=".json,application/json"
            disabled={!editable}
            onChange={(event) => {
              const files = event.target.files;
              if (files && files.length === 1) void workflow.file(files[0]);
              else void workflow.file(undefined);
              event.target.value = '';
            }}
          />
          <p className="break-all text-xs">
            {state.reading
              ? 'Reading and validating locally…'
              : state.context
                ? `Validated: ${state.filename}. Nothing has been sent.`
                : state.filename ||
                  'Choose an Archboard project context file. Archives are not supported.'}
          </p>
        </div>
      )}
      {exportError && (
        <p role="alert" className="whitespace-pre-wrap text-xs text-destructive">
          {exportError}
        </p>
      )}
      {state.problem && (
        <p role="alert" className="whitespace-pre-wrap text-xs text-destructive">
          {state.problem}
        </p>
      )}
      {state.retryAfterSeconds !== null && (
        <p className="text-xs">
          The server asks you to wait {state.retryAfterSeconds} seconds before another attempt.
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        disabled={!editable || state.reading}
        onClick={() => workflow.review()}
      >
        Review request
      </Button>
      {state.review && (
        <section
          className="grid min-w-0 gap-3 rounded-lg border bg-card p-3"
          aria-label="Reviewed cloud request"
        >
          <h4 className="text-sm font-semibold">Review before sending</h4>
          <p className="text-xs">
            Target: a diagram proposal for this board. Generating does not change the board.
          </p>
          <p className="whitespace-pre-wrap break-words text-sm">{state.review.prompt}</p>
          {state.review.context && <AiContextReview context={state.review.context} />}
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="outline">
                Read complete reviewed request
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">
                {JSON.stringify(state.review, null, AI_JSON_INDENT)}
              </pre>
            </CollapsibleContent>
          </Collapsible>
          <Button
            type="button"
            disabled={!workflow.canGenerate()}
            onClick={() => void workflow.generate()}
          >
            {state.phase === 'submitting'
              ? 'Submitting original request…'
              : 'Generate from this review'}
          </Button>
        </section>
      )}
      {state.phase === 'uncertain' && (
        <div className="grid gap-2 rounded-lg border p-3">
          <p className="text-xs">
            The original request may already exist. Recovery uses exactly the same request and key.
            It never creates a replacement automatically.
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={!workflow.canRecover()}
            onClick={() => void workflow.recover()}
          >
            Recover original request
          </Button>
          {!workflow.canRecover() && !state.busy && online && (
            <p className="text-xs">
              Recovery is unavailable. Keep this intent; its outcome has not been confirmed.
            </p>
          )}
        </div>
      )}
      {state.run && (
        <section className="grid gap-3 rounded-lg border bg-card p-3" aria-label="AI run status">
          <p role="status" className="text-sm">
            {state.run.state.replaceAll('-', ' ')}
            {state.observing ? ' · Receiving status updates' : ''}
          </p>
          {state.run.state === 'outcome-unknown' && (
            <p className="text-xs">
              Generation may have been charged. The outcome is unknown; this run will not be
              resubmitted automatically.
            </p>
          )}
          {state.run.failure && (
            <p className="text-xs">
              This request ended with {state.run.failure.code.replaceAll('_', ' ').toLowerCase()}.
            </p>
          )}
          {state.run.content.status === 'expired' && (
            <p className="text-xs">
              Private result content has expired. Status checks do not regenerate it.
            </p>
          )}
          {result && (
            <>
              <p className="whitespace-pre-wrap break-words text-sm">{result.explanation}</p>
              <p className="text-xs">
                {result.kind === 'clarification'
                  ? 'More information is needed.'
                  : 'Proposal received. No board changes were made.'}
              </p>
              {result.kind === 'diagram' && (
                <AiDiagramPreparation
                  key={`${state.run!.id}:${state.run!.updatedAt}`}
                  proposal={result}
                  runId={state.run!.id}
                  session={session}
                  allowed={() =>
                    workflow.currentScope() &&
                    state.run?.content.status === 'available' &&
                    Date.parse(state.run.content.expiresAt) > Date.now()
                  }
                />
              )}
              {'questions' in result &&
                result.questions.map((question, index) => (
                  <p
                    key={`${index}:${question}`}
                    className="whitespace-pre-wrap break-words text-xs"
                  >
                    {question}
                  </p>
                ))}
            </>
          )}
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
        </section>
      )}
      {(terminal || state.phase === 'rejected' || state.phase === 'expired') && (
        <Button
          type="button"
          variant="outline"
          disabled={state.busy}
          onClick={() => {
            workflow.newDraft();
            setExportError('');
          }}
        >
          Start a new reviewed request
        </Button>
      )}
    </section>
  );
}
