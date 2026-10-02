import {
  ERROR_CODES,
  GRAPH_SCHEMA_VERSION,
  portableGraphProjectionSchema,
  type GraphProjection,
} from '@archboard/contracts';
import { projectGraphDocument } from '@archboard/document-model';
import type { QueryRunner } from 'typeorm';
import * as Y from 'yjs';
import {
  CommittedGraphReader,
  CommittedGraphReadError,
} from '../../application/committed-graph-reader.js';
import type { CommittedAnchorTransaction } from '../../application/committed-anchor-reader.js';
import { ValidationWorkerError, type ValidationWorkerPool } from '../validation-worker/index.js';
import { readCommittedGraph, requireCommittedRecords } from './committed-graph.js';

export class PostgresCommittedGraphReader extends CommittedGraphReader {
  public constructor(private readonly workers: ValidationWorkerPool) {
    super();
  }

  public async capture(
    transaction: CommittedAnchorTransaction,
    boardId: string,
    latestSeq: string,
  ): Promise<Uint8Array> {
    if (!transaction.isTransactionActive)
      throw new Error('Committed capture requires an active board transaction.');
    try {
      const records = await readCommittedGraph((transaction as QueryRunner).manager, boardId);
      requireCommittedRecords(records, latestSeq);
      const result = await this.workers.validate({
        acceptedState: records.snapshot.updateBytes,
        update: new Uint8Array(),
        reconstruction: {
          updates: records.updates.map((entry) => entry.updateBytes),
          remap: false,
        },
      });
      return result.candidateState;
    } catch (error) {
      throw this.safeError(error);
    }
  }

  public async project(bytes: Uint8Array, schemaVersion: number): Promise<GraphProjection> {
    const document = new Y.Doc();
    try {
      if (schemaVersion !== GRAPH_SCHEMA_VERSION) throw new Error('Unsupported checkpoint schema.');
      const result = await this.workers.validate({
        acceptedState: bytes,
        update: new Uint8Array(),
        reconstruction: { updates: [], remap: false },
      });
      Y.applyUpdate(document, result.candidateState);
      return portableGraphProjectionSchema.parse(projectGraphDocument(document));
    } catch (error) {
      throw this.safeError(error);
    } finally {
      document.destroy();
    }
  }

  private safeError(error: unknown): CommittedGraphReadError {
    return new CommittedGraphReadError(
      error instanceof ValidationWorkerError && error.retryable
        ? ERROR_CODES.TEMPORARILY_UNAVAILABLE
        : ERROR_CODES.DOCUMENT_INVALID,
      'Committed board content is unavailable.',
    );
  }
}
