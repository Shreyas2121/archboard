import {
  MAX_BOARD_TITLE_CHARACTERS,
  MAX_BOARD_DESCRIPTION_CHARACTERS,
  type ExportEnvelope,
} from '@archboard/contracts';
import { capturePortableEnvelope } from '@archboard/export';
import type { ProjectContextDraft } from './project-context-policy';

/** Reuses normal private-board import and its existing authorization/idempotency path. */
export function projectContextEnvelope(
  draft: ProjectContextDraft,
  exportedAt: string,
): ExportEnvelope {
  return capturePortableEnvelope(
    {
      exportedAt,
      board: {
        title: draft.context.project.name.slice(0, MAX_BOARD_TITLE_CHARACTERS),
        description: draft.context.project.description.slice(0, MAX_BOARD_DESCRIPTION_CHARACTERS),
      },
      graph: draft.graph,
    },
    {
      online: false,
      authoritative: false,
      acknowledged: false,
      persistencePending: false,
      outboxPending: true,
    },
  );
}
