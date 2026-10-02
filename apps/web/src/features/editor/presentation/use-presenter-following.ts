import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { boardStorageNamespaceKey } from '@archboard/sync-client';
import type { EditorSession, EditorSessionSnapshot } from '@/features/editor/application';
import { PresenterFollowModel } from './presenter-follow-model';

export function usePresenterFollowing(
  session: EditorSession | null,
  snapshot: EditorSessionSnapshot | null,
) {
  const scope = session === null ? '' : boardStorageNamespaceKey(session.getStorageNamespace());
  const model = useMemo(
    () =>
      new PresenterFollowModel(
        session === null ? '' : boardStorageNamespaceKey(session.getStorageNamespace()),
      ),
    [session],
  );
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const transport = session?.presenter ?? null;
  const live =
    transport !== null &&
    snapshot?.sync?.ready === true &&
    !snapshot.archived &&
    !snapshot.accessDenied &&
    snapshot.sync.errorCode === null;
  const connectionId = live ? transport.getConnectionId() : null;
  const denied = useSyncExternalStore(
    transport?.subscribe ?? (() => () => {}),
    transport?.wasDenied ?? (() => false),
  );
  useEffect(() => {
    model.bind(connectionId, live);
    if (!live || transport === null) return;
    const receive = () => model.receive(scope, connectionId, transport.getSnapshot(), Date.now());
    const unsubscribe = transport.subscribe(receive);
    receive();
    return unsubscribe;
  }, [model, scope, transport, live, connectionId]);
  useEffect(() => {
    if (state.lease.expiresAt === null) return;
    const timer = setTimeout(
      () => model.expire(Date.now()),
      Math.max(0, Date.parse(state.lease.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [model, state.lease.expiresAt]);
  useEffect(
    () => () => {
      if (
        transport !== null &&
        transport.getConnectionId() !== null &&
        transport.getSnapshot().connectionId === transport.getConnectionId()
      )
        transport.release();
    },
    [transport],
  );
  // Render gate is immediate; effects cannot expose the prior namespace/connection for one frame.
  const current = live && state.live && state.connectionId === connectionId;
  const holder =
    current &&
    state.lease.connectionId !== null &&
    state.lease.expiresAt !== null &&
    Date.parse(state.lease.expiresAt) > Date.now();
  const ownsLease = holder && state.lease.connectionId === connectionId;
  const eligible = current && session?.canEdit() === true;
  const canBroadcast =
    eligible &&
    ownsLease &&
    snapshot?.sync?.pendingCount === 0 &&
    snapshot.writer.persistence?.pendingWrites === 0;
  return {
    model,
    state,
    transport,
    live: current,
    holder,
    ownsLease,
    eligible,
    canBroadcast,
    following: holder && state.following,
    denied,
  };
}
