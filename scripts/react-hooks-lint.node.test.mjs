import assert from 'node:assert/strict';
import test from 'node:test';
import { ESLint } from 'eslint';

test('frontend lint rejects conditional hooks and missing reactive dependencies', async () => {
  const eslint = new ESLint();
  const [result] = await eslint.lintText(
    `
    import { useEffect, useState } from 'react';
    export function Invalid({ enabled, value }) {
      if (enabled) useState(value);
      useEffect(() => { console.log(value); }, []);
      return null;
    }
  `,
    { filePath: 'apps/web/src/react-hooks-negative-fixture.tsx' },
  );
  const rules = new Set(
    result.messages.filter(({ severity }) => severity === 2).map(({ ruleId }) => ruleId),
  );
  assert.ok(rules.has('react-hooks/rules-of-hooks'));
  assert.ok(rules.has('react-hooks/exhaustive-deps'));
});

test('correct hook dependencies pass frontend lint', async () => {
  const eslint = new ESLint();
  const [result] = await eslint.lintText(
    `
    import { useEffect, useState } from 'react';
    export function Valid({ value }) {
      const [initial] = useState(value);
      useEffect(() => { console.log(value, initial); }, [value, initial]);
      return null;
    }
  `,
    { filePath: 'apps/web/src/react-hooks-positive-fixture.tsx' },
  );
  assert.deepEqual(result.messages, []);
});
