import { Button } from '@/components/ui/button';
import type { AiReviewSession, AiReviewState } from './ai-review-session';

export function AiAvailabilityCheck({
  workflow,
  state,
  online,
  guidance = false,
}: {
  readonly workflow: Pick<AiReviewSession, 'availability'>;
  readonly state: AiReviewState;
  readonly online: boolean;
  readonly guidance?: boolean;
}) {
  const availability = state.availability;
  return (
    <div className="grid min-w-0 gap-2">
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-9 whitespace-normal"
        disabled={!online || state.busy || state.checkingAvailability}
        aria-busy={state.checkingAvailability}
        onClick={() => void workflow.availability()}
      >
        {state.checkingAvailability
          ? 'Checking AI availability…'
          : guidance
            ? 'Check guidance availability'
            : 'Check AI availability'}
      </Button>
      <div role="status" aria-live="polite" className="text-xs leading-5">
        {!online
          ? 'Offline. AI requests are disabled and will not be queued.'
          : state.checkingAvailability
            ? 'Contacting the AI service…'
            : availability?.available
              ? availability.allowance.remainingFreshRuns === null
                ? 'AI is available. Local development usage is unlimited.'
                : `AI is available. ${availability.allowance.remainingFreshRuns} fresh requests remain in the current allowance.`
              : availability
                ? availability.reason === 'disabled'
                  ? 'AI is disabled on the server. The operator needs to enable AI configuration or remove the spending-disable marker.'
                  : `AI is unavailable: ${availability.reason.replaceAll('-', ' ')}.`
                : state.availabilityProblem
                  ? null
                  : 'Check availability before sending a request.'}
        {availability?.allowance?.remainingMicroUsd === '0' && (
          <p>The application’s AI spending allowance is reached. A reset time is not guaranteed.</p>
        )}
      </div>
      {state.availabilityProblem && (
        <p role="alert" className="text-xs leading-5 text-destructive">
          {state.availabilityProblem}
        </p>
      )}
    </div>
  );
}
