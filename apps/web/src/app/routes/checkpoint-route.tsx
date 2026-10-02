import { useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { applicationIdSchema } from '@archboard/contracts';
import { SessionState, useCurrentUser } from '@/features/auth';
import { CheckpointView } from '@/features/editor/portability/checkpoint-view';
import { NotFoundRoute } from './not-found-route';

export function CheckpointRoute() {
  const { boardId, checkpointId } = useParams({
    from: '/boards/$boardId/checkpoints/$checkpointId',
  });
  const user = useCurrentUser();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  if (
    !applicationIdSchema.safeParse(boardId).success ||
    !applicationIdSchema.safeParse(checkpointId).success
  )
    return <NotFoundRoute />;
  if (!online)
    return (
      <p role="status">Checkpoint unavailable offline. Reconnect and sign in to inspect it.</p>
    );
  if (user.isPending) return <SessionState state="loading" />;
  if (user.isError) return <SessionState state="error" onRetry={() => void user.refetch()} />;
  if (!user.data) return <p role="status">Sign in online to inspect this checkpoint.</p>;
  return (
    <CheckpointView
      key={`${user.data.id}:${boardId}:${checkpointId}`}
      accountId={user.data.id}
      boardId={boardId}
      checkpointId={checkpointId}
    />
  );
}
