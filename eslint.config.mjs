import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const sourceFiles = ['**/*.{js,mjs,ts,tsx}'];
const typeScriptFiles = ['**/*.{ts,tsx}'];
const frameworkIndependentFiles = [
  'packages/contracts/src/**/*.ts',
  'packages/document-model/src/**/*.ts',
];
const reactIndependentFiles = ['packages/sync-client/src/**/*.ts'];

export default tseslint.config(
  {
    ignores: [
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/*.d.ts',
      '**/*.tsbuildinfo',
    ],
  },
  {
    ...eslint.configs.recommended,
    files: sourceFiles,
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  ...tseslint.configs.recommended.map((configuration) => ({
    ...configuration,
    files: typeScriptFiles,
  })),
  {
    files: typeScriptFiles,
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: [-1, 0, 1],
          ignoreArrayIndexes: true,
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
        },
      ],
    },
  },
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: frameworkIndependentFiles,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react/*', '@xyflow/react', 'zustand', 'zustand/*', '@nestjs/*'],
              message:
                'Shared domain packages must remain independent of React, React Flow, Zustand, and NestJS.',
            },
          ],
        },
      ],
    },
  },
  {
    files: reactIndependentFiles,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react/*'],
              message: 'The sync client must remain independent of React.',
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
);
