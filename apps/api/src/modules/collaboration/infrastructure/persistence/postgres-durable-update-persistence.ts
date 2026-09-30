import type { DataSource, EntityManager } from 'typeorm';
import type { ServerSequence } from '@archboard/contracts';
import type {
  DurableUpdatePersistence,
  DurableUpdateWriteScope,
} from '../../application/durable-update-persistence.js';
import type { DurableUpdateReceipt } from '../../application/durable-update.js';
import { BoardTransaction } from '../../../boards/infrastructure/board-transaction.js';
import { BoardEntity } from '../../../boards/infrastructure/entities/board.entity.js';
import { BoardUpdateEntity } from '../entities/board-update.entity.js';
import { UpdateReceiptEntity } from '../entities/update-receipt.entity.js';

const NEXT_SEQUENCE_INCREMENT = 1n;

export class PostgresDurableUpdatePersistence implements DurableUpdatePersistence {
  private readonly transactions: BoardTransaction;
  public constructor(private readonly dataSource: DataSource) {
    this.transactions = new BoardTransaction(dataSource);
  }

  public findReceipt(boardId: string, updateId: string): Promise<DurableUpdateReceipt | null> {
    return this.receipt(this.dataSource.manager, boardId, updateId);
  }

  public run<T>(boardId: string, work: (scope: DurableUpdateWriteScope) => Promise<T>): Promise<T> {
    return this.transactions.run((runner) =>
      work({
        permissionTransaction: runner,
        findReceipt: (updateId) => this.receipt(runner.manager, boardId, updateId),
        append: async (latestSeq, update) => {
          // The application's authority check holds this board's write lock on this runner.
          const sequence = (
            BigInt(latestSeq) + NEXT_SEQUENCE_INCREMENT
          ).toString() as ServerSequence;
          await runner.manager.getRepository(BoardEntity).update(
            { id: boardId },
            {
              latestSeq: sequence,
              contentUpdatedAt: () => 'CURRENT_TIMESTAMP',
            },
          );
          await runner.manager.getRepository(BoardUpdateEntity).insert({
            boardId,
            sequence,
            updateId: update.updateId,
            actorUserId: update.actorUserId,
            updateBytes: Buffer.from(update.updateBytes),
          });
          await runner.manager.getRepository(UpdateReceiptEntity).insert({
            boardId,
            sequence,
            updateId: update.updateId,
            actorUserId: update.actorUserId,
            payloadHash: Buffer.from(update.payloadHash),
          });
          return sequence;
        },
      }),
    );
  }

  private async receipt(
    manager: EntityManager,
    boardId: string,
    updateId: string,
  ): Promise<DurableUpdateReceipt | null> {
    const receipt = await manager
      .getRepository(UpdateReceiptEntity)
      .findOneBy({ boardId, updateId });
    return receipt === null ? null : { ...receipt, sequence: receipt.sequence as ServerSequence };
  }
}
