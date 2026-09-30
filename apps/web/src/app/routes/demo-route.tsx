import { useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';

import { EditorShell } from '@/app/editor/editor-shell';
import { useNarrowScreen } from '@/app/hooks/use-narrow-screen';
import { closeEditorSession, EditorSession, useEditorSession } from '@/features/editor/application';

interface SessionEditorProps {
  readonly session: EditorSession;
  readonly narrowScreen: boolean;
}

function SessionEditor({ session, narrowScreen }: SessionEditorProps) {
  const snapshot = useEditorSession(session);
  return <EditorShell narrowScreen={narrowScreen} session={session} sessionSnapshot={snapshot} />;
}

export function DemoRoute() {
  const narrowScreen = useNarrowScreen();
  const [session, setSession] = useState<EditorSession | null>(null);

  useEffect(() => {
    const current = new EditorSession({
      deploymentOrigin: window.location.origin,
      forceReadOnly: narrowScreen,
    });
    setSession(current);
    void current.open();
    return () => {
      void closeEditorSession(current);
    };
  }, [narrowScreen]);

  return (
    <ReactFlowProvider>
      {session === null ? (
        <EditorShell narrowScreen={narrowScreen} session={null} sessionSnapshot={null} />
      ) : (
        <SessionEditor narrowScreen={narrowScreen} session={session} />
      )}
    </ReactFlowProvider>
  );
}
