import {
  ERROR_CODES,
  GRAPH_SCHEMA_VERSION,
  MAX_CLIENT_UPDATE_BYTES,
  MAX_ENCODED_YJS_STATE_BYTES,
  serverSequenceSchema,
  type ErrorCode,
  type ServerSequence,
} from '@archboard/contracts';
import { validateGraphDocument } from '@archboard/document-model';
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, QueryRunner } from 'typeorm';
import * as Y from 'yjs';

import type { LoadedRoom, RoomLoader } from '../../application/room-registry.js';
import { assertCausallyComplete } from '../yjs-compatibility/index.js';

interface BoardRow {
  readonly latestSeq: string;
}

interface SnapshotRow {
  readonly schemaVersion: number;
  readonly throughSeq: string;
  readonly updateBytes: Buffer;
  readonly byteLength: number;
}

interface UpdateRow {
  readonly sequence: string;
  readonly updateBytes: Buffer;
}

const SEQUENCE_INCREMENT = 1n;

export class RoomLoadError extends Error {
  public constructor(public readonly code: ErrorCode) {
    super('Committed board content is unavailable.');
    this.name = 'RoomLoadError';
  }
}

@Injectable()
export class PostgresRoomLoader implements RoomLoader {
  public constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  public async load(boardId: string): Promise<LoadedRoom> {
    const runner = this.dataSource.createQueryRunner();
    try {
      await runner.connect();
      // All three reads observe the same committed board version even as another transaction writes.
      await runner.startTransaction('REPEATABLE READ');
      const loaded = await this.read(runner, boardId);
      await runner.commitTransaction();
      return loaded;
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
      if (error instanceof RoomLoadError) throw error;
      throw new RoomLoadError(ERROR_CODES.SERVER_BUSY);
    } finally {
      await runner.release().catch(() => undefined);
    }
  }

  private async read(runner: QueryRunner, boardId: string): Promise<LoadedRoom> {
    const board = (await runner.manager
      .createQueryBuilder()
      .select('board.latest_seq::text', 'latestSeq')
      .from('boards', 'board')
      .where('board.id = :boardId', { boardId })
      .getRawOne()) as BoardRow | undefined;
    if (board === undefined) throw new RoomLoadError(ERROR_CODES.NOT_FOUND);
    const latestSeq = this.sequence(board.latestSeq);

    const snapshot = (await runner.manager
      .createQueryBuilder()
      .select('snapshot.schema_version', 'schemaVersion')
      .addSelect('snapshot.through_seq::text', 'throughSeq')
      .addSelect('snapshot.update_bytes', 'updateBytes')
      .addSelect('snapshot.byte_length', 'byteLength')
      .from('board_snapshots', 'snapshot')
      .where('snapshot.board_id = :boardId', { boardId })
      .getRawOne()) as SnapshotRow | undefined;
    if (
      snapshot === undefined ||
      snapshot.schemaVersion !== GRAPH_SCHEMA_VERSION ||
      !Buffer.isBuffer(snapshot.updateBytes) ||
      snapshot.updateBytes.byteLength === 0 ||
      snapshot.byteLength !== snapshot.updateBytes.byteLength ||
      snapshot.byteLength > MAX_ENCODED_YJS_STATE_BYTES
    ) {
      throw new RoomLoadError(ERROR_CODES.DOCUMENT_INVALID);
    }
    const throughSeq = this.sequence(snapshot.throughSeq);
    if (BigInt(throughSeq) > BigInt(latestSeq))
      throw new RoomLoadError(ERROR_CODES.DOCUMENT_INVALID);

    const updates = (await runner.manager
      .createQueryBuilder()
      .select('entry.seq::text', 'sequence')
      .addSelect('entry.update_bytes', 'updateBytes')
      .from('board_updates', 'entry')
      .where('entry.board_id = :boardId', { boardId })
      .andWhere('entry.seq > CAST(:throughSeq AS bigint)', { throughSeq })
      .orderBy('entry.seq', 'ASC')
      .getRawMany()) as UpdateRow[];

    const document = new Y.Doc();
    try {
      Y.applyUpdate(document, snapshot.updateBytes);
      assertCausallyComplete(document);
      let expected = BigInt(throughSeq);
      for (const update of updates) {
        expected += SEQUENCE_INCREMENT;
        if (
          this.sequence(update.sequence) !== expected.toString() ||
          !Buffer.isBuffer(update.updateBytes) ||
          update.updateBytes.byteLength === 0 ||
          update.updateBytes.byteLength > MAX_CLIENT_UPDATE_BYTES
        ) {
          throw new RoomLoadError(ERROR_CODES.DOCUMENT_INVALID);
        }
        Y.applyUpdate(document, update.updateBytes);
        assertCausallyComplete(document);
        this.requireStateSize(document);
      }
      if (expected !== BigInt(latestSeq)) throw new RoomLoadError(ERROR_CODES.DOCUMENT_INVALID);
      this.requireStateSize(document);
      validateGraphDocument(document);
    } catch (error) {
      if (error instanceof RoomLoadError) throw error;
      throw new RoomLoadError(ERROR_CODES.DOCUMENT_INVALID);
    }
    return { document, latestSeq };
  }

  private sequence(value: unknown): ServerSequence {
    const parsed = serverSequenceSchema.safeParse(value);
    if (!parsed.success) throw new RoomLoadError(ERROR_CODES.DOCUMENT_INVALID);
    return parsed.data;
  }

  private requireStateSize(document: Y.Doc): void {
    if (Y.encodeStateAsUpdate(document).byteLength > MAX_ENCODED_YJS_STATE_BYTES) {
      throw new RoomLoadError(ERROR_CODES.DOCUMENT_LIMIT);
    }
  }
}
