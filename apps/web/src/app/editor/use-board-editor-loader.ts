import { useEffect, useRef, useState } from 'react';
import { selectLocalAccount } from '@archboard/sync-client';

import {
  BoardEditorLoader,
  type BoardEditorLoadState,
  type BoardLoadMode,
} from './board-editor-loader';

interface BoardEditorLoadOptions {
  readonly boardId: string;
  readonly accountId: string | null;
  readonly mode: BoardLoadMode;
  readonly forceReadOnly: boolean;
  readonly retryAttempt: number;
}

export function useBoardEditorLoader({
  boardId,
  accountId,
  mode,
  forceReadOnly,
  retryAttempt,
}: BoardEditorLoadOptions): BoardEditorLoadState {
  const deploymentOrigin = window.location.origin;
  let userId = accountId;
  let accountError = false;
  if (mode === 'offline') {
    try {
      userId =
        selectLocalAccount(deploymentOrigin, { kind: 'network-unavailable' })?.userId ?? null;
    } catch {
      userId = null;
      accountError = true;
    }
  }
  const enabled = mode !== 'none';
  const identity = JSON.stringify([
    deploymentOrigin,
    boardId,
    userId,
    forceReadOnly,
    retryAttempt,
    enabled,
  ]);
  const loader = useRef<BoardEditorLoader | null>(null);
  const [state, setState] = useState<BoardEditorLoadState & { identity: string }>({
    identity: '',
    session: null,
    boardTitle: 'Board',
    status: 'checking',
  });
  useEffect(() => {
    if (!enabled || userId === null) return;
    const current = new BoardEditorLoader(
      { deploymentOrigin, boardId, userId, forceReadOnly },
      (next) => setState({ ...next, identity }),
    );
    loader.current = current;
    setState({ identity, session: null, boardTitle: 'Board', status: 'checking' });
    return () => {
      if (loader.current === current) loader.current = null;
      void current.close();
    };
  }, [deploymentOrigin, boardId, userId, forceReadOnly, retryAttempt, enabled, identity]);
  useEffect(() => {
    if (mode !== 'none') void loader.current?.load(mode);
  }, [mode, identity]);

  if (enabled && userId === null) {
    return {
      session: null,
      boardTitle: 'Board',
      status: accountError ? 'cache-error' : 'no-account',
    };
  }
  return state.identity === identity
    ? state
    : { session: null, boardTitle: 'Board', status: 'checking' };
}
