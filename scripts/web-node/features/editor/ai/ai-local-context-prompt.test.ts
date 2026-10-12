import { expect, it } from 'vitest';
import { parseProjectContextFile } from '@archboard/contracts';
import { LOCAL_CONTEXT_PROMPT } from '@/features/editor/ai/ai-local-context-prompt';

it('embeds a complete JSON example accepted by the actual context file parser', () => {
  const start = LOCAL_CONTEXT_PROMPT.indexOf('\n{');
  const end = LOCAL_CONTEXT_PROMPT.indexOf('\nRules:');
  const example = parseProjectContextFile(LOCAL_CONTEXT_PROMPT.slice(start, end).trim());
  expect(example.kind).toBe('archboard.project-context');
  expect(example.connections[0]?.source).toBe(example.components[0]?.key);
  expect(example.components[0]?.evidenceKeys).toContain(example.evidence[0]?.key);
});
