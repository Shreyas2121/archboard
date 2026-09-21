import { graphProjectionSchema, type GraphProjection } from '@archboard/contracts';

export const RECOVERY_FORMAT_MARKER = 'archboard-local-recovery-v1';
export const RECOVERY_FILE_NAME = 'archboard-local-recovery.json';
const JSON_INDENT_SPACES = 2;

export interface RecoveryArtifact {
  readonly format: typeof RECOVERY_FORMAT_MARKER;
  readonly createdAt: string;
  readonly state: 'local-only';
  readonly graph: GraphProjection;
}

export function serializeRecoveryArtifact(
  projection: GraphProjection,
  createdAt = new Date(),
): string {
  const artifact: RecoveryArtifact = {
    format: RECOVERY_FORMAT_MARKER,
    createdAt: createdAt.toISOString(),
    state: 'local-only',
    graph: graphProjectionSchema.parse(projection),
  };
  return JSON.stringify(artifact, null, JSON_INDENT_SPACES)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

export function downloadRecoveryArtifact(projection: GraphProjection): void {
  const blob = new Blob([serializeRecoveryArtifact(projection)], { type: 'application/json' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = RECOVERY_FILE_NAME;
  anchor.rel = 'noopener';
  try {
    anchor.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
