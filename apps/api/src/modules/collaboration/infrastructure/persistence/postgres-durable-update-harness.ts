import { createHash } from 'node:crypto';

import { ERROR_CODES, type ErrorCode, type ServerSequence } from '@archboard/contracts';
import { DocumentValidationError, validateGraphDocument } from '@archboard/document-model';
import { DataSource, type QueryRunner } from 'typeorm';
import * as Y from 'yjs';

import type {
  BoardPermissionService,
  BoardPermissionDecision,
} from '../../../boards/application/index.js';
import {
  DURABLE_UPDATE_FAILPOINTS,
  DurableUpdateFailpointController,
  DurableUpdateRejectedError,
  type DurableUpdateAcceptance,
  type DurableUpdateReceipt,
  type ProposedDurableUpdate,
  type UpdateSessionAuthenticator,
} from '../../application/index.js';
import {
  CausallyIncompleteUpdateError,
  YjsCausalCompatibilityError,
  assertCausallyComplete,
} from '../yjs-compatibility/index.js';

interface ReceiptRow {
  readonly actor_user_id: string;
  readonly created_at: Date;
  readonly payload_hash: Buffer;
  readonly seq: string;
}

interface SequenceRow {
  readonly content_updated_at: Date;
  readonly sequence: string;
}

interface TransactionResult {
  readonly receipt: DurableUpdateReceipt;
  readonly duplicate: boolean;
}

const SHA_256 = 'sha256';

function rejection(code: ErrorCode, message: string): DurableUpdateRejectedError {
  return new DurableUpdateRejectedError(code, message);
}

function cloneDocument(source: Y.Doc): Y.Doc {
  const clone = new Y.Doc();
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(source));
  return clone;
}

function hashUpdate(updateBytes: Uint8Array): Buffer {
  return createHash(SHA_256).update(updateBytes).digest();
}

function receiptFromRow(boardId: string, updateId: string, row: ReceiptRow): DurableUpdateReceipt {
  return Object.freeze({
    boardId,
    updateId,
    actorUserId: row.actor_user_id,
    payloadHash: Uint8Array.from(row.payload_hash),
    sequence: row.seq as ServerSequence,
    createdAt: new Date(row.created_at),
  });
}

export class PostgresDurableUpdateHarness {
  private acceptedDocument: Y.Doc;
  private acceptanceTail: Promise<void> = Promise.resolve();

  public constructor(
    private readonly boardId: string,
    acceptedDocument: Y.Doc,
    private readonly dataSource: DataSource,
    private readonly authenticator: UpdateSessionAuthenticator,
    private readonly permissions: BoardPermissionService,
    private readonly failpoints = new DurableUpdateFailpointController(),
  ) {
    validateGraphDocument(acceptedDocument);
    this.acceptedDocument = cloneDocument(acceptedDocument);
  }

  public accept(proposal: ProposedDurableUpdate): Promise<DurableUpdateAcceptance> {
    const operation = this.acceptanceTail.then(() => this.acceptSerialized(proposal));
    this.acceptanceTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  public acceptedStateAsUpdate(): Uint8Array {
    return Y.encodeStateAsUpdate(this.acceptedDocument);
  }

  private async acceptSerialized(
    proposal: ProposedDurableUpdate,
  ): Promise<DurableUpdateAcceptance> {
    if (proposal.boardId !== this.boardId) {
      throw rejection(ERROR_CODES.FORBIDDEN, 'The update is for a different board.');
    }

    const actor = await this.authenticator.authenticate(proposal.sessionToken);
    if (actor === null) {
      throw rejection(ERROR_CODES.UNAUTHENTICATED, 'An authenticated session is required.');
    }

    await this.requireGraphAuthority(actor.userId);
    const exactBytes = Buffer.from(proposal.updateBytes);
    const payloadHash = hashUpdate(exactBytes);
    const existing = await this.findReceipt(this.dataSource, proposal.updateId);
    if (existing !== undefined) {
      return this.acceptedRetry(proposal.updateId, actor.userId, payloadHash, existing);
    }

    const candidate = cloneDocument(this.acceptedDocument);
    try {
      Y.applyUpdate(candidate, exactBytes);
      assertCausallyComplete(candidate);
      validateGraphDocument(candidate, this.acceptedDocument);
    } catch (error) {
      if (error instanceof CausallyIncompleteUpdateError) {
        throw rejection(ERROR_CODES.CAUSAL_GAP, error.message);
      }
      if (error instanceof DocumentValidationError) {
        throw rejection(ERROR_CODES.DOCUMENT_INVALID, error.message);
      }
      if (error instanceof YjsCausalCompatibilityError) throw error;
      throw rejection(ERROR_CODES.DOCUMENT_INVALID, 'The Yjs update could not be applied.');
    }

    await this.failpoints.reach(DURABLE_UPDATE_FAILPOINTS.AFTER_VALIDATION_BEFORE_TRANSACTION);
    const persisted = await this.persistCandidate(
      proposal.updateId,
      actor.userId,
      exactBytes,
      payloadHash,
    );
    if (!persisted.duplicate) this.acceptedDocument = candidate;

    await this.failpoints.reach(DURABLE_UPDATE_FAILPOINTS.AFTER_COMMIT_BEFORE_ACK);
    return Object.freeze({
      receipt: persisted.receipt,
      acknowledgementEligible: true,
      broadcastEligible: !persisted.duplicate,
    });
  }

  private async persistCandidate(
    updateId: string,
    actorUserId: string,
    updateBytes: Buffer,
    payloadHash: Buffer,
  ): Promise<TransactionResult> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await this.requireGraphAuthority(actorUserId, runner);
      const existing = await this.findReceipt(runner, updateId);
      if (existing !== undefined) {
        const receipt = this.requireMatchingReceipt(updateId, actorUserId, payloadHash, existing);
        await runner.commitTransaction();
        return { receipt, duplicate: true };
      }

      const sequences = (await runner.manager.query(
        `WITH advanced_board AS (
           UPDATE "boards"
           SET "latest_seq" = "latest_seq" + 1,
               "content_updated_at" = CURRENT_TIMESTAMP
           WHERE "id" = $1
           RETURNING "latest_seq", "content_updated_at"
         )
         SELECT "latest_seq"::text AS "sequence", "content_updated_at"
         FROM advanced_board`,
        [this.boardId],
      )) as SequenceRow[];
      const sequence = sequences[0];
      if (sequence === undefined) {
        throw rejection(ERROR_CODES.FORBIDDEN, 'The board is unavailable.');
      }

      const receiptRows = (await runner.manager.query(
        `WITH inserted_update AS (
           INSERT INTO "board_updates"
             ("board_id", "seq", "update_id", "actor_user_id", "update_bytes")
           VALUES ($1, $2, $3, $4, $5)
         )
         INSERT INTO "update_receipts"
           ("board_id", "update_id", "actor_user_id", "payload_hash", "seq")
         VALUES ($1, $3, $4, $6, $2)
         RETURNING "actor_user_id", "payload_hash", "seq"::text, "created_at"`,
        [this.boardId, sequence.sequence, updateId, actorUserId, updateBytes, payloadHash],
      )) as ReceiptRow[];
      const receiptRow = receiptRows[0];
      if (receiptRow === undefined)
        throw new Error('PostgreSQL did not return the update receipt.');

      await this.failpoints.reach(DURABLE_UPDATE_FAILPOINTS.DATABASE_COMMIT);
      await runner.commitTransaction();
      return {
        receipt: receiptFromRow(this.boardId, updateId, receiptRow),
        duplicate: false,
      };
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      if (error instanceof DurableUpdateRejectedError) throw error;
      throw rejection(ERROR_CODES.PERSISTENCE_FAILED, 'The update transaction did not commit.');
    } finally {
      await runner.release();
    }
  }

  private async requireGraphAuthority(actorUserId: string, runner?: QueryRunner): Promise<void> {
    const decision: BoardPermissionDecision =
      runner === undefined
        ? await this.permissions.previewEditGraph(this.boardId, actorUserId)
        : await this.permissions.editGraph(runner, this.boardId, actorUserId);
    if (!decision.allowed) throw rejection(decision.code, 'Board graph write unavailable.');
  }

  private async findReceipt(
    executor: DataSource | QueryRunner,
    updateId: string,
  ): Promise<ReceiptRow | undefined> {
    const query = `SELECT "actor_user_id", "payload_hash", "seq"::text, "created_at"
       FROM "update_receipts"
       WHERE "board_id" = $1 AND "update_id" = $2`;
    const rows = (await (executor instanceof DataSource
      ? executor.query(query, [this.boardId, updateId])
      : executor.manager.query(query, [this.boardId, updateId]))) as ReceiptRow[];
    return rows[0];
  }

  private acceptedRetry(
    updateId: string,
    actorUserId: string,
    payloadHash: Buffer,
    existing: ReceiptRow,
  ): DurableUpdateAcceptance {
    return Object.freeze({
      receipt: this.requireMatchingReceipt(updateId, actorUserId, payloadHash, existing),
      acknowledgementEligible: true,
      broadcastEligible: false,
    });
  }

  private requireMatchingReceipt(
    updateId: string,
    actorUserId: string,
    payloadHash: Buffer,
    existing: ReceiptRow,
  ): DurableUpdateReceipt {
    if (existing.actor_user_id !== actorUserId || !existing.payload_hash.equals(payloadHash)) {
      throw rejection(
        ERROR_CODES.UPDATE_ID_REUSED,
        'The update ID was already used by another actor or payload.',
      );
    }
    return receiptFromRow(this.boardId, updateId, existing);
  }
}
