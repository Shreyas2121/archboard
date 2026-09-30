import { useEffect, useState } from 'react';
import { CheckCircle2, Download, RefreshCw, TriangleAlert } from 'lucide-react';
import { GRAPH_SCHEMA_VERSION } from '@archboard/contracts';
import {
  listAccountPendingBoards,
  readLocalSignOutPending,
  readSelectedAccountMarker,
  type PendingAccountBoard,
} from '@archboard/sync-client';

import { Button } from '@/components/ui/button';
import { downloadPendingWork } from '@/features/auth/pending-work';
import {
  prepareActiveEditorsForUpdate,
  type UpdateSession,
} from '@/features/editor/application/update-sessions';

import { samePendingWork, updateSafety, type UpdateSafety } from './update-policy';
import { activateWaitingWorker, waitingWorkerCompatibility } from './worker-update';

type Review = {
  readonly worker: ServiceWorker;
  readonly boards: readonly PendingAccountBoard[];
  readonly safety: UpdateSafety;
};

async function pendingForCurrentAccount(): Promise<readonly PendingAccountBoard[]> {
  const origin = window.location.origin;
  const userId = readSelectedAccountMarker(origin) ?? readLocalSignOutPending(origin);
  return userId === null ? [] : listAccountPendingBoards({ deploymentOrigin: origin, userId });
}

export function AppUpdatePrompt() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [worker, setWorker] = useState<ServiceWorker | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let mounted = true;
    let started = false;
    let activeRegistration: ServiceWorkerRegistration | null = null;
    const refresh = () => {
      if (!mounted || activeRegistration === null) return;
      const next = navigator.serviceWorker.controller ? activeRegistration.waiting : null;
      setWorker(next);
      setRegistration(activeRegistration);
      setDismissed(false);
    };
    const onUpdateFound = () => {
      activeRegistration?.installing?.addEventListener('statechange', refresh);
      refresh();
    };
    const register = async () => {
      if (started) return;
      started = true;
      try {
        activeRegistration = await navigator.serviceWorker.register('/sw.js');
        if (!mounted) return;
        activeRegistration.addEventListener('updatefound', onUpdateFound);
        navigator.serviceWorker.addEventListener('controllerchange', refresh);
        refresh();
      } catch {
        // The online application can run without worker support.
      }
    };
    const onLoad = () => void register();
    window.addEventListener('load', onLoad, { once: true });
    if (document.readyState === 'complete') void register();
    return () => {
      mounted = false;
      window.removeEventListener('load', onLoad);
      activeRegistration?.removeEventListener('updatefound', onUpdateFound);
      navigator.serviceWorker.removeEventListener('controllerchange', refresh);
    };
  }, []);

  useEffect(() => {
    setReview(null);
    setExported(false);
    setError(null);
  }, [worker]);

  async function inspect() {
    if (worker === null) return;
    setBusy(true);
    setError(null);
    setExported(false);
    try {
      if (registration?.waiting !== worker)
        throw new Error('The waiting application version changed. Review it again.');
      const [compatibility, boards] = await Promise.all([
        waitingWorkerCompatibility(worker),
        pendingForCurrentAccount(),
      ]);
      setReview({ worker, boards, safety: updateSafety(compatibility, boards) });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not inspect pending changes.');
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (review === null || registration === null || review.safety !== 'compatible') return;
    setBusy(true);
    setError(null);
    let sessions: readonly UpdateSession[] = [];
    try {
      sessions = await prepareActiveEditorsForUpdate();
      const current = await pendingForCurrentAccount();
      if (!samePendingWork(review.boards, current))
        throw new Error('Pending changes changed. Review this update again.');
      if (updateSafety(await waitingWorkerCompatibility(review.worker), current) !== 'compatible')
        throw new Error('Application compatibility changed. This update remains waiting.');
      await activateWaitingWorker(registration, review.worker);
      await Promise.all(sessions.map((session) => session.close()));
      window.location.reload();
    } catch (cause) {
      for (const session of sessions) session.cancelUpdatePreparation();
      setError(cause instanceof Error ? cause.message : 'Could not apply the update.');
      setReview(null);
    } finally {
      setBusy(false);
    }
  }

  if (worker === null || dismissed) return null;
  const pendingCount = review?.boards.reduce((count, board) => count + board.pendingCount, 0) ?? 0;
  const canExport =
    review !== null &&
    pendingCount > 0 &&
    review.boards.every((board) => board.namespace.graphSchemaVersion === GRAPH_SCHEMA_VERSION);
  return (
    <aside
      className="max-h-[40dvh] shrink-0 overflow-y-auto border-b bg-surface-panel px-4 py-3 text-sm sm:px-6"
      aria-label="Application update"
      role="status"
      aria-busy={busy}
    >
      <div className="mx-auto grid max-w-7xl gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-6">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-semibold leading-5">
            <RefreshCw className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            Application update ready
          </h2>
          {review === null ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Finish your current edit when convenient. The current application will stay open until
              you choose to update.
            </p>
          ) : review.safety !== 'compatible' ? (
            <p
              className="mt-2 flex items-start gap-2 rounded-control border bg-status-danger-surface p-3 text-destructive"
              role="alert"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                {review.safety === 'unsupported-worker'
                  ? 'This version cannot verify the new application’s graph schema. Keep using this version; local data remains on this device.'
                  : review.safety === 'other-tabs-open'
                    ? 'Close other Archboard tabs before updating. Their active editors must finish their local writes first.'
                    : 'Some pending changes use an unsupported graph schema. The update is blocked and local data remains on this device.'}
              </span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {pendingCount > 0
                ? `${pendingCount} pending changes on ${review.boards.length} board(s) are saved on this device. The new application supports the same graph schema. Choose to retain them through the update, or download recovery first.`
                : 'No pending changes were found for the selected account. The new application supports this graph schema.'}
            </p>
          )}
          {error && (
            <p className="mt-2 break-words text-destructive" role="alert">
              {error}
            </p>
          )}
          {exported && (
            <p className="mt-2 flex items-start gap-2 text-status-success" role="status">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Recovery download requested. Check that the file was saved.
            </p>
          )}
          {busy && (
            <p className="mt-2 text-xs text-muted-foreground">Finishing the update action…</p>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap lg:max-w-sm lg:justify-end">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setReview(null);
              setDismissed(true);
            }}
          >
            Later
          </Button>
          {review === null ? (
            <Button type="button" disabled={busy} onClick={() => void inspect()}>
              Review update
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void inspect()}
              >
                Check again
              </Button>
              {canExport && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    setError(null);
                    void downloadPendingWork(review.boards)
                      .then(() => setExported(true))
                      .catch((cause: unknown) =>
                        setError(
                          cause instanceof Error ? cause.message : 'Recovery export failed.',
                        ),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  <Download /> Download recovery
                </Button>
              )}
              {review.safety === 'compatible' && (
                <Button
                  type="button"
                  className="h-auto min-h-9 whitespace-normal"
                  disabled={busy}
                  onClick={() => void apply()}
                >
                  {pendingCount > 0 ? 'Retain changes and update' : 'Update now'}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
