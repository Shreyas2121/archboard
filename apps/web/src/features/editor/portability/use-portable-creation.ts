import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import { apiRequest, ApiClientError } from '@/platform/api';
import { HTTP_SERVER_ERROR, PortableSubmission } from './portability-policy';
import type { PortabilityScope } from './use-portability-scope';

export function usePortableCreation<T>(
  scope: PortabilityScope,
  path: `/${string}`,
  schema: z.ZodType<T>,
  confirmed: (result: T) => void,
  inspect: () => Promise<unknown>,
) {
  const intent = useRef<PortableSubmission | null>(null);
  const flight = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [failure, setFailure] = useState<ApiClientError | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      flight.current?.abort();
    };
  }, []);
  async function submit(prepare: () => unknown | Promise<unknown>) {
    if (flight.current) return;
    if (intent.current && !intent.current.retryable(Date.now())) {
      setError(
        'Review results and explicitly start a new submission. No automatic retry is allowed.',
      );
      return;
    }
    const controller = new AbortController();
    flight.current = controller;
    setBusy(true);
    setError('');
    setFailure(null);
    let sent = false;
    const wasUncertain = intent.current?.state === 'uncertain';
    const token = scope.capture();
    try {
      await scope.authenticate();
      if (!scope.accepts(token)) return;
      if (intent.current && !intent.current.retryable(Date.now()))
        throw new Error(
          'The original retry window ended. Review current results before a new submission.',
        );
      if (!intent.current) {
        const body = await prepare();
        if (!scope.accepts(token)) return;
        intent.current = new PortableSubmission(crypto.randomUUID(), body, Date.now());
      }
      const request = intent.current;
      request.state = 'pending';
      sent = true;
      const result = await apiRequest(path, schema, {
        method: 'POST',
        body: JSON.parse(request.json),
        signal: controller.signal,
        headers: { 'Idempotency-Key': request.key },
      });
      if (!scope.accepts(token)) {
        request.state = 'uncertain';
        return;
      }
      confirmed(result);
      intent.current = null;
    } catch (cause) {
      if (sent && intent.current) {
        const definite =
          !wasUncertain &&
          cause instanceof ApiClientError &&
          cause.kind === 'http' &&
          cause.status !== null &&
          cause.status < HTTP_SERVER_ERROR;
        intent.current.state = definite ? 'rejected' : 'uncertain';
      }
      if (scope.current()) {
        setFailure(cause instanceof ApiClientError ? cause : null);
        setError(cause instanceof Error ? cause.message : 'Creation could not be confirmed.');
        if (cause instanceof ApiClientError && cause.code === 'VERSION_CONFLICT') {
          try {
            await inspect();
          } catch {
            /* Keep the rejected intent until explicit review. */
          }
        }
      }
    } finally {
      if (sent && intent.current?.state === 'pending') intent.current.state = 'uncertain';
      flight.current = null;
      if (mounted.current) {
        setBusy(false);
        setRevision((value) => value + 1);
      }
    }
  }
  async function restart() {
    if (flight.current || !intent.current) return;
    // Exact retries remain the only safe action inside the receipt lifetime.
    if (intent.current.state === 'uncertain' && intent.current.retryable(Date.now())) return;
    const token = scope.capture();
    const controller = new AbortController();
    flight.current = controller;
    setBusy(true);
    try {
      await scope.authenticate();
      if (!scope.accepts(token)) return;
      await inspect();
      if (!scope.accepts(token)) return;
      intent.current = null;
      setError('Reviewed current results. Submit again to use a new key.');
      setRevision((value) => value + 1);
    } catch (cause) {
      if (scope.current())
        setError(cause instanceof Error ? cause.message : 'Results could not be reviewed.');
    } finally {
      flight.current = null;
      if (mounted.current) setBusy(false);
    }
  }
  // revision makes ref changes visible without copying the potentially large request into state.
  void revision;
  return { submit, restart, busy, error, failure, intent: intent.current };
}
