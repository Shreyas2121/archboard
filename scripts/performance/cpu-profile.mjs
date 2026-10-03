// CPU supporting evidence only. No browser imports, network, DB or secret-file loading.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpus, platform, release, totalmem } from 'node:os';
import { writeFile } from 'node:fs/promises';
import {
  createPerformanceGraphFixture,
  createTypicalGraphFixture,
  createLimitGraphFixture,
  allEntityGraphFixture,
  TEMPLATE_CHOICES,
  resolveTemplate,
  createInvalidContractFixtures,
  createPerformanceCapFixtures,
  PERFORMANCE_SEED,
} from '../../packages/fixtures/dist/index.js';
import {
  hydrateGraphDocument,
  editGraphText,
  projectGraphDocument,
  validateGraphDocument,
} from '../../packages/document-model/dist/index.js';
import {
  capturePortableEnvelope,
  serializePortableJson,
} from '../../packages/export/dist/index.js';
import * as Y from '../../packages/document-model/node_modules/yjs/dist/yjs.mjs';
import { summarize } from './report.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const samples = 20;
const warmup = 5;
const measure = (run) => {
  const times = [];
  for (let index = -warmup; index < samples; index++) {
    const started = performance.now();
    run();
    if (index >= 0) times.push(performance.now() - started);
  }
  return summarize(times);
};
const workloads = [
  ['typical', createTypicalGraphFixture()],
  ['limit', createLimitGraphFixture()],
  ['typical-text-history', createPerformanceGraphFixture('typical')],
  ['limit-text-history', createPerformanceGraphFixture('limit')],
  ['all-kind', allEntityGraphFixture],
  ...TEMPLATE_CHOICES.map(({ id }) => ['template-' + id, resolveTemplate(id)]),
];
const results = workloads.map(([name, graph]) => {
  const document = hydrateGraphDocument(graph);
  // Preserve subsequent deleted structures. Graph hashes are stable; hydration's
  // random Yjs client ID makes encoded hashes identifiers for this run only.
  const replay = new Y.Doc({ gc: false });
  Y.applyUpdate(replay, Y.encodeStateAsUpdate(document));
  replay.clientID = PERFORMANCE_SEED;
  const initialBytes = Y.encodeStateAsUpdate(replay).byteLength;
  let historyEdits = 0;
  if (name.endsWith('history')) {
    const node = graph.nodes.find(({ kind }) => kind === 'code');
    for (let index = 0; index < 100; index++) {
      editGraphText(
        replay,
        { entity: 'node', id: node.id, field: 'body' },
        { index: 0, deleteCount: 32, insert: String(index).padStart(32, 'x') },
      );
      historyEdits++;
    }
  }
  const projection = projectGraphDocument(replay);
  const encoded = Y.encodeStateAsUpdate(replay);
  const envelope = capturePortableEnvelope(
    {
      graph: projection,
      exportedAt: '2026-10-03T00:00:00.000Z',
      board: { title: 'Synthetic performance workload', description: '' },
    },
    {
      online: false,
      authoritative: false,
      persistencePending: false,
      outboxPending: false,
      acknowledged: false,
    },
  );
  const result = {
    name,
    seed: PERFORMANCE_SEED,
    graphSha256: digest(JSON.stringify(graph)),
    // Yjs hydration client IDs are random: encoded hashes identify this run only.
    encodedSha256: digest(encoded),
    encodedBytes: encoded.byteLength,
    initialBytes,
    historyEdits,
    counts: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      boundaries: graph.boundaries.length,
      steps: graph.steps.length,
    },
    jsonBytes: serializePortableJson(envelope).byteLength,
    projection: measure(() => projectGraphDocument(replay)),
    validation: measure(() => validateGraphDocument(replay)),
    portableExport: measure(() => serializePortableJson(envelope)),
  };
  document.destroy();
  replay.destroy();
  return result;
});
const report = {
  schemaVersion: 1,
  kind: 'CPU supporting evidence',
  acceptance: 'OPEN',
  build: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceTree: 'working tree; see enclosing evidence commit',
  environment: {
    node: process.version,
    os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    memoryBytes: totalmem(),
    browser: 'UNRUN (deferred by user)',
    postgres: 'UNRUN (deferred by user — until Version 1 implementation is complete)',
    region: 'local CPU only',
    network: 'none',
  },
  method: { warmup, samples, percentile: 'nearest rank', cache: 'warm', concurrency: 1 },
  workloads: results,
  capFamilies: createPerformanceCapFixtures().map(
    ({ family, cap, offset, accepted, candidate }) => {
      const metadata = {
        family,
        cap,
        offset,
        accepted,
        graphSha256: digest(JSON.stringify(candidate)),
        jsonBytes: Buffer.byteLength(JSON.stringify(candidate)),
      };
      if (!accepted) return metadata;
      const document = hydrateGraphDocument(candidate);
      const encodedBytes = Y.encodeStateAsUpdate(document).byteLength;
      document.destroy();
      return { ...metadata, encodedBytes };
    },
  ),
  hostileCases: createInvalidContractFixtures().map(({ name, schema }) => ({ name, schema })),
};
const output = process.argv[2];
if (!output) throw new Error('Provide a workspace JSON report output path.');
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(
  JSON.stringify({ kind: report.kind, workloads: results.length, acceptance: report.acceptance }),
);
