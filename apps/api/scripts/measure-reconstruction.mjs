// Run after building the API: node scripts/measure-reconstruction.mjs
import {
  GRAPH_SCHEMA_VERSION,
  MAX_CONTENT_BODY_CHARACTERS,
  MAX_LIVE_NODES,
  MAX_ENCODED_YJS_STATE_BYTES,
} from '@archboard/contracts';
import { hydrateGraphDocument, validateGraphDocument } from '@archboard/document-model';
import { buildNode } from '@archboard/fixtures';
import * as Y from 'yjs';
import { reconstructGraphBytes } from '../dist/modules/collaboration/infrastructure/room/committed-graph.js';
import { ValidationWorkerPool } from '../dist/modules/collaboration/infrastructure/validation-worker/validation-worker-pool.js';

const LOG_RECORDS = 1_000;
const nodes = Array.from({ length: MAX_LIVE_NODES }, (_, index) => ({
  ...buildNode(index),
  kind: 'note',
  content: { body: 'x'.repeat(MAX_CONTENT_BODY_CHARACTERS) },
}));
const source = hydrateGraphDocument({
  schemaVersion: GRAPH_SCHEMA_VERSION,
  nodes,
  edges: [],
  boundaries: [],
  steps: [],
});
const pool = new ValidationWorkerPool();
try {
  validateGraphDocument(source);
  const snapshot = Y.encodeStateAsUpdate(source);
  if (snapshot.byteLength > MAX_ENCODED_YJS_STATE_BYTES)
    throw new Error('Fixture exceeds state limit.');
  const title = source.getMap('nodes').get(nodes[0].id).get('title');
  const updates = [];
  for (let index = 0; index < LOG_RECORDS; index++) {
    const vector = Y.encodeStateVector(source);
    source.transact(() => {
      title.delete(0, title.length);
      title.insert(0, `Revision ${index}`);
    });
    updates.push(Y.encodeStateAsUpdate(source, vector));
  }
  const results = {
    nodeCount: nodes.length,
    logRecords: updates.length,
    snapshotBytes: snapshot.byteLength,
    snapshotLimitBytes: MAX_ENCODED_YJS_STATE_BYTES,
    replayBytes:
      snapshot.byteLength + updates.reduce((total, update) => total + update.byteLength, 0),
    workerTimeoutMs: pool.timeoutMs,
  };
  const measure = async (name, operation) => {
    const start = performance.now();
    const state = await operation();
    results[name] = {
      wallMs: Math.round(performance.now() - start),
      resultBytes: state.byteLength,
    };
  };
  await measure('legacyPerUpdateEncoding', () => {
    const document = new Y.Doc();
    try {
      Y.applyUpdate(document, snapshot);
      for (const update of updates) {
        Y.applyUpdate(document, update);
        Y.encodeStateAsUpdate(document);
      }
      validateGraphDocument(document);
      return Y.encodeStateAsUpdate(document);
    } finally {
      document.destroy();
    }
  });
  await measure('sharedReplay', () => reconstructGraphBytes(snapshot, updates, false));
  await measure('sharedDuplication', () => reconstructGraphBytes(snapshot, updates, true));
  for (const remap of [false, true]) {
    await measure(
      remap ? 'workerDuplication' : 'workerReplay',
      async () =>
        (
          await pool.validate({
            acceptedState: snapshot,
            update: new Uint8Array(),
            reconstruction: { updates, remap },
          })
        ).candidateState,
    );
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  source.destroy();
  await pool.close();
}
