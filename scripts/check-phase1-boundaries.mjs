import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const workspace = fileURLToPath(new URL('..', import.meta.url));
const apiModules = join(workspace, 'apps/api/src/modules');
const sharedPackages = ['contracts', 'document-model', 'fixtures', 'sync-client'];
const allowedRuntimeDependencies = {
  contracts: new Set(['zod']),
  'document-model': new Set(['@archboard/contracts', 'yjs']),
  fixtures: new Set(['@archboard/contracts']),
  'sync-client': new Set(['@archboard/contracts', '@archboard/document-model', 'idb', 'yjs']),
};
const expectedWorkspaceDependencies = {
  contracts: new Set(),
  'document-model': new Set(['@archboard/contracts']),
  fixtures: new Set(['@archboard/contracts']),
  'sync-client': new Set(['@archboard/contracts', '@archboard/document-model']),
};
const testFileSuffixes = ['.test.ts', '.spec.ts', '.integration-spec.ts'];
const issues = [];
let checkedSourceFiles = 0;
let checkedImports = 0;

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : path.endsWith('.ts') ? [path] : [];
  });
}

function isTestFile(path) {
  return testFileSuffixes.some((suffix) => path.endsWith(suffix));
}

function report(path, message) {
  issues.push(`${relative(workspace, path)}: ${message}`);
}

function inspectManifest(name) {
  const path = join(workspace, 'packages', name, 'package.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const runtime = Object.entries(manifest.dependencies ?? {});
  const allowed = allowedRuntimeDependencies[name];
  for (const [dependency, version] of runtime) {
    if (!allowed.has(dependency)) report(path, `Unexpected runtime dependency ${dependency}.`);
    if (version !== 'workspace:*' && !/^\d+\.\d+\.\d+$/.test(version)) {
      report(path, `${dependency} must use an exact pinned version.`);
    }
  }
  const workspaceDependencies = new Set(
    runtime
      .filter(([dependency]) => dependency.startsWith('@archboard/'))
      .map(([dependency]) => dependency),
  );
  const expected = expectedWorkspaceDependencies[name];
  if (
    workspaceDependencies.size !== expected.size ||
    [...workspaceDependencies].some((dependency) => !expected.has(dependency))
  ) {
    report(path, 'Workspace runtime dependency graph differs from the Phase 1 boundary.');
  }
}

function inspectImport(path, specifier, sourcePackage) {
  checkedImports += 1;
  const source = relative(workspace, path).replaceAll('\\', '/').split('/');
  if (sourcePackage !== undefined && !specifier.startsWith('.')) {
    if (!allowedRuntimeDependencies[sourcePackage].has(specifier)) {
      report(path, `Source imports ${specifier} outside its runtime dependency boundary.`);
    }
    return;
  }

  if (!specifier.startsWith('.')) {
    if (
      source[0] === 'apps' &&
      source[1] === 'api' &&
      ['application', 'domain'].includes(source[5]) &&
      (specifier.startsWith('@nestjs/') ||
        ['typeorm', 'pg', 'ws', 'better-auth'].includes(specifier))
    ) {
      report(path, `${source[5]} imports infrastructure package ${specifier}.`);
    }
    return;
  }

  const importedPath = resolve(dirname(path), specifier.replace(/\.js$/, '.ts'));
  const target = relative(workspace, importedPath).replaceAll('\\', '/').split('/');
  if (source[0] !== 'apps' || source[1] !== 'api' || source[3] !== 'modules') return;
  if (target[0] !== 'apps' || target[1] !== 'api' || target[3] !== 'modules') return;

  if (source[4] !== target[4] && target.slice(5).join('/') !== 'application/index.ts') {
    report(path, `Cross-feature import of ${specifier} bypasses a public application API.`);
  }
  if (
    source[4] === target[4] &&
    ['application', 'domain'].includes(source[5]) &&
    ['infrastructure', 'presentation'].includes(target[5])
  ) {
    report(path, `${source[5]} imports its outer ${target[5]} layer.`);
  }
}

function inspectSource(path, sourcePackage) {
  if (isTestFile(path)) return;
  checkedSourceFiles += 1;
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  for (const statement of source.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      inspectImport(path, statement.moduleSpecifier.text, sourcePackage);
    }
  }
}

for (const packageName of sharedPackages) {
  inspectManifest(packageName);
  for (const path of filesUnder(join(workspace, 'packages', packageName, 'src'))) {
    inspectSource(path, packageName);
  }
}
for (const path of filesUnder(apiModules)) inspectSource(path);

if (issues.length > 0) {
  for (const issue of issues) process.stderr.write(`${issue}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Phase 1 dependency boundaries pass: ${sharedPackages.length} manifests, ${checkedSourceFiles} production source files, ${checkedImports} static imports.\n`,
  );
}
