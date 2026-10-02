import {
  ERROR_CODES,
  GRAPH_SCHEMA_VERSION,
  MAX_CLIENT_UPDATE_BYTES,
  MAX_ENCODED_YJS_STATE_BYTES,
  MEBIBYTE,
  serverSequenceSchema,
  type ErrorCode,
} from '@archboard/contracts';
import {
  createFreshGraphUpdate,
  projectGraphDocument,
  validateGraphDocument,
} from '@archboard/document-model';
import type { EntityManager } from 'typeorm';
import * as Y from 'yjs';
import { assertCausallyComplete } from '../yjs-compatibility/index.js';

const REPLAY_MEBIBYTES = 64;
export const MAX_REPLAY_BYTES = REPLAY_MEBIBYTES * MEBIBYTE;
export const MAX_REPLAY_RECORDS = 10_000;
const READ_BATCH_SIZE = 32;
const SEQUENCE_INCREMENT = 1n;

export interface CommittedGraphRecords {
  readonly snapshot: {
    readonly schemaVersion: number;
    readonly throughSeq: string;
    readonly updateBytes: Uint8Array;
    readonly byteLength: number;
  };
  readonly updates: readonly { readonly sequence: string; readonly updateBytes: Uint8Array }[];
}

export class CommittedGraphError extends Error {
  public constructor(public readonly code: ErrorCode = ERROR_CODES.DOCUMENT_INVALID) {
    super('Committed board content is unavailable.');
  }
}

export function requireCommittedRecords(
  graph: CommittedGraphRecords | null,
  latestSeq: string,
): asserts graph is CommittedGraphRecords {
  if (
    !graph ||
    graph.snapshot.schemaVersion !== GRAPH_SCHEMA_VERSION ||
    !(graph.snapshot.updateBytes instanceof Uint8Array) ||
    graph.snapshot.byteLength === 0 ||
    graph.snapshot.byteLength !== graph.snapshot.updateBytes.byteLength ||
    graph.snapshot.byteLength > MAX_ENCODED_YJS_STATE_BYTES ||
    !serverSequenceSchema.safeParse(latestSeq).success ||
    !serverSequenceSchema.safeParse(graph.snapshot.throughSeq).success
  )
    throw new CommittedGraphError();
  let expected = BigInt(graph.snapshot.throughSeq);
  let bytes = graph.snapshot.byteLength;
  if (expected > BigInt(latestSeq)) throw new CommittedGraphError();
  if (graph.updates.length > MAX_REPLAY_RECORDS)
    throw new CommittedGraphError(ERROR_CODES.DOCUMENT_LIMIT);
  for (const update of graph.updates) {
    expected += SEQUENCE_INCREMENT;
    if (
      !serverSequenceSchema.safeParse(update.sequence).success ||
      update.sequence !== expected.toString() ||
      !(update.updateBytes instanceof Uint8Array) ||
      update.updateBytes.byteLength === 0 ||
      update.updateBytes.byteLength > MAX_CLIENT_UPDATE_BYTES
    )
      throw new CommittedGraphError();
    bytes += update.updateBytes.byteLength;
    if (bytes > MAX_REPLAY_BYTES) throw new CommittedGraphError(ERROR_CODES.DOCUMENT_LIMIT);
  }
  if (expected !== BigInt(latestSeq)) throw new CommittedGraphError();
}

/** Caller supplies its transaction manager: a repeatable-read room load or locked duplication. */
export async function readCommittedGraph(
  manager: EntityManager,
  boardId: string,
): Promise<CommittedGraphRecords | null> {
  const snapshot = await manager
    .createQueryBuilder()
    .select('snapshot.schema_version', 'schemaVersion')
    .addSelect('snapshot.through_seq::text', 'throughSeq')
    // Avoid copying corrupt oversized bytea records into the application.
    .addSelect(
      'CASE WHEN octet_length(snapshot.update_bytes) <= :maxBytes THEN snapshot.update_bytes ELSE NULL END',
      'updateBytes',
    )
    .addSelect('snapshot.byte_length', 'byteLength')
    .from('board_snapshots', 'snapshot')
    .where('snapshot.board_id = :boardId', { boardId })
    .setParameter('maxBytes', MAX_ENCODED_YJS_STATE_BYTES)
    .getRawOne<CommittedGraphRecords['snapshot']>();
  if (!snapshot) return null;
  if (
    !serverSequenceSchema.safeParse(snapshot.throughSeq).success ||
    !(snapshot.updateBytes instanceof Uint8Array) ||
    snapshot.schemaVersion !== GRAPH_SCHEMA_VERSION ||
    snapshot.byteLength === 0 ||
    snapshot.byteLength !== snapshot.updateBytes.byteLength
  )
    throw new CommittedGraphError();
  const updates: CommittedGraphRecords['updates'][number][] = [];
  let after = snapshot.throughSeq;
  let bytes = snapshot.updateBytes.byteLength;
  for (;;) {
    const batch = await manager
      .createQueryBuilder()
      .select('entry.seq::text', 'sequence')
      .addSelect(
        'CASE WHEN octet_length(entry.update_bytes) <= :maxBytes THEN entry.update_bytes ELSE NULL END',
        'updateBytes',
      )
      .from('board_updates', 'entry')
      .where('entry.board_id = :boardId', { boardId })
      .andWhere('entry.seq > CAST(:after AS bigint)', { after })
      .setParameter('maxBytes', MAX_CLIENT_UPDATE_BYTES)
      .orderBy('entry.seq', 'ASC')
      .limit(READ_BATCH_SIZE)
      .getRawMany<CommittedGraphRecords['updates'][number]>();
    for (const update of batch) {
      if (!(update.updateBytes instanceof Uint8Array)) throw new CommittedGraphError();
      bytes += update.updateBytes.byteLength;
      if (bytes > MAX_REPLAY_BYTES || updates.length >= MAX_REPLAY_RECORDS)
        throw new CommittedGraphError(ERROR_CODES.DOCUMENT_LIMIT);
      updates.push(update);
    }
    if (batch.length < READ_BATCH_SIZE) break;
    after = batch.at(-1)!.sequence;
  }
  return { snapshot, updates };
}

/** Runs in the bounded validation worker. Only final states are encoded, avoiding quadratic replay. */
export function reconstructGraphBytes(
  snapshot: Uint8Array,
  updates: readonly Uint8Array[],
  remap: boolean,
): Uint8Array {
  if (
    snapshot.byteLength > MAX_ENCODED_YJS_STATE_BYTES ||
    updates.length > MAX_REPLAY_RECORDS ||
    updates.some((update) => update.byteLength > MAX_CLIENT_UPDATE_BYTES) ||
    updates.reduce((bytes, update) => bytes + update.byteLength, snapshot.byteLength) >
      MAX_REPLAY_BYTES
  )
    throw new CommittedGraphError(ERROR_CODES.DOCUMENT_LIMIT);
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, snapshot);
    assertCausallyComplete(document);
    for (const update of updates) {
      Y.applyUpdate(document, update);
      assertCausallyComplete(document);
    }
    validateGraphDocument(document);
    const state = Y.encodeStateAsUpdate(document);
    if (state.byteLength > MAX_ENCODED_YJS_STATE_BYTES)
      throw new CommittedGraphError(ERROR_CODES.DOCUMENT_LIMIT);
    if (!remap) return state;
    const result = createFreshGraphUpdate(projectGraphDocument(document));
    if (result.byteLength > MAX_ENCODED_YJS_STATE_BYTES)
      throw new CommittedGraphError(ERROR_CODES.DOCUMENT_LIMIT);
    return result;
  } finally {
    document.destroy();
  }
}
