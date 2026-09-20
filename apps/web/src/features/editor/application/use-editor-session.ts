import { useSyncExternalStore } from 'react';

import { type EditorSession, type EditorSessionSnapshot } from './editor-session';

export function useEditorSession(session: EditorSession): EditorSessionSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
}
