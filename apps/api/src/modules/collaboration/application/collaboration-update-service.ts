import { createHash } from 'node:crypto';

import { ERROR_CODES, type ServerSequence } from '@archboard/contracts';
import { Injectable } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import * as Y from 'yjs';

import type { BoardPermissionService } from '../../boards/application/index.js';
import { BoardEntity } from '../../boards/infrastructure/entities/board.entity.js';
import { BoardTransaction } from '../../boards/infrastructure/board-transaction.js';
import { BoardUpdateEntity } from '../infrastructure/entities/board-update.entity.js';
import { UpdateReceiptEntity } from '../infrastructure/entities/update-receipt.entity.js';
import type { ValidationWorkerPool } from '../infrastructure/validation-worker/index.js';
import {
  DURABLE_UPDATE_FAILPOINTS,
  DurableUpdateFailpointController,
  DurableUpdateRejectedError,
} from './durable-update.js';
import type { CollaborationRoom } from './room-registry.js';

const NEXT_SEQUENCE_INCREMENT = 1n;

export interface RoomUpdateProposal {
  readonly actorUserId: string;
  readonly updateId: string;
  readonly updateBytes: Uint8Array;
}

export interface RoomUpdateResult {
  readonly sequence: ServerSequence;
  readonly duplicate: boolean;
}

@Injectable()
export class CollaborationUpdateService {
  private readonly transaction: BoardTransaction;

  public constructor(
    private readonly dataSource: DataSource,
    private readonly permissions: BoardPermissionService,
    private readonly validator: ValidationWorkerPool,
    private readonly failpoints = new DurableUpdateFailpointController(),
  ) {
    this.transaction = new BoardTransaction(dataSource);
  }

  /** The caller serializes this operation through the room queue. */
  public async accept(
    room: CollaborationRoom,
    proposal: RoomUpdateProposal,
  ): Promise<RoomUpdateResult> {
    const decision = await this.permissions.previewEditGraph(room.boardId, proposal.actorUserId);
    if (!decision.allowed)
      throw new DurableUpdateRejectedError(decision.code, 'Board write unavailable.');

    const exactBytes = Buffer.from(proposal.updateBytes);
    const payloadHash = createHash('sha256').update(exactBytes).digest();
    const existing = await this.findReceipt(
      this.dataSource.manager,
      room.boardId,
      proposal.updateId,
    );
    if (existing !== null) {
      return {
        sequence: this.matchReceipt(existing, proposal.actorUserId, payloadHash),
        duplicate: true,
      };
    }

    const validated = await this.validator.validate({
      acceptedState: Y.encodeStateAsUpdate(room.document),
      update: exactBytes,
    });
    const candidate = new Y.Doc();
    let installed = false;
    try {
      Y.applyUpdate(candidate, validated.candidateState);
      await this.failpoints.reach(DURABLE_UPDATE_FAILPOINTS.AFTER_VALIDATION_BEFORE_TRANSACTION);
      const persisted = await this.persist(
        room.boardId,
        proposal.updateId,
        proposal.actorUserId,
        exactBytes,
        payloadHash,
      );
      if (!persisted.duplicate) {
        room.installCommittedCandidate(candidate, persisted.sequence);
        installed = true;
      }
      await this.failpoints.reach(DURABLE_UPDATE_FAILPOINTS.AFTER_COMMIT_BEFORE_ACK);
      return persisted;
    } finally {
      if (!installed) candidate.destroy();
    }
  }

  private async persist(
    boardId: string,
    updateId: string,
    actorUserId: string,
    exactBytes: Buffer,
    payloadHash: Buffer,
  ): Promise<RoomUpdateResult> {
    try {
      return await this.transaction.run(async (runner) => {
        const decision = await this.permissions.editGraph(runner, boardId, actorUserId);
        if (!decision.allowed)
          throw new DurableUpdateRejectedError(decision.code, 'Board write unavailable.');

        const existing = await this.findReceipt(runner.manager, boardId, updateId);
        if (existing !== null) {
          return {
            sequence: this.matchReceipt(existing, actorUserId, payloadHash),
            duplicate: true,
          };
        }

        const sequence = (
          BigInt(decision.board.latestSeq) + NEXT_SEQUENCE_INCREMENT
        ).toString() as ServerSequence;
        await runner.manager
          .getRepository(BoardEntity)
          .update(
            { id: boardId },
            { latestSeq: sequence, contentUpdatedAt: () => 'CURRENT_TIMESTAMP' },
          );
        await runner.manager.getRepository(BoardUpdateEntity).insert({
          boardId,
          sequence,
          updateId,
          actorUserId,
          updateBytes: exactBytes,
        });
        await runner.manager.getRepository(UpdateReceiptEntity).insert({
          boardId,
          updateId,
          actorUserId,
          payloadHash,
          sequence,
        });
        await this.failpoints.reach(DURABLE_UPDATE_FAILPOINTS.DATABASE_COMMIT);
        return { sequence, duplicate: false };
      });
    } catch (error) {
      if (error instanceof DurableUpdateRejectedError) throw error;
      throw new DurableUpdateRejectedError(
        ERROR_CODES.PERSISTENCE_FAILED,
        'Update transaction failed.',
      );
    }
  }

  private findReceipt(
    manager: EntityManager,
    boardId: string,
    updateId: string,
  ): Promise<UpdateReceiptEntity | null> {
    return manager.getRepository(UpdateReceiptEntity).findOneBy({ boardId, updateId });
  }

  private matchReceipt(
    receipt: UpdateReceiptEntity,
    actorUserId: string,
    payloadHash: Buffer,
  ): ServerSequence {
    if (receipt.actorUserId !== actorUserId || !receipt.payloadHash.equals(payloadHash)) {
      throw new DurableUpdateRejectedError(ERROR_CODES.UPDATE_ID_REUSED, 'Update ID reused.');
    }
    return receipt.sequence as ServerSequence;
  }
}
