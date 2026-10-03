import ts from 'typescript';

const sdkPackages = ['openai', '@anthropic-ai/sdk'];
const adapterPrefix = 'apps/api/src/modules/ai/infrastructure/providers/openai/';
const publicAiName = /^VITE_(?:.*_)?(?:AI|OPENAI|ANTHROPIC)(?:_|$)/;

export function aiImportViolation(path, specifier) {
  const normalized = path.replaceAll('\\', '/');
  const sdk = sdkPackages.find((name) => specifier === name || specifier.startsWith(`${name}/`));
  if (sdk === '@anthropic-ai/sdk')
    return 'Anthropic SDK is deferred; production supports OpenAI only.';
  if (sdk === 'openai' && !normalized.startsWith(adapterPrefix))
    return 'OpenAI SDK imports belong only in the backend OpenAI adapter.';
  if (
    normalized.startsWith('apps/web/') &&
    /(?:^|\/)(?:apps\/api|platform\/config\/ai-config|modules\/ai\/application)(?:\/|\.|$)/.test(
      specifier,
    )
  )
    return 'Frontend code cannot import server AI policy/configuration.';
  return undefined;
}

// Includes dynamic imports and require, not just static imports/exports.
export function aiSourceViolations(path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const violations = [];
  function visit(node) {
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      const issue = aiImportViolation(path, node.moduleReference.expression.text);
      if (issue) violations.push(issue);
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      const issue = aiImportViolation(path, node.argument.literal.text);
      if (issue) violations.push(issue);
    }
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const issue = aiImportViolation(path, node.moduleSpecifier.text);
      if (issue) violations.push(issue);
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const issue = aiImportViolation(path, node.arguments[0].text);
      if (issue) violations.push(issue);
    }
    if ((ts.isStringLiteral(node) || ts.isIdentifier(node)) && publicAiName.test(node.text))
      violations.push('AI settings and credentials cannot use VITE_* variables.');
    ts.forEachChild(node, visit);
  }
  visit(source);
  return [...new Set(violations)];
}

export function aiEnvironmentViolations(text) {
  return text.split(/\r?\n/).flatMap((line) => {
    const name = /^\s*([A-Z0-9_]+)\s*=/.exec(line)?.[1];
    return name && publicAiName.test(name)
      ? ['AI settings and credentials cannot use VITE_* variables.']
      : [];
  });
}

export function verifyAiNegativeFixtures() {
  const cases = [
    ['packages/contracts/src/ai/negative.ts', "type Client = import('openai').OpenAI;"],
    ['apps/api/src/modules/ai/application/negative.ts', "import Client = require('openai');"],
    ['packages/contracts/src/ai/negative.ts', "import type { Client } from 'openai';"],
    ['apps/api/src/modules/ai/application/negative.ts', "export { Client } from 'openai';"],
    ['apps/web/src/negative.tsx', "const client = import('openai');"],
    [
      'apps/api/src/modules/ai/infrastructure/negative.ts',
      "const client = require('openai/resources');",
    ],
    [
      'apps/api/src/modules/ai/infrastructure/providers/openai/negative.ts',
      "import Client from '@anthropic-ai/sdk';",
    ],
    ['apps/web/src/negative.ts', 'const value = import.meta.env.VITE_OPENAI_API_KEY;'],
    ['apps/web/src/negative.ts', "const value = process.env['VITE_AI_ENABLED'];"],
    [
      'apps/web/src/negative.ts',
      "import config from '../../../apps/api/src/platform/config/ai-config.js';",
    ],
  ];
  const failures = cases
    .filter(([path, text]) => aiSourceViolations(path, text).length === 0)
    .map(([path]) => `AI negative boundary fixture was accepted: ${path}`);
  if (aiEnvironmentViolations('VITE_AI_MODEL=fixture').length === 0)
    failures.push('AI public environment fixture was accepted.');
  if (
    aiSourceViolations(
      'apps/api/src/modules/ai/infrastructure/providers/openai/adapter.ts',
      "import Client from 'openai';",
    ).length !== 0
  )
    failures.push('OpenAI backend adapter import was incorrectly rejected.');
  return { failures, count: cases.length + 1 };
}
