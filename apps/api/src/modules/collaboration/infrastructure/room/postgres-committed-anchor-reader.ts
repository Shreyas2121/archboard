import { ERROR_CODES, threadAnchorSchema } from '@archboard/contracts';
import { projectGraphDocument } from '@archboard/document-model';
import type { QueryRunner } from 'typeorm';
import * as Y from 'yjs';

import {
  CommittedAnchorError,
  CommittedAnchorReader,
  type CommittedAnchorTransaction,
  type ObjectThreadAnchor,
} from '../../application/committed-anchor-reader.js';
import {
  CommittedGraphError,
  readCommittedGraph,
  requireCommittedRecords,
} from './committed-graph.js';
import { ValidationWorkerError, type ValidationWorkerPool } from '../validation-worker/index.js';

const centerDivisor = 2;

export class PostgresCommittedAnchorReader extends CommittedAnchorReader {
  public constructor(private readonly workers: ValidationWorkerPool) {
    super();
  }

  public async resolve(
    transaction: CommittedAnchorTransaction,
    boardId: string,
    latestSeq: string,
    anchor: ObjectThreadAnchor,
  ): Promise<ObjectThreadAnchor> {
    if (!transaction.isTransactionActive)
      throw new Error('Committed anchors require a board transaction.');
    const document = new Y.Doc();
    try {
      // The board lock also serializes accepted graph writes and compaction, so the snapshot/log
      // pair remains consistent while the existing bounded worker reconstructs accepted state.
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
      Y.applyUpdate(document, result.candidateState);
      const graph = projectGraphDocument(document);
      let resolved: ObjectThreadAnchor;
      if (anchor.type === 'node') {
        const node = graph.nodes.find((entry) => entry.id === anchor.id);
        if (!node) throw this.missingTarget();
        resolved = { type: 'node', id: node.id, label: node.title, position: node.position };
      } else {
        const edge = graph.edges.find((entry) => entry.id === anchor.id);
        const source = graph.nodes.find((entry) => entry.id === edge?.sourceId);
        const target = graph.nodes.find((entry) => entry.id === edge?.targetId);
        if (!edge || !source || !target) throw this.missingTarget();
        resolved = {
          type: 'edge',
          id: edge.id,
          label: edge.label,
          position: {
            x:
              (source.position.x +
                source.size.width / centerDivisor +
                target.position.x +
                target.size.width / centerDivisor) /
              centerDivisor,
            y:
              (source.position.y +
                source.size.height / centerDivisor +
                target.position.y +
                target.size.height / centerDivisor) /
              centerDivisor,
          },
        };
      }
      if (!threadAnchorSchema.safeParse(resolved).success) {
        throw new CommittedAnchorError(
          ERROR_CODES.VALIDATION_ERROR,
          'The committed target is outside discussion coordinate bounds.',
        );
      }
      return resolved;
    } catch (error) {
      if (error instanceof CommittedAnchorError) throw error;
      if (error instanceof ValidationWorkerError && error.retryable) {
        throw new CommittedAnchorError(
          ERROR_CODES.TEMPORARILY_UNAVAILABLE,
          'Committed board content is temporarily unavailable.',
        );
      }
      if (error instanceof CommittedGraphError || error instanceof ValidationWorkerError) {
        throw new CommittedAnchorError(
          ERROR_CODES.DOCUMENT_INVALID,
          'Committed board content is invalid.',
        );
      }
      throw error;
    } finally {
      document.destroy();
    }
  }

  private missingTarget(): CommittedAnchorError {
    return new CommittedAnchorError(
      ERROR_CODES.VALIDATION_ERROR,
      'The discussion target is not in the committed board graph.',
    );
  }
}
