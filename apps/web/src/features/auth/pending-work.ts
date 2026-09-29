import { createGraphDocument } from '@archboard/document-model';
import {
  LocalPersistenceAdapter,
  listBoardStorageNamespaceRecords,
  type PendingAccountBoard,
} from '@archboard/sync-client';

import { serializeRecoveryArtifact } from '@/features/editor/demo/recovery-download';

const CHUNK_SIZE = 32_768;

function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + CHUNK_SIZE)));
  return btoa(chunks.join(''));
}

export async function downloadPendingWork(boards: readonly PendingAccountBoard[]): Promise<void> {
  const entries = [];
  for (const board of boards) {
    const graphDocument = createGraphDocument();
    const adapter = LocalPersistenceAdapter.create({
      namespace: board.namespace,
      document: graphDocument,
      mode: 'read-only',
    });
    try {
      await adapter.initialize();
      const records = await listBoardStorageNamespaceRecords(board.namespace);
      const updateIds = records.outbox.map((record) => record.updateId).sort();
      if (JSON.stringify(updateIds) !== JSON.stringify(board.updateIds))
        throw new Error('Pending changes changed while preparing recovery.');
      entries.push({
        boardId: board.namespace.boardId,
        graphSchemaVersion: board.namespace.graphSchemaVersion,
        recovery: JSON.parse(
          serializeRecoveryArtifact(adapter.exportInMemoryProjection()),
        ) as unknown,
        outbox: records.outbox.map((record) => ({
          updateId: record.updateId,
          localSequence: record.localSequence,
          updateBase64: base64(record.updateBytes),
          payloadHashBase64: base64(record.payloadHash),
          initialState: record.initialState === true,
        })),
      });
    } finally {
      try {
        await adapter.close();
      } finally {
        graphDocument.destroy();
      }
    }
  }
  const value = JSON.stringify({
    format: 'archboard-account-recovery-v1',
    createdAt: new Date().toISOString(),
    boards: entries,
  });
  const blob = new Blob([value], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'archboard-account-recovery.json';
    anchor.rel = 'noopener';
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
