import { useEffect, useRef, useState } from 'react';
import type { EditorViewState } from './editor-view-state';
import { statusAnnouncement, StatusAnnouncementGate } from './status-announcement-policy';

export function EditorStatusAnnouncement({ state }: { readonly state: EditorViewState }) {
  const gate = useRef(new StatusAnnouncementGate());
  const [spoken, setSpoken] = useState('');
  const { message, urgent } = statusAnnouncement(state);
  useEffect(() => {
    const timer = window.setTimeout(
      () => {
        const accepted = gate.current.accept(message, Date.now());
        if (accepted !== null) setSpoken(accepted);
      },
      gate.current.delay(Date.now(), urgent),
    );
    return () => window.clearTimeout(timer);
  }, [message, urgent]);
  return (
    <p className="sr-only" role="status" aria-atomic="true">
      {spoken}
    </p>
  );
}
