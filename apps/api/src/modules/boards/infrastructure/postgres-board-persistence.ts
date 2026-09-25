import { In, type DataSource, type QueryRunner } from 'typeorm';

import {
  ERROR_CODES,
  GRAPH_SCHEMA_VERSION,
  MAX_ENCODED_YJS_STATE_BYTES,
  type BoardListQuery,
} from '@archboard/contracts';
import {
  DocumentValidationError,
  hydrateGraphDocument,
  projectGraphDocument,
  remapGraphProjection,
  validateGraphDocument,
} from '@archboard/document-model';
import * as Y from 'yjs';

import type { BoardPersistence, BoardView, BoardWriteScope } from '../application/board-service.js';
import { BoardServiceError } from '../application/board-service.js';
import {
  BoardRepository,
  BoardMemberRepository,
  CommittedGraphRepository,
  type BoardRecord,
} from './board-repositories.js';
import { BoardTransaction } from './board-transaction.js';
import { BoardEntity } from './entities/board.entity.js';
import { BoardMemberEntity } from './entities/board-member.entity.js';
import { createEmptyBoardSnapshot } from './empty-board-snapshot.js';
import { IdempotencyService } from './idempotency.js';

interface OwnerRow {
  id: string;
  name: string;
  image: string | null;
}
interface CountRow {
  boardId: string;
  count: number;
}

const SEQUENCE_INCREMENT = 1n;

export class PostgresBoardPersistence implements BoardPersistence {
  private readonly transactions: BoardTransaction;
  private readonly idempotency: IdempotencyService;

  public constructor(dataSource: DataSource) {
    this.transactions = new BoardTransaction(dataSource);
    this.idempotency = new IdempotencyService(dataSource);
  }

  public list(
    actorUserId: string,
    query: BoardListQuery,
    cursor?: { timestamp: string; id: string },
  ): Promise<BoardView[]> {
    return this.transactions.run(async (runner) => {
      const boards = await new BoardRepository(runner).listAccessible(
        actorUserId,
        query.archived,
        query.limit + 1,
        cursor ? { contentUpdatedAt: cursor.timestamp, id: cursor.id } : undefined,
        query.search,
      );
      return this.enrich(runner, boards, actorUserId);
    });
  }

  public load(boardId: string, actorUserId: string): Promise<BoardView | null> {
    return this.transactions.run(async (runner) => this.loadInside(runner, boardId, actorUserId));
  }

  public run<T>(work: (scope: BoardWriteScope) => Promise<T>): Promise<T> {
    return this.transactions.run((runner) => work(this.scope(runner)));
  }

  public idempotent<T>(
    actorUserId: string,
    operation: string,
    key: string,
    request: unknown,
    work: (scope: BoardWriteScope) => Promise<{ status: number; body: T }>,
  ): Promise<{ status: number; body: T; replayed: boolean }> {
    return this.idempotency.execute(actorUserId, operation, key, request, (runner) =>
      work(this.scope(runner)),
    );
  }

  private scope(runner: QueryRunner): BoardWriteScope {
    return {
      permissionTransaction: runner,
      lockOwnerAndCount: (actorUserId) =>
        this.transactions.lockUserAndCountActiveOwnedBoards(runner, actorUserId),
      create: async (actorUserId, title, description) =>
        (await new BoardRepository(runner).create(actorUserId, title, description)).id,
      createEmptySnapshot: (boardId) =>
        new CommittedGraphRepository(runner).createInitialSnapshot(
          boardId,
          createEmptyBoardSnapshot(),
        ),
      createSnapshot: (boardId, updateBytes) =>
        new CommittedGraphRepository(runner).createInitialSnapshot(boardId, {
          schemaVersion: GRAPH_SCHEMA_VERSION,
          throughSeq: '0',
          updateBytes: Buffer.from(updateBytes),
          byteLength: updateBytes.byteLength,
        }),
      loadCommittedGraph: async (boardId, latestSeq) => {
        const graph = await new CommittedGraphRepository(runner).load(boardId, latestSeq);
        if (
          !graph ||
          graph.snapshot.schemaVersion !== GRAPH_SCHEMA_VERSION ||
          BigInt(graph.snapshot.throughSeq) > BigInt(latestSeq) ||
          graph.snapshot.byteLength !== graph.snapshot.updateBytes.byteLength
        )
          throw new BoardServiceError(
            ERROR_CODES.DOCUMENT_INVALID,
            'Committed board content is invalid.',
          );
        const document = new Y.Doc();
        try {
          Y.applyUpdate(document, graph.snapshot.updateBytes);
          let expected = BigInt(graph.snapshot.throughSeq);
          for (const update of graph.updates) {
            expected += SEQUENCE_INCREMENT;
            if (BigInt(update.sequence) !== expected)
              throw new Error('Committed graph sequence has a gap.');
            Y.applyUpdate(document, update.updateBytes);
          }
          if (expected !== BigInt(latestSeq))
            throw new Error('Committed graph sequence is incomplete.');
          validateGraphDocument(document);
          const copy = hydrateGraphDocument(remapGraphProjection(projectGraphDocument(document)));
          validateGraphDocument(copy);
          const bytes = Y.encodeStateAsUpdate(copy);
          if (bytes.byteLength > MAX_ENCODED_YJS_STATE_BYTES)
            throw new BoardServiceError(
              ERROR_CODES.DOCUMENT_LIMIT,
              'Duplicated board content exceeds the size limit.',
            );
          return bytes;
        } catch (error) {
          if (error instanceof BoardServiceError) throw error;
          if (error instanceof DocumentValidationError)
            throw new BoardServiceError(error.code, 'Committed board content is invalid.');
          throw new BoardServiceError(
            ERROR_CODES.DOCUMENT_INVALID,
            'Committed board content is invalid.',
          );
        }
      },
      load: (boardId, actorUserId) => this.loadInside(runner, boardId, actorUserId),
      updateMetadata: async (boardId, title, description) => {
        await runner.manager
          .getRepository(BoardEntity)
          .createQueryBuilder()
          .update()
          .set({
            title,
            description,
            metadataVersion: () => 'metadata_version + 1',
            updatedAt: () => 'CURRENT_TIMESTAMP',
          })
          .where('id = :boardId', { boardId })
          .execute();
      },
      setArchived: async (boardId, archived) => {
        await runner.manager
          .getRepository(BoardEntity)
          .createQueryBuilder()
          .update()
          .set({
            archivedAt: () => (archived ? 'CURRENT_TIMESTAMP' : 'NULL'),
            metadataVersion: () => 'metadata_version + 1',
            updatedAt: () => 'CURRENT_TIMESTAMP',
          })
          .where('id = :boardId', { boardId })
          .execute();
      },
      listMembers: (boardId) => new BoardMemberRepository(runner).listSafe(boardId),
      getMember: (boardId, userId) => new BoardMemberRepository(runner).getSafe(boardId, userId),
      setMemberRole: (boardId, userId, role) =>
        new BoardMemberRepository(runner).setRole(boardId, userId, role),
      removeMember: (boardId, userId) => new BoardMemberRepository(runner).remove(boardId, userId),
    };
  }

  private async loadInside(
    runner: QueryRunner,
    boardId: string,
    actorUserId: string,
  ): Promise<BoardView | null> {
    const board = await new BoardRepository(runner).get(boardId);
    if (!board) return null;
    return (await this.enrich(runner, [board], actorUserId))[0] ?? null;
  }

  private async enrich(
    runner: QueryRunner,
    boards: readonly BoardRecord[],
    actorUserId: string,
  ): Promise<BoardView[]> {
    if (boards.length === 0) return [];
    const ids = boards.map((board) => board.id);
    const ownerIds = [...new Set(boards.map((board) => board.ownerUserId))];
    const owners = (await runner.manager
      .createQueryBuilder()
      .select('owner.id', 'id')
      .addSelect('owner.name', 'name')
      .addSelect('owner.image', 'image')
      .from('user', 'owner')
      .where('owner.id IN (:...ownerIds)', { ownerIds })
      .getRawMany()) as OwnerRow[];
    const members = await runner.manager.getRepository(BoardMemberEntity).find({
      where: { boardId: In(ids), userId: actorUserId },
    });
    const counts = (await runner.manager
      .createQueryBuilder()
      .select('member.board_id', 'boardId')
      .addSelect('count(*)::integer', 'count')
      .from('board_members', 'member')
      .where('member.board_id IN (:...ids)', { ids })
      .groupBy('member.board_id')
      .getRawMany()) as CountRow[];
    const ownerById = new Map(owners.map((owner) => [owner.id, owner]));
    const memberByBoard = new Map(members.map((member) => [member.boardId, member]));
    const countByBoard = new Map(counts.map((count) => [count.boardId, count.count]));
    return boards.map((board) => {
      const owner = ownerById.get(board.ownerUserId);
      if (!owner) throw new Error('Board owner is missing.');
      return {
        id: board.id,
        ownerUserId: board.ownerUserId,
        memberRole: memberByBoard.get(board.id)?.role ?? null,
        archivedAt: board.archivedAt,
        metadataVersion: board.metadataVersion,
        latestSeq: board.latestSeq,
        title: board.title,
        description: board.description,
        contentUpdatedAt: board.contentUpdatedAt,
        contentUpdatedAtCursor:
          'contentUpdatedAtCursor' in board
            ? (board.contentUpdatedAtCursor as string)
            : board.contentUpdatedAt.toISOString(),
        createdAt: board.createdAt,
        updatedAt: board.updatedAt,
        owner: { id: owner.id, name: owner.name, image: owner.image },
        memberCount: (countByBoard.get(board.id) ?? 0) + 1,
      };
    });
  }
}
