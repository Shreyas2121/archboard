import { Button } from '@/components/ui/button';
import type { PortableSubmission } from './portability-policy';

export function CreationFeedback({
  intent,
  error,
  busy,
  restart,
}: {
  readonly intent: PortableSubmission | null;
  readonly error: string;
  readonly busy: boolean;
  readonly restart: () => Promise<void>;
}) {
  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {intent?.state === 'uncertain' && (
        <p role="status" className="text-sm">
          Creation is unconfirmed. Keep this view open: the exact payload and original key are
          retained in memory. Retry sends that identical request; reconnect does not submit it.
          Reload loses this request. After 24 hours, inspect results before starting again; a new
          creation may duplicate it.
        </p>
      )}
      {intent && !intent.retryable(Date.now()) && intent.state !== 'pending' && (
        <Button type="button" variant="outline" disabled={busy} onClick={() => void restart()}>
          I will review current results; allow a new submission
        </Button>
      )}
      {intent && (
        <details className="text-sm">
          <summary>Retained request key and payload</summary>
          <p className="break-all">{intent.key}</p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap">{intent.json}</pre>
        </details>
      )}
    </>
  );
}
