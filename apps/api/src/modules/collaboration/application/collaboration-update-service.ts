import { createHash } from 'node:crypto';

import { ERROR_CODES, type ServerSequence } from '@archboard/contracts';
import * as Y from 'yjs';

import type { BoardPermissionService } from '../../boards/application/index.js';
import type { DurableUpdatePersistence } from './durable-update-persistence.js';
import type { DurableUpdateReceipt } from './durable-update.js';
import type { CandidateValidator } from './candidate-validator.js';
import {
  DURABLE_UPDATE_FAILPOINTS,
  DurableUpdateFailpointController,
  DurableUpdateRejectedError,
} from './durable-update.js';
import type { CollaborationRoom } from './room-registry.js';
import { reportCollaborationMetric } from './collaboration-metrics.js';

export interface RoomUpdateProposal {
  readonly actorUserId: string;
  readonly updateId: string;
  readonly updateBytes: Uint8Array;
}

export interface RoomUpdateResult {
  readonly sequence: ServerSequence;
  readonly duplicate: boolean;
}

export class CollaborationUpdateService {
  public constructor(
    private readonly persistence: DurableUpdatePersistence,
    private readonly permissions: BoardPermissionService,
    private readonly validator: CandidateValidator,
    private readonly failpoints = new DurableUpdateFailpointController(),
  ) {}

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
    const existing = await this.persistence.findReceipt(room.boardId, proposal.updateId);
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
    const started = performance.now();
    try {
      const result = await this.persistence.run(boardId, async (scope) => {
        const decision = await this.permissions.editGraph(
          scope.permissionTransaction,
          boardId,
          actorUserId,
        );
        if (!decision.allowed)
          throw new DurableUpdateRejectedError(decision.code, 'Board write unavailable.');

        const existing = await scope.findReceipt(updateId);
        if (existing !== null) {
          return {
            sequence: this.matchReceipt(existing, actorUserId, payloadHash),
            duplicate: true,
          };
        }

        const sequence = await scope.append(decision.board.latestSeq as ServerSequence, {
          updateId,
          actorUserId,
          updateBytes: exactBytes,
          payloadHash,
        });
        await this.failpoints.reach(DURABLE_UPDATE_FAILPOINTS.DATABASE_COMMIT);
        return { sequence, duplicate: false };
      });
      reportCollaborationMetric('collaboration.db_write', {
        durationMs: Math.round(performance.now() - started),
        duplicate: result.duplicate,
      });
      return result;
    } catch (error) {
      if (error instanceof DurableUpdateRejectedError) throw error;
      throw new DurableUpdateRejectedError(
        ERROR_CODES.PERSISTENCE_FAILED,
        'Update transaction failed.',
      );
    }
  }

  private matchReceipt(
    receipt: DurableUpdateReceipt,
    actorUserId: string,
    payloadHash: Buffer,
  ): ServerSequence {
    if (
      receipt.actorUserId !== actorUserId ||
      !Buffer.from(receipt.payloadHash).equals(payloadHash)
    ) {
      throw new DurableUpdateRejectedError(ERROR_CODES.UPDATE_ID_REUSED, 'Update ID reused.');
    }
    return receipt.sequence as ServerSequence;
  }
}
