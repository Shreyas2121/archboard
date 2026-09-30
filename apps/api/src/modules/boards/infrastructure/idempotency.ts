import { createHash } from 'node:crypto';

import { ERROR_CODES } from '@archboard/contracts';
import type { DataSource, QueryRunner } from 'typeorm';

import { BoardTransaction } from './board-transaction.js';
import { ApiIdempotencyEntity } from './entities/api-idempotency.entity.js';

function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('Idempotent requests must contain only JSON values.');
}

export function canonicalRequestHash(request: unknown): Buffer {
  return createHash('sha256').update(canonicalize(request), 'utf8').digest();
}

export class IdempotencyConflictError extends Error {
  public readonly code = ERROR_CODES.IDEMPOTENCY_CONFLICT;
  public constructor() {
    super('This idempotency key was already used for a different request.');
  }
}

export interface IdempotencyResult<T> {
  readonly status: number;
  readonly body: T;
  readonly replayed: boolean;
}

export interface IdempotentEffect<T> {
  readonly status: number;
  readonly body: T;
  readonly replaySafeBody?: T;
}

export class IdempotencyRepository {
  public constructor(private readonly runner: QueryRunner) {}

  public async lock(actorUserId: string, operation: string, key: string): Promise<void> {
    // A transaction-scoped advisory lock serializes even the first insert, when no row exists.
    // Hash collisions only serialize unrelated requests; the primary key remains the authority.
    await this.runner.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
      JSON.stringify([actorUserId, operation, key]),
    ]);
  }

  public async findLive(
    actorUserId: string,
    operation: string,
    key: string,
  ): Promise<ApiIdempotencyEntity | null> {
    return this.runner.manager
      .getRepository(ApiIdempotencyEntity)
      .createQueryBuilder('receipt')
      .where('receipt.actor_user_id = :actorUserId', { actorUserId })
      .andWhere('receipt.operation = :operation', { operation })
      .andWhere('receipt.key = :key', { key })
      .andWhere('receipt.expires_at > CURRENT_TIMESTAMP')
      .getOne();
  }

  public async deleteExpired(actorUserId: string, operation: string, key: string): Promise<void> {
    await this.runner.manager
      .getRepository(ApiIdempotencyEntity)
      .createQueryBuilder()
      .delete()
      .where('actor_user_id = :actorUserId', { actorUserId })
      .andWhere('operation = :operation', { operation })
      .andWhere('key = :key', { key })
      .andWhere('expires_at <= CURRENT_TIMESTAMP')
      .execute();
  }

  public async store<T>(
    actorUserId: string,
    operation: string,
    key: string,
    hash: Buffer,
    status: number,
    body: T,
  ): Promise<void> {
    await this.runner.manager
      .getRepository(ApiIdempotencyEntity)
      .createQueryBuilder()
      .insert()
      .values({
        actorUserId,
        operation,
        key,
        requestHash: hash,
        responseStatus: status,
        responseJson: body as Record<string, unknown>,
        expiresAt: () => "CURRENT_TIMESTAMP + INTERVAL '24 hours'",
      })
      .execute();
  }
}

export class IdempotencyService {
  private readonly transactions: BoardTransaction;

  public constructor(dataSource: DataSource) {
    this.transactions = new BoardTransaction(dataSource);
  }

  public async execute<T>(
    actorUserId: string,
    operation: string,
    key: string,
    request: unknown,
    effect: (runner: QueryRunner) => Promise<IdempotentEffect<T>>,
    authorize?: (runner: QueryRunner) => Promise<void>,
  ): Promise<IdempotencyResult<T>> {
    const hash = canonicalRequestHash(request);
    return this.transactions.run(async (runner) => {
      const repository = new IdempotencyRepository(runner);
      await repository.lock(actorUserId, operation, key);
      // Board-scoped consumers recheck current authority before even disclosing a stored result.
      await authorize?.(runner);
      const stored = await repository.findLive(actorUserId, operation, key);
      if (stored) {
        if (!stored.requestHash.equals(hash)) throw new IdempotencyConflictError();
        return { status: stored.responseStatus, body: stored.responseJson as T, replayed: true };
      }
      await repository.deleteExpired(actorUserId, operation, key);
      const result = await effect(runner);
      await repository.store(
        actorUserId,
        operation,
        key,
        hash,
        result.status,
        result.replaySafeBody ?? result.body,
      );
      return { status: result.status, body: result.body, replayed: false };
    });
  }
}
