import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { MAX_AI_PROMPT_CHARACTERS, aiDiagramFocusSchema } from '@archboard/contracts';
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { EditorSession } from '@/features/editor/application';
import { downloadAiContext } from '@/platform/download/ai-context-download';
import { useAiReviewSession } from './use-ai-review-session';
import { AiContextFormFields } from './ai-context-form';
import { contextFromForm, aiValidationMessage, aiRunFailureMessage } from './ai-review-model';
import { AiDiagramPreparation } from './ai-diagram-preparation';
import { AiApplyRecovery } from './ai-apply-recovery';
import { AiGuidancePanel } from './ai-guidance-panel';
import { useAiGuidanceDraft } from './use-ai-guidance-draft';
import { AiAvailabilityCheck } from './ai-availability-check';
import { AiLocalContextPromptCard } from './ai-local-context-prompt-card';
import { AiRequestReviewDialog } from './ai-request-review-dialog';
import {
  AI_DIAGRAM_FOCUS_OPTIONS,
  fileDiagramPrompt,
  maxFileDiagramInstructions,
} from './ai-diagram-focus';

export function AiPanel({
  session,
  readOnly,
  open,
  onOpenChange,
}: {
  readonly session: EditorSession;
  readonly readOnly: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [tab, setTab] = useState('generate');
  // Session ownership stays above the dialog portal. Closing it unmounts its UI,
  // while requests, recovery keys and private drafts remain scoped to this board.
  const generation = useAiReviewSession(session);
  const guidance = useAiReviewSession(session);
  const guidanceDraft = useAiGuidanceDraft(guidance.identity);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-4xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.getElementById('ai-assistant')?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>AI assistant</DialogTitle>
          <DialogDescription>
            Review what you send, follow generation, and preview additions before applying. Close
            this dialog and return to the same request while this board stays open.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <div className="min-w-0 px-4 pt-4">
            <TabsList
              className="grid w-full grid-cols-2 gap-1 group-data-[orientation=horizontal]/tabs:h-auto"
              aria-label="AI assistant mode"
            >
              <TabsTrigger value="generate" className="h-auto min-h-9 min-w-0 whitespace-normal">
                Generate diagram
              </TabsTrigger>
              <TabsTrigger
                value="guidance"
                disabled={readOnly}
                className="h-auto min-h-9 min-w-0 whitespace-normal"
              >
                Understand selection
              </TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="generate" forceMount className="data-[state=inactive]:hidden">
            <AiGenerationPanel session={session} readOnly={readOnly} reviewSession={generation} />
          </TabsContent>
          <TabsContent value="guidance" forceMount className="data-[state=inactive]:hidden">
            {!readOnly && (
              <AiGuidancePanel
                session={session}
                active={open && tab === 'guidance'}
                reviewSession={guidance}
                draft={guidanceDraft}
              />
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function AiGenerationPanel({
  session,
  readOnly,
  reviewSession,
}: {
  readonly session: EditorSession;
  readonly readOnly: boolean;
  readonly reviewSession: ReturnType<typeof useAiReviewSession>;
}) {
  const { workflow, state, online, identity } = reviewSession;
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
  const promptFields = (
    <div className="grid gap-2">
      <Label htmlFor="ai-prompt">
        {state.mode === 'file'
          ? 'Additional focus instructions (optional)'
          : 'What would you like to diagram?'}
      </Label>
      <Textarea
        id="ai-prompt"
        value={state.prompt}
        placeholder={state.mode === 'file' ? fileDiagramPrompt(state.focus) : undefined}
        maxLength={
          state.mode === 'file' ? maxFileDiagramInstructions(state.focus) : MAX_AI_PROMPT_CHARACTERS
        }
        disabled={!editable || (state.mode === 'file' && state.reading)}
        aria-describedby="ai-prompt-help"
        onChange={(event) => workflow.draft({ prompt: event.target.value })}
      />
      <p id="ai-prompt-help" className="text-xs text-muted-foreground">
        {state.mode === 'file'
          ? 'Leave blank to use the selected focus. Additional instructions are included in the local AI prompt and in the diagram request you review before sending.'
          : `Up to ${MAX_AI_PROMPT_CHARACTERS} characters. The current board graph is not included in this request.`}
      </p>
    </div>
  );
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
      {!state.run && !state.intent && !state.busy && (
        <AiApplyRecovery
          session={session}
          allowed={() => workflow.currentScope()}
          recover={(runId) => {
            if (online) void workflow.refresh(runId);
          }}
        />
      )}
      <Tabs
        value={state.mode}
        onValueChange={(mode) => {
          if (mode === 'prompt' || mode === 'form' || mode === 'file') workflow.draft({ mode });
        }}
      >
        <TabsList
          className="grid w-full grid-cols-3 gap-1 group-data-[orientation=horizontal]/tabs:h-auto"
          aria-label="Context input"
        >
          <TabsTrigger
            value="prompt"
            disabled={!editable}
            className="h-auto min-h-9 min-w-0 whitespace-normal text-xs"
          >
            Prompt only
          </TabsTrigger>
          <TabsTrigger
            value="form"
            disabled={!editable}
            className="h-auto min-h-9 min-w-0 whitespace-normal text-xs"
          >
            Guided context
          </TabsTrigger>
          <TabsTrigger
            value="file"
            disabled={!editable}
            className="h-auto min-h-9 min-w-0 whitespace-normal text-xs"
          >
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
          <Label htmlFor="ai-diagram-focus">Diagram focus</Label>
          <Select
            value={state.focus}
            disabled={!editable || state.reading}
            onValueChange={(value) => workflow.draft({ focus: aiDiagramFocusSchema.parse(value) })}
          >
            <SelectTrigger
              id="ai-diagram-focus"
              className="w-full"
              aria-describedby="ai-diagram-focus-help"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(AI_DIAGRAM_FOCUS_OPTIONS).map(([focus, option]) => (
                <SelectItem key={focus} value={focus}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id="ai-diagram-focus-help" className="text-xs leading-5 text-muted-foreground">
            {AI_DIAGRAM_FOCUS_OPTIONS[state.focus].description} Choose before copying the local AI
            prompt to collect a smaller context file. Uploaded context is sent in full; changing
            focus after upload changes the diagram instructions.
          </p>
          {promptFields}
          <AiLocalContextPromptCard
            focus={state.focus}
            instructions={state.prompt}
            disabled={!editable || state.reading}
          />
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
          {state.context && (
            <p className="text-xs leading-5 text-muted-foreground">
              This file describes {state.context.components.length} components and{' '}
              {state.context.connections.length} connections. To collect different project details,
              choose a focus and use the local AI prompt above, then upload the updated file.
            </p>
          )}
        </div>
      )}
      {state.mode !== 'file' && promptFields}
      {exportError && (
        <p role="alert" className="whitespace-pre-wrap text-xs text-destructive">
          {exportError}
        </p>
      )}
      {state.problem && !state.review && (
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
          <p className="min-w-0 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
            {state.review.prompt}
          </p>
          {state.review.context && (
            <p className="min-w-0 text-xs [overflow-wrap:anywhere]">
              {state.review.context.project.name}: {state.review.context.components.length}{' '}
              components, {state.review.context.connections.length} connections,{' '}
              {state.review.context.groups.length} groups, {state.review.context.evidence.length}{' '}
              evidence excerpts.
            </p>
          )}
          <AiRequestReviewDialog review={state.review} />
          {state.phase === 'reviewed' && (
            <AiAvailabilityCheck workflow={workflow} state={state} online={online} />
          )}
          <Button
            type="button"
            className="h-auto min-h-9 w-full min-w-0 whitespace-normal"
            disabled={!workflow.canGenerate()}
            aria-busy={state.phase === 'submitting' || state.run?.content.status === 'pending'}
            aria-describedby="ai-generation-feedback"
            onClick={() => void workflow.generate()}
          >
            {(state.phase === 'submitting' || state.run?.content.status === 'pending') && (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
            )}
            {state.phase === 'submitting'
              ? 'Submitting reviewed request…'
              : state.run?.content.status === 'pending'
                ? 'Generating diagram…'
                : state.phase === 'known'
                  ? 'Request submitted'
                  : 'Generate from this review'}
          </Button>
          <p
            id="ai-generation-feedback"
            role="status"
            aria-live="polite"
            className="text-xs leading-5"
          >
            {state.phase === 'submitting'
              ? state.submissionStage === 'authenticating'
                ? 'Verifying your account…'
                : 'Reserving this request and waiting for its acknowledgment…'
              : state.run?.content.status === 'pending'
                ? state.run.state === 'queued'
                  ? 'Your request is reserved. Waiting for AI execution to begin…'
                  : 'The AI is generating your proposal. Status updates will appear below.'
                : state.phase === 'known'
                  ? state.run?.failure
                    ? 'Generation ended. See the failure and recovery options below.'
                    : 'Generation ended. Review its result below.'
                  : state.phase === 'reviewed' && !workflow.canGenerate()
                    ? 'Generation is disabled until AI availability is confirmed above.'
                    : state.phase === 'reviewed'
                      ? 'Ready to generate from this review.'
                      : null}
          </p>
          {state.problem && (
            <p role="alert" className="text-xs leading-5 text-destructive">
              {state.problem}
            </p>
          )}
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
          <p className="break-all text-xs text-muted-foreground">
            Run ID: {state.run.id}. Keep this ID to recover the original run after reloading.
          </p>
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
            <p role="alert" className="text-xs text-destructive">
              {aiRunFailureMessage(state.run.failure)}
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
