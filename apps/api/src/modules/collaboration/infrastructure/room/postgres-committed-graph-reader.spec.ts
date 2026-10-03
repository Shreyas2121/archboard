import { ERROR_CODES } from '@archboard/contracts';
import { allEntityGraphFixture, normalizeGraphFixtureIds } from '@archboard/fixtures';
import { hydrateGraphDocument } from '@archboard/document-model';
import * as Y from 'yjs';
import { ValidationWorkerPool } from '../validation-worker/index.js';
import { PostgresCommittedGraphReader } from './postgres-committed-graph-reader.js';

const INVALID_BYTE = 255;
const UNSUPPORTED_SCHEMA = 2;

describe('committed checkpoint projection (real worker, no database)', () => {
  const workers = new ValidationWorkerPool();
  const reader = new PostgresCommittedGraphReader(workers);
  afterAll(async () => workers.close());
  it('derives all-kind content while retaining immutable source bytes', async () => {
    const document = hydrateGraphDocument(allEntityGraphFixture);
    const bytes = Y.encodeStateAsUpdate(document);
    document.destroy();
    const before = bytes.slice();
    expect(await reader.project(bytes, 1)).toEqual(allEntityGraphFixture);
    expect(bytes).toEqual(before);
    expect(await reader.project(bytes, 1)).toEqual(allEntityGraphFixture);
  });
  it('rejects malformed bytes and unsupported schema with a safe error', async () => {
    await expect(reader.project(new Uint8Array([INVALID_BYTE]), 1)).rejects.toMatchObject({
      code: ERROR_CODES.DOCUMENT_INVALID,
    });
    await expect(reader.project(new Uint8Array(), UNSUPPORTED_SCHEMA)).rejects.toMatchObject({
      code: ERROR_CODES.DOCUMENT_INVALID,
    });
  });
  it('requires a live transaction for committed capture', async () => {
    await expect(
      reader.capture({ isTransactionActive: false }, crypto.randomUUID(), '0'),
    ).rejects.toThrow('active board transaction');
  });
  it('copies through the caller transaction and real bounded worker with fresh IDs and unchanged input', async () => {
    const document = hydrateGraphDocument(allEntityGraphFixture);
    const bytes = Y.encodeStateAsUpdate(document);
    document.destroy();
    const before = bytes.slice();
    const query = {
      select: () => query,
      addSelect: () => query,
      from: () => query,
      where: () => query,
      andWhere: () => query,
      setParameter: () => query,
      orderBy: () => query,
      limit: () => query,
      getRawOne: async () => ({
        schemaVersion: 1,
        throughSeq: '0',
        updateBytes: bytes,
        byteLength: bytes.byteLength,
      }),
      getRawMany: async () => [],
    };
    const transaction = { isTransactionActive: true, manager: { createQueryBuilder: () => query } };
    const result = await reader.project(
      await reader.copy(transaction, crypto.randomUUID(), '0'),
      1,
    );
    expect(normalizeGraphFixtureIds(result)).toEqual(
      normalizeGraphFixtureIds(allEntityGraphFixture),
    );
    expect(
      result.nodes.every(
        (node) => !allEntityGraphFixture.nodes.some((source) => source.id === node.id),
      ),
    ).toBe(true);
    expect(bytes).toEqual(before);
    await expect(reader.copy(transaction, crypto.randomUUID(), '1')).rejects.toMatchObject({
      code: ERROR_CODES.DOCUMENT_INVALID,
    });
  });
});
