import { ERROR_CODES, GRAPH_SCHEMA_VERSION, MAX_CLIENT_UPDATE_BYTES } from '@archboard/contracts';
import { createGraphDocument, projectGraphDocument } from '@archboard/document-model';
import { jest } from '@jest/globals';
import * as Y from 'yjs';
import { createTypicalValidationFixture } from '../validation-worker/validation-worker.fixtures.js';
import { createCausalGapFixtures } from '../yjs-compatibility/causal-gap.fixtures.js';
import {
  requireCommittedRecords,
  reconstructGraphBytes,
  MAX_REPLAY_BYTES,
  MAX_REPLAY_RECORDS,
  type CommittedGraphRecords,
} from './committed-graph.js';

function records(): CommittedGraphRecords {
  const fixture = createTypicalValidationFixture();
  return {
    snapshot: {
      schemaVersion: GRAPH_SCHEMA_VERSION,
      throughSeq: '0',
      updateBytes: fixture.acceptedState,
      byteLength: fixture.acceptedState.length,
    },
    updates: [{ sequence: '1', updateBytes: fixture.update }],
  };
}

describe('shared committed graph reconstruction', () => {
  it.each([false, true])(
    'returns a valid graph with remap=%s and disposes temporary documents',
    (remap) => {
      const graph = records();
      requireCommittedRecords(graph, '1');
      const destroy = jest.spyOn(Y.Doc.prototype, 'destroy');
      let state: Uint8Array;
      try {
        state = reconstructGraphBytes(
          graph.snapshot.updateBytes,
          graph.updates.map((update) => update.updateBytes),
          remap,
        );
        expect(destroy).toHaveBeenCalledTimes(
          remap ? graph.updates.length + 1 : graph.updates.length,
        );
      } finally {
        destroy.mockRestore();
      }
      const doc = new Y.Doc();
      try {
        Y.applyUpdate(doc, state);
        expect(projectGraphDocument(doc).nodes.length).toBeGreaterThan(0);
      } finally {
        doc.destroy();
      }
    },
  );
  it.each(['gap', 'missing', 'ahead', 'oversized', 'byte-length'] as const)(
    'rejects %s records',
    (failure) => {
      const graph = records();
      const invalid =
        failure === 'gap'
          ? { ...graph, updates: [{ ...graph.updates[0]!, sequence: '2' }] }
          : failure === 'missing'
            ? { ...graph, updates: [] }
            : failure === 'ahead'
              ? { ...graph, snapshot: { ...graph.snapshot, throughSeq: '2' } }
              : failure === 'oversized'
                ? {
                    ...graph,
                    updates: [
                      { sequence: '1', updateBytes: new Uint8Array(MAX_CLIENT_UPDATE_BYTES + 1) },
                    ],
                  }
                : {
                    ...graph,
                    snapshot: { ...graph.snapshot, byteLength: graph.snapshot.byteLength + 1 },
                  };
      expect(() => requireCommittedRecords(invalid, '1')).toThrow(
        expect.objectContaining({ code: ERROR_CODES.DOCUMENT_INVALID }),
      );
    },
  );
  it.each(createCausalGapFixtures())(
    'rejects $name and releases the failed document',
    (fixture) => {
      const graph = records();
      const destroy = jest.spyOn(Y.Doc.prototype, 'destroy');
      try {
        expect(() =>
          reconstructGraphBytes(graph.snapshot.updateBytes, [fixture.dependentUpdate], false),
        ).toThrow();
        expect(destroy).toHaveBeenCalledTimes(1);
      } finally {
        destroy.mockRestore();
      }
    },
  );
  it('releases a document after malformed persisted bytes', () => {
    const graph = records();
    const destroy = jest.spyOn(Y.Doc.prototype, 'destroy');
    try {
      expect(() =>
        reconstructGraphBytes(graph.snapshot.updateBytes, [Uint8Array.from([0])], false),
      ).toThrow();
      expect(destroy).toHaveBeenCalledTimes(1);
    } finally {
      destroy.mockRestore();
    }
  });
  it('rejects oversized replay input before allocating a document', () => {
    const document = createGraphDocument();
    const snapshot = Y.encodeStateAsUpdate(document);
    document.destroy();
    expect(() =>
      reconstructGraphBytes(snapshot, [new Uint8Array(MAX_CLIENT_UPDATE_BYTES + 1)], false),
    ).toThrow(expect.objectContaining({ code: ERROR_CODES.DOCUMENT_LIMIT }));
  });
  it.each(['bytes', 'records'] as const)('bounds aggregate replay %s before decoding', (bound) => {
    const graph = records();
    const count =
      bound === 'records'
        ? MAX_REPLAY_RECORDS + 1
        : Math.ceil(MAX_REPLAY_BYTES / MAX_CLIENT_UPDATE_BYTES);
    const bytes = new Uint8Array(bound === 'records' ? 1 : MAX_CLIENT_UPDATE_BYTES);
    const updates = Array.from({ length: count }, (_, index) => ({
      sequence: String(index + 1),
      updateBytes: bytes,
    }));
    expect(() => requireCommittedRecords({ ...graph, updates }, String(count))).toThrow(
      expect.objectContaining({ code: ERROR_CODES.DOCUMENT_LIMIT }),
    );
    expect(() =>
      reconstructGraphBytes(
        graph.snapshot.updateBytes,
        updates.map((update) => update.updateBytes),
        false,
      ),
    ).toThrow(expect.objectContaining({ code: ERROR_CODES.DOCUMENT_LIMIT }));
  });
});
