import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync, rmSync } from 'node:fs';
import ts from 'typescript';
import { hydrateGraphDocument } from '../packages/document-model/dist/index.js';
import * as current from '../packages/document-model/dist/commands/batch.js';
import { createLimitGraphFixture } from '../packages/fixtures/dist/index.js';

// Build shared packages first. Compare batch algorithms using identical helper validation.
const baselineRef = process.argv[2] ?? 'a0909baa11e3bd956f00224f6d8a8616c6f516cf';
const source = execFileSync(
  'git',
  ['show', `${baselineRef}:packages/document-model/src/commands/batch.ts`],
  { encoding: 'utf8' },
);
const temporary = new URL(
  `../packages/document-model/dist/commands/.fe11-baseline-${randomUUID()}.js`,
  import.meta.url,
);
const fixture = createLimitGraphFixture();
const selected = fixture.nodes.slice(0, 100);
const result = {
  baselineRef,
  rounds: 5,
  fixture: {
    nodes: fixture.nodes.length,
    edges: fixture.edges.length,
    boundaries: fixture.boundaries.length,
  },
  selected: selected.length,
};
try {
  writeFileSync(
    temporary,
    ts.transpile(source, { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }),
  );
  const baseline = await import(temporary.href);
  for (const [label, api] of [
    ['before', baseline],
    ['after', current],
  ]) {
    result[label] = {};
    for (const kind of ['geometry', 'deletion']) {
      const samples = [];
      for (let round = 0; round < result.rounds; round += 1) {
        const document = hydrateGraphDocument(fixture);
        const start = performance.now();
        if (kind === 'geometry')
          api.setGraphGeometry(document, {
            nodes: selected.map(({ id, position }) => ({ id, position })),
          });
        else api.deleteGraphObjects(document, { nodeIds: selected.map(({ id }) => id) });
        samples.push(performance.now() - start);
        document.destroy();
      }
      samples.sort((a, b) => a - b);
      result[label][kind] = {
        medianMs: samples[Math.floor(samples.length / 2)],
        samplesMs: samples,
      };
    }
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  rmSync(temporary, { force: true });
}
