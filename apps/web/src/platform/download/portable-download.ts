import type { ExportEnvelope } from '@archboard/contracts';
import { serializePortableJson } from '@archboard/export';

export function downloadPortableEnvelope(envelope: ExportEnvelope): boolean {
  const serialized = serializePortableJson(envelope);
  const url = URL.createObjectURL(new Blob([serialized.json], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'archboard-local-recovery.json';
  anchor.rel = 'noopener';
  try {
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
  return serialized.reimportable;
}
