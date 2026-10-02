import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const workspace = fileURLToPath(new URL('..', import.meta.url));
const apiModules = join(workspace, 'apps/api/src/modules');
const webRoot = join(workspace, 'apps/web');
const exactVersionPattern = /^\d+\.\d+\.\d+$/;
const sharedPackages = ['contracts', 'document-model', 'fixtures', 'sync-client', 'export'];
const allowedRuntimeDependencies = {
  export: new Set(['@archboard/contracts']),
  contracts: new Set(['zod']),
  'document-model': new Set(['@archboard/contracts', 'yjs']),
  fixtures: new Set(['@archboard/contracts']),
  'sync-client': new Set(['@archboard/contracts', '@archboard/document-model', 'idb', 'yjs']),
};
const expectedWorkspaceDependencies = {
  export: new Set(['@archboard/contracts']),
  contracts: new Set(),
  'document-model': new Set(['@archboard/contracts']),
  fixtures: new Set(['@archboard/contracts']),
  'sync-client': new Set(['@archboard/contracts', '@archboard/document-model']),
};
const testFileSuffixes = ['.test.ts', '.spec.ts', '.integration-spec.ts'];
const phase2ForbiddenImports = {
  export: ['react', 'react-dom', '@xyflow/react', 'zustand', '@nestjs/common', 'yjs'],
  contracts: ['react', 'react-dom', '@xyflow/react', 'zustand'],
  'document-model': ['react', 'react-dom', '@xyflow/react', 'zustand'],
  'sync-client': ['react', 'react-dom'],
};
const negativeFixtures = [
  { packageName: 'contracts', specifier: 'react' },
  { packageName: 'document-model', specifier: '@xyflow/react' },
  { packageName: 'document-model', specifier: 'zustand/vanilla' },
  { packageName: 'sync-client', specifier: 'react/jsx-runtime' },
];
const forbiddenWebTestDependencies = new Set([
  '@playwright/test',
  '@testing-library/jest-dom',
  '@testing-library/react',
  '@testing-library/user-event',
  '@vitest/browser-playwright',
  'playwright',
]);
const issues = [];
let checkedSourceFiles = 0;
let checkedImports = 0;

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : path.endsWith('.ts') ? [path] : [];
  });
}

function allFilesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() && ['coverage', 'dist', 'node_modules'].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? allFilesUnder(path) : [path];
  });
}

function isTestFile(path) {
  return testFileSuffixes.some((suffix) => path.endsWith(suffix));
}

function report(path, message) {
  issues.push(`${relative(workspace, path)}: ${message}`);
}

function readCatalog() {
  const path = join(workspace, 'pnpm-workspace.yaml');
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const catalogStart = lines.findIndex((line) => line === 'catalog:');
  const catalogEnd = lines.findIndex(
    (line, index) => index > catalogStart && line.length > 0 && !line.startsWith(' '),
  );
  const catalogLines = lines.slice(catalogStart + 1, catalogEnd === -1 ? undefined : catalogEnd);
  return new Map(
    catalogLines.flatMap((line) => {
      const match = /^\s{2}(.+): (\S+)$/.exec(line);
      if (match?.[1] === undefined || match[2] === undefined) return [];
      return [[match[1].replaceAll("'", ''), match[2]]];
    }),
  );
}

function inspectWebManifest() {
  const path = join(workspace, 'apps/web/package.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const catalog = readCatalog();
  const dependencies = Object.entries({
    ...(manifest.dependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
  });
  for (const [dependency, version] of dependencies) {
    if (forbiddenWebTestDependencies.has(dependency)) {
      report(path, `${dependency} is not allowed because apps/web has no automated test suite.`);
    }
    if (version === 'catalog:') {
      const catalogVersion = catalog.get(dependency);
      if (catalogVersion === undefined || !exactVersionPattern.test(catalogVersion)) {
        report(path, `${dependency} must resolve through the catalog to an exact version.`);
      }
    } else if (!exactVersionPattern.test(version)) {
      report(path, `${dependency} must use an exact pinned version.`);
    }
  }
  for (const scriptName of Object.keys(manifest.scripts ?? {})) {
    if (scriptName === 'test' || scriptName.startsWith('test:')) {
      report(path, `${scriptName} is not allowed because apps/web has no automated test suite.`);
    }
  }

  const forbiddenFiles = allFilesUnder(webRoot).filter((filePath) => {
    const name = basename(filePath);
    return (
      /\.(?:test|spec)\.[^.]+$/.test(name) ||
      name.startsWith('vitest.') ||
      name.startsWith('playwright.')
    );
  });
  for (const forbiddenFile of forbiddenFiles) {
    report(forbiddenFile, 'Automated frontend test files/configuration are not allowed.');
  }
}

function matchesPackage(specifier, packageName) {
  return specifier === packageName || specifier.startsWith(`${packageName}/`);
}

function forbiddenImportMessage(sourcePackage, specifier) {
  const forbiddenPackage = phase2ForbiddenImports[sourcePackage]?.find((packageName) =>
    matchesPackage(specifier, packageName),
  );
  return forbiddenPackage === undefined
    ? undefined
    : `${sourcePackage} must not import ${forbiddenPackage}.`;
}

function inspectManifest(name) {
  const path = join(workspace, 'packages', name, 'package.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const runtime = Object.entries(manifest.dependencies ?? {});
  const allowed = allowedRuntimeDependencies[name];
  for (const [dependency, version] of runtime) {
    if (!allowed.has(dependency)) report(path, `Unexpected runtime dependency ${dependency}.`);
    if (version !== 'workspace:*' && !exactVersionPattern.test(version)) {
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
    const forbiddenMessage = forbiddenImportMessage(sourcePackage, specifier);
    if (forbiddenMessage !== undefined) report(path, forbiddenMessage);
    if (!allowedRuntimeDependencies[sourcePackage].has(specifier)) {
      if (forbiddenMessage === undefined) {
        report(path, `Source imports ${specifier} outside its runtime dependency boundary.`);
      }
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

function verifyNegativeFixtures() {
  const failures = negativeFixtures.flatMap(({ packageName, specifier }) => {
    const fixtureSource = `import value from '${specifier}';`;
    const parsed = ts.createSourceFile(
      `${packageName}-${specifier.replaceAll('/', '-')}.negative.ts`,
      fixtureSource,
      ts.ScriptTarget.Latest,
      true,
    );
    const importedSpecifiers = parsed.statements.flatMap((statement) =>
      ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
        ? [statement.moduleSpecifier.text]
        : [],
    );
    return importedSpecifiers.some(
      (importedSpecifier) => forbiddenImportMessage(packageName, importedSpecifier) !== undefined,
    )
      ? []
      : [`Negative fixture did not reject ${packageName} importing ${specifier}.`];
  });
  issues.push(...failures);
  if (failures.length === 0) {
    process.stdout.write(
      `Phase 2 negative boundary fixtures pass: ${negativeFixtures.length} forbidden imports rejected.\n`,
    );
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
inspectWebManifest();
for (const path of filesUnder(apiModules)) inspectSource(path);
if (process.argv.includes('--negative-fixtures')) verifyNegativeFixtures();

if (issues.length > 0) {
  for (const issue of issues) process.stderr.write(`${issue}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Phase 1 dependency boundaries pass: ${sharedPackages.length} manifests, ${checkedSourceFiles} production source files, ${checkedImports} static imports.\n`,
  );
}
