import {
  checkpointSummarySchema,
  GRAPH_SCHEMA_VERSION,
  MAX_ENCODED_YJS_STATE_BYTES,
  ERROR_CODES,
  type CheckpointSummary,
} from '@archboard/contracts';
import type { EntityManager } from 'typeorm';
import { CheckpointEntity } from './entities/checkpoint.entity.js';
import { BoardServiceError } from '../application/board-service.js';

interface Row {
  id: string;
  boardId: string;
  name: string;
  throughSeq: string;
  schemaVersion: number;
  createdAt: string;
  creatorId: string;
  creatorName: string;
  creatorImage: string | null;
}

export class CheckpointRepository {
  public constructor(private readonly manager: EntityManager) {}
  private metadata(boardId: string) {
    return (
      this.manager
        .getRepository(CheckpointEntity)
        .createQueryBuilder('checkpoint')
        .select('checkpoint.id', 'id')
        .addSelect('checkpoint.board_id', 'boardId')
        .addSelect('checkpoint.name', 'name')
        .addSelect('checkpoint.through_seq', 'throughSeq')
        .addSelect('checkpoint.schema_version', 'schemaVersion')
        // Preserve PostgreSQL microseconds for stable timestamp/UUID pagination.
        .addSelect(
          `to_char(checkpoint.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
          'createdAt',
        )
        .innerJoin('user', 'creator', 'creator.id = checkpoint.created_by')
        .addSelect('creator.id', 'creatorId')
        .addSelect('creator.name', 'creatorName')
        .addSelect('creator.image', 'creatorImage')
        .where('checkpoint.board_id = :boardId', { boardId })
    );
  }
  private summaryRow(row: Row): CheckpointSummary {
    return checkpointSummarySchema.parse({
      id: row.id,
      boardId: row.boardId,
      name: row.name,
      throughSeq: row.throughSeq,
      schemaVersion: row.schemaVersion,
      createdAt: row.createdAt,
      createdBy: { id: row.creatorId, name: row.creatorName, image: row.creatorImage },
    });
  }
  public async summary(boardId: string, checkpointId: string): Promise<CheckpointSummary | null> {
    const row = await this.metadata(boardId)
      .andWhere('checkpoint.id = :checkpointId', { checkpointId })
      .getRawOne<Row>();
    return row ? this.summaryRow(row) : null;
  }
  public async list(
    boardId: string,
    limit: number,
    cursor?: { timestamp: string; id: string },
  ): Promise<CheckpointSummary[]> {
    const query = this.metadata(boardId)
      .orderBy('checkpoint.created_at', 'DESC')
      .addOrderBy('checkpoint.id', 'DESC')
      .limit(limit);
    if (cursor)
      query.andWhere(
        '(checkpoint.created_at, checkpoint.id) < (CAST(:timestamp AS timestamptz), CAST(:cursorId AS uuid))',
        { timestamp: cursor.timestamp, cursorId: cursor.id },
      );
    return (await query.getRawMany<Row>()).map((row) => this.summaryRow(row));
  }
  public count(boardId: string): Promise<number> {
    return this.manager.getRepository(CheckpointEntity).countBy({ boardId });
  }
  public async insert(
    boardId: string,
    createdBy: string,
    name: string,
    throughSeq: string,
    bytes: Uint8Array,
  ): Promise<CheckpointSummary> {
    const result = await this.manager
      .getRepository(CheckpointEntity)
      .createQueryBuilder()
      .insert()
      .values({
        boardId,
        createdBy,
        name,
        throughSeq,
        schemaVersion: GRAPH_SCHEMA_VERSION,
        updateBytes: Buffer.from(bytes),
        createdAt: () => 'CURRENT_TIMESTAMP',
      })
      .returning(['id'])
      .execute();
    const row = await this.summary(boardId, String((result.identifiers[0] as { id: string }).id));
    if (!row) throw new Error('Inserted checkpoint is missing.');
    return row;
  }
  public async bytes(
    boardId: string,
    checkpointId: string,
  ): Promise<{ bytes: Uint8Array; schemaVersion: number }> {
    const row = await this.manager
      .getRepository(CheckpointEntity)
      .createQueryBuilder('checkpoint')
      .select('checkpoint.schema_version', 'schemaVersion')
      .addSelect(
        'CASE WHEN octet_length(checkpoint.update_bytes) <= :maxBytes THEN checkpoint.update_bytes ELSE NULL END',
        'bytes',
      )
      .where('checkpoint.board_id = :boardId AND checkpoint.id = :checkpointId', {
        boardId,
        checkpointId,
      })
      .setParameter('maxBytes', MAX_ENCODED_YJS_STATE_BYTES)
      .getRawOne<{ bytes: Buffer | null; schemaVersion: number }>();
    if (!row) throw new BoardServiceError(ERROR_CODES.NOT_FOUND, 'Checkpoint not found.');
    if (!row.bytes)
      throw new BoardServiceError(
        ERROR_CODES.DOCUMENT_INVALID,
        'Checkpoint content is unavailable.',
      );
    return { bytes: row.bytes, schemaVersion: row.schemaVersion };
  }
}
