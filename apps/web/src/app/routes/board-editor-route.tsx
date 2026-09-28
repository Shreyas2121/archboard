import { useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { GRAPH_SCHEMA_VERSION, applicationIdSchema } from '@archboard/contracts';
import {
  cacheBoardSummary,
  readSelectedCachedBoard,
  selectLocalAccount,
} from '@archboard/sync-client';

import { EditorShell } from '@/app/editor/editor-shell';
import { useNarrowScreen } from '@/app/hooks/use-narrow-screen';
import { Button } from '@/components/ui/button';
import { SessionState, useCurrentUser } from '@/features/auth';
import { NotFoundRoute } from './not-found-route';
import { readBoard } from '@/features/boards/board-api';
import { EditorSession, useEditorSession } from '@/features/editor/application';
import { ApiClientError } from '@/platform/api';
import { loadWebConfig } from '@/platform/config';

const HTTP_SERVER_ERROR = 500;

interface SessionEditorProps {
  readonly session: EditorSession;
  readonly boardTitle: string;
  readonly narrowScreen: boolean;
}

type OfflineRouteState = 'checking' | 'ready' | 'no-account' | 'unavailable' | 'cache-error';

function serverUnavailable(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.kind === 'network' ||
      (error.kind === 'http' && (error.status ?? 0) >= HTTP_SERVER_ERROR))
  );
}

function SessionEditor({ session, boardTitle, narrowScreen }: SessionEditorProps) {
  const snapshot = useEditorSession(session);
  return (
    <EditorShell
      boardTitle={boardTitle}
      narrowScreen={narrowScreen}
      session={session}
      sessionSnapshot={snapshot}
    />
  );
}

function OfflineBoardState({
  state,
  onRetry,
}: {
  readonly state: Exclude<OfflineRouteState, 'ready'>;
  readonly onRetry: () => void;
}) {
  if (state === 'checking')
    return (
      <main
        className="mx-auto grid min-h-dvh max-w-xl place-content-center px-6 text-center"
        role="status"
      >
        <h1 className="text-2xl font-semibold">Opening cached board…</h1>
        <p className="mt-3 text-muted-foreground">
          Checking this device’s board data and writer access.
        </p>
      </main>
    );
  const title =
    state === 'no-account'
      ? 'No account available offline'
      : state === 'unavailable'
        ? 'Board unavailable offline'
        : 'Local board could not load';
  const detail =
    state === 'no-account'
      ? 'Reconnect and sign in before opening an account board on this device.'
      : state === 'unavailable'
        ? 'This board has no usable local document for the selected account. Reconnect to open it.'
        : 'This device could not read the local board cache. Your stored data was left unchanged.';
  return (
    <main
      className="mx-auto grid min-h-dvh max-w-xl place-content-center justify-items-center px-6 text-center"
      role="status"
    >
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-3 text-muted-foreground">{detail}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link to="/boards">Cached boards</Link>
        </Button>
        <Button type="button" variant="outline" onClick={onRetry}>
          {state === 'cache-error' ? 'Retry local cache' : 'Retry connection'}
        </Button>
        <Button asChild variant="ghost">
          <Link to="/demo">Local demo</Link>
        </Button>
      </div>
    </main>
  );
}

export function BoardEditorRoute() {
  const { boardId } = useParams({ from: '/boards/$boardId' });
  const validBoardId = applicationIdSchema.safeParse(boardId).success;
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const narrowScreen = useNarrowScreen();
  const [session, setSession] = useState<EditorSession | null>(null);
  const [sessionBoardId, setSessionBoardId] = useState<string | null>(null);
  const [boardTitle, setBoardTitle] = useState('Board');
  const [offlineState, setOfflineState] = useState<OfflineRouteState>('checking');
  const [retryAttempt, setRetryAttempt] = useState(0);

  useEffect(() => {
    if (currentUser.isSuccess && currentUser.data === null) {
      void navigate({ to: '/', search: { returnTo: '/boards' }, replace: true });
    }
  }, [currentUser.data, currentUser.isSuccess, navigate]);

  useEffect(() => {
    if (!validBoardId) return;
    const offlineSession = currentUser.isError && serverUnavailable(currentUser.error);
    if (!offlineSession && !currentUser.data) return;
    let active = true;
    let current: EditorSession | null = null;
    setSession(null);
    setSessionBoardId(null);
    setBoardTitle('Board');
    setOfflineState('checking');
    void (async () => {
      const origin = window.location.origin;
      let userId = currentUser.data?.id ?? null;
      if (offlineSession) {
        const selected = selectLocalAccount(origin, { kind: 'network-unavailable' });
        if (selected === null) {
          if (active) setOfflineState('no-account');
          return;
        }
        userId = selected.userId;
      }
      if (userId === null) return;
      const openCached = async (): Promise<boolean> => {
        try {
          const cached = await readSelectedCachedBoard(origin, boardId);
          if (!active) return false;
          if (cached === null || !cached.locallyAvailable) {
            setOfflineState('unavailable');
            return false;
          }
          if (current === null) {
            current = new EditorSession({
              deploymentOrigin: origin,
              forceReadOnly: narrowScreen,
              board: {
                boardId,
                userId,
                webSocketOrigin: loadWebConfig(import.meta.env).webSocketOrigin,
              },
            });
            await current.open();
          }
          if (!active) return false;
          if (!current.useCachedBoardAccess(cached.role, cached.archived)) {
            setOfflineState('unavailable');
            await current.close();
            current = null;
            setSession(null);
            return false;
          }
          setBoardTitle(cached.summary?.title ?? 'Cached board');
          setSession(current);
          setSessionBoardId(boardId);
          setOfflineState('ready');
          await current.startSync();
          return true;
        } catch {
          await current?.close();
          current = null;
          if (active) setSession(null);
          if (active) setOfflineState('cache-error');
          return false;
        }
      };
      if (offlineSession) {
        await openCached();
        return;
      }
      current = new EditorSession({
        deploymentOrigin: origin,
        forceReadOnly: narrowScreen,
        board: { boardId, userId, webSocketOrigin: loadWebConfig(import.meta.env).webSocketOrigin },
      });
      setSession(current);
      setSessionBoardId(boardId);
      await current.open();
      if (!active) return;
      try {
        const detail = await readBoard(boardId);
        if (!active) return;
        setBoardTitle(detail.title);
        await current.setBoardAccess(detail.effectiveRole, detail.archivedAt !== null);
        await cacheBoardSummary(
          { deploymentOrigin: origin, userId, boardId, graphSchemaVersion: GRAPH_SCHEMA_VERSION },
          detail,
        ).catch(() => undefined);
        if (active) await current.startSync();
      } catch (error) {
        if (!active) return;
        if (serverUnavailable(error)) {
          if (!(await openCached())) {
            setSession(null);
            await current?.close();
          }
        } else {
          current.denyBoardAccess();
        }
      }
    })();
    return () => {
      active = false;
      void current?.close();
    };
  }, [
    boardId,
    currentUser.data,
    currentUser.error,
    currentUser.isError,
    narrowScreen,
    retryAttempt,
    validBoardId,
  ]);

  if (currentUser.isPending) return <SessionState state="loading" />;
  if (currentUser.isError && !serverUnavailable(currentUser.error))
    return <SessionState state="error" onRetry={() => void currentUser.refetch()} />;
  const retryOffline = () => {
    if (offlineState === 'cache-error') setRetryAttempt((value) => value + 1);
    else void currentUser.refetch();
  };
  if (currentUser.isError && offlineState !== 'ready')
    return <OfflineBoardState state={offlineState} onRetry={retryOffline} />;
  if (currentUser.isSuccess && currentUser.data === null)
    return <SessionState state="redirecting" />;
  if (!validBoardId) return <NotFoundRoute />;
  if (offlineState === 'unavailable' || offlineState === 'cache-error')
    return <OfflineBoardState state={offlineState} onRetry={retryOffline} />;

  return (
    <ReactFlowProvider>
      {session === null || sessionBoardId !== boardId ? (
        <EditorShell
          boardTitle="Board"
          narrowScreen={narrowScreen}
          session={null}
          sessionSnapshot={null}
        />
      ) : (
        <SessionEditor session={session} boardTitle={boardTitle} narrowScreen={narrowScreen} />
      )}
    </ReactFlowProvider>
  );
}
