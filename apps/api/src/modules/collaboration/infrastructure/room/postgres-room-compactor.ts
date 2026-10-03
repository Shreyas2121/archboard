import { MAX_ENCODED_YJS_STATE_BYTES, type ServerSequence } from '@archboard/contracts';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';

import type { BoardSequenceAccess } from '../../../boards/application/index.js';
import { PostgresTransaction } from '../../../../platform/database/postgres-transaction.js';
import { BoardSnapshotEntity } from '../entities/board-snapshot.entity.js';
import { BoardUpdateEntity } from '../entities/board-update.entity.js';
import { reportCollaborationMetric } from '../../application/collaboration-metrics.js';

export const COMPACTION_FAILPOINTS = {
  AFTER_SNAPSHOT_WRITE: 'afterSnapshotWrite',
  AFTER_UPDATE_DELETE: 'afterUpdateDelete',
  AFTER_COMMIT: 'afterCommit',
} as const;

export type CompactionFailpoint =
  (typeof COMPACTION_FAILPOINTS)[keyof typeof COMPACTION_FAILPOINTS];

@Injectable()
export class CompactionFailpointController {
  private armed: { stage: CompactionFailpoint; handler: () => Promise<void> } | undefined;

  public arm(stage: CompactionFailpoint, handler: () => Promise<void>): void {
    this.armed = { stage, handler };
  }

  public async reach(stage: CompactionFailpoint): Promise<void> {
    if (this.armed?.stage !== stage) return;
    const { handler } = this.armed;
    this.armed = undefined;
    await handler();
  }
}

@Injectable()
export class PostgresRoomCompactor {
  private readonly transactions: PostgresTransaction;

  public constructor(
    @InjectDataSource() dataSource: DataSource,
    private readonly failpoints: CompactionFailpointController,
    private readonly sequences: BoardSequenceAccess,
    admission?: RuntimeAdmission,
  ) {
    this.transactions = new PostgresTransaction(dataSource, admission);
  }

  public async compact(
    boardId: string,
    throughSeq: ServerSequence,
    state: Uint8Array,
  ): Promise<void> {
    const started = performance.now();
    const updateBytes = Buffer.from(state);
    if (updateBytes.byteLength === 0 || updateBytes.byteLength > MAX_ENCODED_YJS_STATE_BYTES) {
      throw new Error('Room snapshot exceeds the encoded state limit.');
    }
    await this.transactions.run(async (runner) => {
      const latestSeq = await this.sequences.lock(runner, boardId);
      if (latestSeq !== throughSeq) throw new Error('Room sequence changed before compaction.');
      const snapshot = await runner.manager
        .getRepository(BoardSnapshotEntity)
        .findOneBy({ boardId });
      if (!snapshot || BigInt(snapshot.throughSeq) > BigInt(throughSeq)) {
        throw new Error('Room snapshot is missing or ahead of the room.');
      }
      await runner.manager.getRepository(BoardSnapshotEntity).update(
        { boardId },
        {
          throughSeq,
          updateBytes,
          byteLength: updateBytes.byteLength,
          updatedAt: () => 'CURRENT_TIMESTAMP',
        },
      );
      await this.failpoints.reach(COMPACTION_FAILPOINTS.AFTER_SNAPSHOT_WRITE);
      await runner.manager
        .getRepository(BoardUpdateEntity)
        .createQueryBuilder()
        .delete()
        .where('board_id = :boardId', { boardId })
        .andWhere('seq <= CAST(:throughSeq AS bigint)', { throughSeq })
        .execute();
      await this.failpoints.reach(COMPACTION_FAILPOINTS.AFTER_UPDATE_DELETE);
    });
    await this.failpoints.reach(COMPACTION_FAILPOINTS.AFTER_COMMIT);
    reportCollaborationMetric('collaboration.compaction', {
      durationMs: Math.round(performance.now() - started),
      snapshotBytes: updateBytes.byteLength,
    });
  }
}
import type { RuntimeAdmission } from '../../../../platform/lifecycle/runtime-admission.js';
