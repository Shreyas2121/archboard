import { useEffect, useState } from 'react';
import { CloudOff, LoaderCircle } from 'lucide-react';
import { ReactFlowProvider } from '@xyflow/react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { applicationIdSchema } from '@archboard/contracts';

import { EditorShell } from '@/app/editor/editor-shell';
import { PageState } from '@/app/components/page-state';
import { useNarrowScreen } from '@/app/hooks/use-narrow-screen';
import { Button } from '@/components/ui/button';
import { SessionState, useCurrentUser } from '@/features/auth';
import { NotFoundRoute } from './not-found-route';
import { useEditorSession, type EditorSession } from '@/features/editor/application';
import { serverUnavailable } from '@/platform/api';
import { useBoardEditorLoader } from '@/app/editor/use-board-editor-loader';
import type { BoardLoadStatus } from '@/app/editor/board-editor-loader';
import { useBoardResourceRefresh } from '@/features/boards/use-board-resource-refresh';
import { BoardSharingControl } from '@/features/boards/board-sharing-control';

interface SessionEditorProps {
  readonly session: EditorSession;
  readonly boardTitle: string;
  readonly narrowScreen: boolean;
}

function SessionEditor({ session, boardTitle, narrowScreen }: SessionEditorProps) {
  const snapshot = useEditorSession(session);
  const [sharingOpen, setSharingOpen] = useState(false);
  const currentUser = useCurrentUser();
  const { boardId } = useParams({ from: '/boards/$boardId' });
  const resourceAccount =
    currentUser.isSuccess &&
    !currentUser.isError &&
    session.resourceScope?.accountId === currentUser.data?.id &&
    session.resourceScope?.boardId === boardId
      ? (currentUser.data?.id ?? null)
      : null;
  useBoardResourceRefresh(session.resourceEvents, resourceAccount, boardId, snapshot.accessDenied);
  return (
    <EditorShell
      boardTitle={boardTitle}
      narrowScreen={narrowScreen}
      session={session}
      sessionSnapshot={snapshot}
      sharing={
        <BoardSharingControl session={session} open={sharingOpen} onOpenChange={setSharingOpen} />
      }
      sharingOpen={sharingOpen}
    />
  );
}

function OfflineBoardState({
  state,
  onRetry,
}: {
  readonly state: Exclude<BoardLoadStatus, 'ready'>;
  readonly onRetry: () => void;
}) {
  if (state === 'checking')
    return (
      <PageState
        title="Opening cached board…"
        description="Checking this device’s board data and writer access."
        role="status"
        icon={
          <LoaderCircle
            className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none"
            aria-hidden="true"
          />
        }
      />
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
        ? 'This board has no usable local document for the selected account. Browser storage may have been cleared or evicted. Reconnect and authenticate to load it again; this device cache is not a backup.'
        : 'This device could not read the local board cache. Your stored data was left unchanged.';
  return (
    <PageState
      title={title}
      description={detail}
      role="status"
      icon={<CloudOff className="size-6 text-muted-foreground" aria-hidden="true" />}
    >
      <Button asChild>
        <Link to="/boards">Cached boards</Link>
      </Button>
      <Button type="button" variant="outline" onClick={onRetry}>
        {state === 'cache-error' ? 'Retry local cache' : 'Retry connection'}
      </Button>
      <Button asChild variant="ghost">
        <Link to="/demo">Local demo</Link>
      </Button>
    </PageState>
  );
}

export function BoardEditorRoute() {
  const { boardId } = useParams({ from: '/boards/$boardId' });
  const validBoardId = applicationIdSchema.safeParse(boardId).success;
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const narrowScreen = useNarrowScreen();
  const [retryAttempt, setRetryAttempt] = useState(0);
  const mode = !validBoardId
    ? 'none'
    : currentUser.isError && serverUnavailable(currentUser.error)
      ? 'offline'
      : currentUser.data && !currentUser.isError
        ? 'online'
        : 'none';
  const {
    session,
    boardTitle,
    status: offlineState,
  } = useBoardEditorLoader({
    boardId,
    accountId: currentUser.data?.id ?? null,
    mode,
    forceReadOnly: narrowScreen,
    retryAttempt,
  });

  useEffect(() => {
    if (currentUser.isSuccess && currentUser.data === null) {
      void navigate({ to: '/', search: { returnTo: '/boards' }, replace: true });
    }
  }, [currentUser.data, currentUser.isSuccess, navigate]);

  if (currentUser.isPending) return <SessionState state="loading" />;
  if (currentUser.isError && !serverUnavailable(currentUser.error))
    return <SessionState state="error" onRetry={() => void currentUser.refetch()} />;
  const retryOffline = () => {
    setRetryAttempt((value) => value + 1);
    void currentUser.refetch();
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
      {session === null ? (
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
