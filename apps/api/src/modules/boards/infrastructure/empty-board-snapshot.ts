import { GRAPH_SCHEMA_VERSION } from '@archboard/contracts';
import { createGraphDocument, validateGraphDocument } from '@archboard/document-model';
import * as Y from 'yjs';

export interface InitialBoardSnapshot {
  readonly schemaVersion: number;
  readonly throughSeq: '0';
  readonly updateBytes: Buffer;
  readonly byteLength: number;
}

export function createEmptyBoardSnapshot(): InitialBoardSnapshot {
  const document = createGraphDocument();
  validateGraphDocument(document);
  const updateBytes = Buffer.from(Y.encodeStateAsUpdate(document));
  const decoded = new Y.Doc();
  Y.applyUpdate(decoded, updateBytes);
  validateGraphDocument(decoded);
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    throughSeq: '0',
    updateBytes,
    byteLength: updateBytes.byteLength,
  };
}
