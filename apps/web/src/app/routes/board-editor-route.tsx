import { useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { applicationIdSchema, type BoardSummary } from '@archboard/contracts';

import { EditorShell } from '@/app/editor/editor-shell';
import { useNarrowScreen } from '@/app/hooks/use-narrow-screen';
import { SessionState, useCurrentUser } from '@/features/auth';
import { NotFoundRoute } from './not-found-route';
import { readBoard } from '@/features/boards/board-api';
import { EditorSession, useEditorSession } from '@/features/editor/application';
import { ApiClientError } from '@/platform/api';
import { loadWebConfig } from '@/platform/config';

const HTTP_SERVER_ERROR = 500;

interface SessionEditorProps {
  readonly session: EditorSession;
  readonly board: BoardSummary | null;
  readonly narrowScreen: boolean;
}

function SessionEditor({ session, board, narrowScreen }: SessionEditorProps) {
  const snapshot = useEditorSession(session);
  return (
    <EditorShell
      boardTitle={board?.title ?? 'Board'}
      narrowScreen={narrowScreen}
      session={session}
      sessionSnapshot={snapshot}
    />
  );
}

export function BoardEditorRoute() {
  const { boardId } = useParams({ from: '/boards/$boardId' });
  const validBoardId = applicationIdSchema.safeParse(boardId).success;
  const navigate = useNavigate();
  const currentUser = useCurrentUser();
  const narrowScreen = useNarrowScreen();
  const [session, setSession] = useState<EditorSession | null>(null);
  const [board, setBoard] = useState<BoardSummary | null>(null);

  useEffect(() => {
    if (currentUser.isSuccess && currentUser.data === null) {
      void navigate({ to: '/', search: { returnTo: '/boards' }, replace: true });
    }
  }, [currentUser.data, currentUser.isSuccess, navigate]);

  useEffect(() => {
    if (!currentUser.data || !validBoardId) return;
    let active = true;
    const current = new EditorSession({
      deploymentOrigin: window.location.origin,
      forceReadOnly: narrowScreen,
      board: {
        boardId,
        userId: currentUser.data.id,
        webSocketOrigin: loadWebConfig(import.meta.env).webSocketOrigin,
      },
    });
    setSession(current);
    setBoard(null);
    void current.open().then(async () => {
      if (!active) return;
      try {
        const detail = await readBoard(boardId);
        if (!active) return;
        setBoard(detail);
        await current.setBoardAccess(detail.effectiveRole, detail.archivedAt !== null);
        if (active) await current.startSync();
      } catch (error) {
        if (!active) return;
        if (
          error instanceof ApiClientError &&
          (error.kind === 'network' ||
            (error.kind === 'http' && (error.status ?? 0) >= HTTP_SERVER_ERROR))
        ) {
          await current.startSync();
        } else {
          current.denyBoardAccess();
        }
      }
    });
    return () => {
      active = false;
      void current.close();
    };
  }, [boardId, currentUser.data, narrowScreen, validBoardId]);

  if (currentUser.isPending) return <SessionState state="loading" />;
  if (currentUser.isError)
    return <SessionState state="error" onRetry={() => void currentUser.refetch()} />;
  if (currentUser.data === null) return <SessionState state="redirecting" />;
  if (!validBoardId) return <NotFoundRoute />;

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
        <SessionEditor session={session} board={board} narrowScreen={narrowScreen} />
      )}
    </ReactFlowProvider>
  );
}
