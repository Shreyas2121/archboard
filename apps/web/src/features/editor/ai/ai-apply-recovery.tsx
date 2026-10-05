import { useMemo } from 'react';
import { importBoardSchema } from '@archboard/contracts';
import { Button } from '@/components/ui/button';
import type { EditorSession } from '@/features/editor/application';
import { AiApplyJournal } from './ai-apply-intent';
import { AiNewBoard } from './ai-new-board';
import { AiDiagramPreview } from './ai-diagram-preview';

/** Reload restores safe run IDs or the original reviewed import; never starts inference. */
export function AiApplyRecovery({
  session,
  allowed,
  recover,
}: {
  readonly session: EditorSession;
  readonly allowed: () => boolean;
  readonly recover: (runId: string) => void;
}) {
  const journal = useMemo(
    () => new AiApplyJournal(session.getStorageNamespace(), localStorage),
    [session],
  );
  const scope = session.resourceScope;
  if (!scope || !allowed()) return null;
  try {
    const records = journal.list();
    return (
      <section className="grid gap-3" aria-label="Previous AI Apply intents">
        {Object.entries(records).map(([runId, record]) => {
          if (record.kind === 'scoped-edit')
            return (
              <p key={runId} className="break-all text-xs">
                Scoped edit: {runId}.{' '}
                {record.state === 'applied'
                  ? 'Applied locally; this record does not prove server acknowledgment.'
                  : 'An Apply attempt was recorded. Inspect current fields and persistence status; replay is blocked because its outcome may be uncertain.'}
              </p>
            );
          const locallyApplied =
            record.state === 'applied' || session.inspectAiCreatedIds(record.ids) === 'present';
          const body = record.import?.json
            ? importBoardSchema.parse(JSON.parse(record.import.json))
            : null;
          return (
            <div key={runId} className="grid gap-2 rounded-lg border p-3">
              <p className="break-all text-xs">
                Original proposal: {runId}.{' '}
                {locallyApplied
                  ? 'Applied locally previously; this record does not prove server acknowledgment.'
                  : 'Original Apply IDs retained. Recovery checks existing IDs before any mutation.'}
              </p>
              {record.newBoardId && (
                <p className="break-all text-xs">
                  New board creation confirmed: {record.newBoardId}.
                </p>
              )}
              {record.import && !body && (
                <p className="text-xs">
                  The original import retry window expired. Its private payload was removed. Inspect
                  existing boards before explicitly starting any new creation; the original outcome
                  may be unknown.
                </p>
              )}
              {body ? (
                <>
                  <p className="text-sm">Original reviewed import: {body.title}</p>
                  <AiDiagramPreview graph={body.file.graph} />
                  <AiNewBoard
                    accountId={scope.accountId}
                    boardId={scope.boardId}
                    runId={runId}
                    journal={journal}
                    allowed={allowed}
                    draft={{ graph: body.file.graph, ids: record.ids }}
                  />
                </>
              ) : (
                !locallyApplied && (
                  <Button type="button" variant="outline" onClick={() => recover(runId)}>
                    Recover original result and review Apply
                  </Button>
                )
              )}
            </div>
          );
        })}
      </section>
    );
  } catch {
    return (
      <p role="alert" className="text-xs text-destructive">
        Local Apply recovery could not be read. No replacement batch is created automatically.
      </p>
    );
  }
}
