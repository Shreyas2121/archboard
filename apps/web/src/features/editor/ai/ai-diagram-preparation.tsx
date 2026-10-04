import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AiDiagramProposal } from '@archboard/contracts';
import { Button } from '@/components/ui/button';
import type { EditorSession } from '@/features/editor/application';
import { prepareAiDiagramDraft, type AiDiagramDraft } from './ai-diagram-draft';

/** C11 prepares a detached draft. C12 owns preview and reviewed Apply. */
export function AiDiagramPreparation({
  proposal,
  session,
  allowed,
}: {
  readonly proposal: AiDiagramProposal;
  readonly session: EditorSession;
  readonly allowed: () => boolean;
}) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const operation = useRef<AbortController | null>(null);
  const [state, setState] = useState<{
    revision: number;
    proposal: AiDiagramProposal;
    busy: boolean;
    draft?: AiDiagramDraft;
    failed?: boolean;
  } | null>(null);
  useEffect(
    () => () => {
      operation.current?.abort();
    },
    [proposal, session, snapshot.revision],
  );
  const current =
    state?.revision === snapshot.revision && state.proposal === proposal ? state : null;
  return (
    <div className="grid gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={current?.busy || !!current?.draft || !session.canEdit()}
        onClick={async () => {
          if (!allowed() || !session.canEdit()) return;
          const source = session.captureGraphState();
          if (!source) return;
          operation.current?.abort();
          const abort = new AbortController();
          operation.current = abort;
          const revision = snapshot.revision;
          setState({ revision, proposal, busy: true });
          try {
            const draft = await prepareAiDiagramDraft(proposal, source, abort.signal);
            if (!abort.signal.aborted && allowed() && session.getSnapshot().revision === revision)
              setState({ revision, proposal, busy: false, draft });
          } catch {
            if (!abort.signal.aborted && allowed() && session.getSnapshot().revision === revision)
              setState({ revision, proposal, busy: false, failed: true });
          }
        }}
      >
        {current?.busy ? 'Preparing diagram draft…' : 'Prepare diagram draft'}
      </Button>
      {current?.draft && (
        <p role="status" className="text-xs">
          Draft prepared: {current.draft.graph.nodes.length} nodes,{' '}
          {current.draft.graph.edges.length} connections, {current.draft.graph.boundaries.length}{' '}
          boundaries.{' '}
          {current.draft.layout.status === 'fallback'
            ? `Grid fallback used (${current.draft.layout.reason}).`
            : 'Layered layout ready.'}{' '}
          The board has not changed.
        </p>
      )}
      {current?.failed && (
        <p role="alert" className="text-xs text-destructive">
          This proposal could not fit a valid diagram draft. The board has not changed.
        </p>
      )}
    </div>
  );
}
