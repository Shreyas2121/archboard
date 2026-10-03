// Pure CPU/scheduling comparison; neither browser nor DB execution.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus, platform, release, totalmem } from 'node:os';
import ts from 'typescript';
import { codeToTokens } from '../../apps/web/node_modules/shiki/dist/bundle-web.mjs';
import { summarize } from './report.mjs';

const source = await readFile(
  new URL('../../apps/web/src/features/editor/cards/highlight-scheduler.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { HighlightScheduler } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
);
const code = 'export const synthetic = 804;\n'.repeat(300).slice(0, 8192);
const tokenize = () => codeToTokens(code, { lang: 'typescript', theme: 'github-light-default' });
await tokenize(); // Grammar/WASM load is excluded from the warm comparison.
const baseline = [];
const scheduled = [];
const samples = 20;
const warmup = 5;
const edits = 100;
for (let sample = -warmup; sample < samples; sample++) {
  let started = performance.now();
  // Previous effect cleanup only guarded publication; already requested work ran.
  for (let edit = 0; edit < edits; edit++) await tokenize();
  if (sample >= 0) baseline.push(performance.now() - started);
  started = performance.now();
  const scheduler = new HighlightScheduler();
  for (let edit = 0; edit < edits - 1; edit++)
    scheduler.schedule(async () => {
      await tokenize();
    })?.();
  await new Promise((resolve) =>
    scheduler.schedule(async () => {
      await tokenize();
      resolve();
    }),
  );
  if (sample >= 0) scheduled.push(performance.now() - started);
}
if (!process.argv[2]) throw new Error('Workspace report path required.');
await writeFile(
  process.argv[2],
  JSON.stringify(
    {
      schemaVersion: 1,
      kind: 'CPU supporting evidence',
      acceptance: 'OPEN',
      node: process.version,
      environment: {
        os: `${platform()} ${release()}`,
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        memoryBytes: totalmem(),
        browser: 'UNRUN (deferred by user)',
        region: 'local CPU only',
        network: 'none',
      },
      workload: {
        sourceSha256: createHash('sha256').update(source).digest('hex'),
        textCharacters: code.length,
        rapidEdits: edits,
        warmup,
        samples,
        grammar: 'typescript',
        theme: 'github-light-default',
      },
      baselineUncancelled: { tokenizationsPerBurst: edits, ...summarize(baseline) },
      scheduledCancelled: { tokenizationsPerBurst: 1, ...summarize(scheduled) },
      limitation:
        'Synthetic pre-drain edit burst; does not measure React commits, browser frames, continuous edits after work begins, or peer visibility.',
    },
    null,
    2,
  ) + '\n',
);
console.log('CPU highlight comparison recorded; A26 OPEN.');
