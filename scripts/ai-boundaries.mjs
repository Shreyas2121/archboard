import ts from 'typescript';
import { posix } from 'node:path';

const sdkPackages = ['openai', '@anthropic-ai/sdk'];
const adapterPrefix = 'apps/api/src/modules/ai/infrastructure/providers/openai/';
const fixturePrefix = 'apps/api/src/modules/ai/infrastructure/testing/';
const publicAiName = /^VITE_(?:.*_)?(?:AI|OPENAI|ANTHROPIC)(?:_|$)/;
const isTest = (path) => /\.(?:spec|test|integration-spec)\.[cm]?[jt]sx?$/.test(path);
const isApplication = (path) =>
  /^apps\/api\/src\/modules\/[^/]+\/(?:application|domain)\//.test(path);
const isNeutral = (path) =>
  isApplication(path) || path.startsWith('packages/') || path.startsWith('apps/web/');
const nativeNames = new Set([
  'max_output_tokens',
  'input_tokens',
  'output_tokens',
  'total_tokens',
  'input_tokens_details',
  'output_tokens_details',
  'cached_tokens',
  'cache_write_tokens',
  'reasoning_tokens',
  'previous_response_id',
  'prompt_cache_key',
  'prompt_cache_retention',
  'tool_choice',
  'parallel_tool_calls',
  'ResponseCreateParamsStreaming',
  'ResponseStreamEvent',
  'ResponseUsage',
  'json_schema',
]);

export function aiImportViolation(path, specifier) {
  const normalized = posix.normalize(path.replaceAll('\\', '/'));
  const normalizedSpecifier = specifier.replaceAll('\\', '/');
  const target = posix.normalize(
    normalizedSpecifier.startsWith('.')
      ? posix.join(posix.dirname(normalized), normalizedSpecifier)
      : normalizedSpecifier,
  );
  const sdk = sdkPackages.find(
    (name) => normalizedSpecifier === name || normalizedSpecifier.startsWith(`${name}/`),
  );
  if (sdk === '@anthropic-ai/sdk')
    return 'Anthropic SDK is deferred; production supports OpenAI only.';
  if (sdk === 'openai' && !normalized.startsWith(adapterPrefix))
    return 'OpenAI SDK imports belong only in the backend OpenAI adapter.';
  if (
    target.startsWith(adapterPrefix) &&
    !normalized.startsWith(adapterPrefix) &&
    normalized !== 'apps/api/src/modules/ai/ai.module.ts'
  )
    return 'Only AI composition and adapter-local code can import the OpenAI adapter or its barrels.';
  if (
    (normalized.startsWith('packages/') || normalized.startsWith('apps/web/')) &&
    (target.startsWith('apps/api/') || /^@archboard\/api(?:\/|$)/.test(target))
  )
    return 'Public contracts, graph commands and frontend code cannot import server AI internals.';
  if (
    isApplication(normalized) &&
    !isTest(normalized) &&
    (/^apps\/api\/src\/modules\/[^/]+\/(?:infrastructure|presentation)\//.test(target) ||
      target.startsWith('apps/api/src/platform/config/') ||
      /^apps\/api\/src\/modules\/[^/]+\/[^/]+\.module(?:\.|$)/.test(target))
  )
    return 'Application/domain code must use neutral ports instead of server composition/infrastructure.';
  if (
    !isTest(normalized) &&
    !normalized.startsWith(fixturePrefix) &&
    target.startsWith(fixturePrefix)
  )
    return 'AI fixture implementations cannot enter production source.';
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
  const normalized = posix.normalize(path.replaceAll('\\', '/'));
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const violations = [];
  function visit(node) {
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      (ts.isStringLiteral(node.moduleReference.expression) ||
        ts.isNoSubstitutionTemplateLiteral(node.moduleReference.expression))
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
      node.arguments[0]
    ) {
      const argument = node.arguments[0];
      if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) {
        const issue = aiImportViolation(path, argument.text);
        if (issue) violations.push(issue);
      } else if (isNeutral(normalized) && !isTest(normalized)) {
        violations.push('Provider-neutral layers cannot use computed module imports.');
      }
    }
    if (
      (isNeutral(normalized) ||
        (normalized.startsWith('apps/api/src/modules/ai/') &&
          !normalized.startsWith(adapterPrefix))) &&
      (ts.isStringLiteral(node) ||
        ts.isIdentifier(node) ||
        ts.isNoSubstitutionTemplateLiteral(node)) &&
      (nativeNames.has(node.text) ||
        /^response\.(?:completed|incomplete|failed|output_text\.|refusal\.)/.test(node.text))
    )
      violations.push(
        'Provider-native types, request fields and events belong inside the adapter.',
      );
    if (
      !isTest(normalized) &&
      (ts.isStringLiteral(node) || ts.isIdentifier(node)) &&
      publicAiName.test(node.text)
    )
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
      'apps/api/src/modules/ai/application/negative.ts',
      "import { OpenAiProvider } from '../infrastructure/providers/openai/openai-provider.js';",
    ],
    [
      'apps/api/src/modules/ai/application/negative.spec.ts',
      "import { ResponseUsage } from '../infrastructure/providers/openai/barrel.js';",
    ],
    [
      'packages/contracts/src/ai/negative.ts',
      "export type { ResponseUsage } from '../../../../apps/api/src/modules/ai/infrastructure/providers/openai/barrel.js';",
    ],
    [
      'packages/document-model/src/commands/negative.ts',
      'const request = { max_output_tokens: 10 };',
    ],
    [
      'apps/api/src/modules/ai/application/negative.ts',
      "const usage = native['input_tokens_details'];",
    ],
    ['packages/contracts/src/ai/negative.ts', 'interface Result { previous_response_id: string }'],
    [
      'apps/api/src/modules/ai/application/negative.ts',
      "if (event.type === 'response.completed') complete(event);",
    ],
    [
      'apps/api/src/modules/ai/application/negative.ts',
      "import { AiModule } from '../ai.module.js';",
    ],
    [
      'apps/api/src/modules/ai/application/negative.ts',
      "import { FixtureAiProvider } from '../infrastructure/testing/fixture-provider.js';",
    ],
    [
      'apps/api/src/modules/ai/ai.module.ts',
      "import { FixtureAiProvider } from './infrastructure/testing/fixture-provider.js';",
    ],
    ['apps/api/src/modules/ai/application/negative.ts', 'const client = import(`openai`);'],
    ['packages/contracts/src/ai/negative.ts', "const client = import('open' + 'ai');"],
    ['apps/web/src/negative.ts', "import { config } from '@archboard/api';"],
    [
      'apps/api/src/modules/ai/application/negative.ts',
      "import { policy } from '../../../platform/config/ai-config.js';",
    ],
    [
      'apps/api/src/modules/ai/application/negative.spec.ts',
      'const usage = response.input_tokens;',
    ],
    [
      'apps/api/src/modules/ai/infrastructure/testing/negative.ts',
      "import type { ResponseUsage } from 'openai/resources/responses/responses';",
    ],
    [
      'apps\\api\\src\\modules\\ai\\application\\negative.ts',
      "import type { ResponseUsage } from 'openai/resources/responses/responses';",
    ],
    [
      'apps/web/src/features/board/commands/negative.ts',
      "const request = { tool_choice: 'auto' };",
    ],
    [
      'apps/api/src/platform/provider-barrel.ts',
      "export type { Usage } from '../modules/ai/infrastructure/providers/openai/barrel.js';",
    ],
    [
      'apps/api/src/modules/ai/application/negative.ts',
      "import Adapter from '..\\\\infrastructure\\\\providers\\\\openai\\\\openai-provider.js';",
    ],
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
  const allowed = [
    [
      'apps/api/src/modules/ai/ai.module.ts',
      "import { OpenAiProvider } from './infrastructure/providers/openai/openai-provider.js';",
    ],
    [
      'apps/api/src/modules/ai/application/consumer.ts',
      "import type { ProviderEvent } from './provider.js'; const event = { type: 'completed', usage: { status: 'unknown' } };",
    ],
    [
      'apps/api/src/modules/ai/application/consumer.spec.ts',
      "import { FixtureAiProvider } from '../infrastructure/testing/fixture-provider.js';",
    ],
    [
      'apps/api/src/modules/ai/infrastructure/testing/suite.ts',
      "import { fixtureAiPolicy } from './fixture-config.js';",
    ],
    [
      'apps/api/src/modules/ai/infrastructure/providers/openai/adapter.ts',
      "import type { ResponseUsage } from 'openai/resources/responses/responses'; const params = { max_output_tokens: 10 };",
    ],
  ];
  for (const [path, text] of allowed)
    if (aiSourceViolations(path, text).length !== 0)
      failures.push(`Allowed AI boundary fixture was rejected: ${path}`);
  return { failures, count: cases.length + 1 };
}
