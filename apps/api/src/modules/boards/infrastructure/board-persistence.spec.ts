import * as Y from 'yjs';

import { validateGraphDocument } from '@archboard/document-model';

import { createEmptyBoardSnapshot } from './empty-board-snapshot.js';
import { canonicalRequestHash } from './idempotency.js';

describe('board persistence primitives', () => {
  it('creates an exact schema-version-1 empty Yjs state that round-trips through validation', () => {
    const snapshot = createEmptyBoardSnapshot();
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.throughSeq).toBe('0');
    expect(snapshot.byteLength).toBe(snapshot.updateBytes.byteLength);
    const document = new Y.Doc();
    Y.applyUpdate(document, snapshot.updateBytes);
    expect(() => validateGraphDocument(document)).not.toThrow();
  });

  it('hashes canonical nested JSON and rejects non-JSON values', () => {
    expect(canonicalRequestHash({ b: ['two', { z: 3, a: 1 }], a: null })).toEqual(
      canonicalRequestHash({ a: null, b: ['two', { a: 1, z: 3 }] }),
    );
    expect(canonicalRequestHash({ a: 'one' })).not.toEqual(canonicalRequestHash({ a: 'two' }));
    expect(() => canonicalRequestHash({ a: undefined })).toThrow(TypeError);
  });
});
