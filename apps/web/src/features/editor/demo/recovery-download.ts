import type { ExportEnvelope, GraphProjection } from '@archboard/contracts';
import { capturePortableEnvelope, serializePortableJson } from '@archboard/export';
import { downloadPortableEnvelope } from '@/platform/download/portable-download';

export const RECOVERY_FORMAT_MARKER = 'archboard';
export const RECOVERY_FILE_NAME = 'archboard-local-recovery.json';
export type RecoveryArtifact = ExportEnvelope;
const RECOVERY_DURABILITY = {
  online: false,
  authoritative: false,
  acknowledged: false,
  persistencePending: true,
  outboxPending: true,
};

export function serializeRecoveryArtifact(
  projection: GraphProjection,
  createdAt = new Date(),
  board = { title: 'Local recovery', description: '' },
): string {
  return serializePortableJson(
    capturePortableEnvelope(
      {
        exportedAt: createdAt.toISOString(),
        board,
        graph: projection,
      },
      RECOVERY_DURABILITY,
    ),
  ).json;
}

export function downloadRecoveryArtifact(
  projection: GraphProjection,
  board = { title: 'Local recovery', description: '' },
): boolean {
  return downloadPortableEnvelope(
    capturePortableEnvelope(
      {
        exportedAt: new Date().toISOString(),
        board,
        graph: projection,
      },
      RECOVERY_DURABILITY,
    ),
  );
}
