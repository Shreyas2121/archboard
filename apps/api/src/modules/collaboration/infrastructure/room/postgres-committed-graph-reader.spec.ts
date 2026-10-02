import { ERROR_CODES } from '@archboard/contracts';
import { allEntityGraphFixture } from '@archboard/fixtures';
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
});
