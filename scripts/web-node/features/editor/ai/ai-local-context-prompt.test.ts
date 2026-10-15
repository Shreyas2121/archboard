import { expect, it } from 'vitest';
import { AI_DIAGRAM_FOCUSES, parseProjectContextFile } from '@archboard/contracts';
import {
  LOCAL_CONTEXT_PROMPT,
  createLocalContextPrompt,
} from '@/features/editor/ai/ai-local-context-prompt';

it('embeds a complete JSON example accepted by the actual context file parser', () => {
  const start = LOCAL_CONTEXT_PROMPT.indexOf('\n{');
  const end = LOCAL_CONTEXT_PROMPT.indexOf('\nRules:');
  const example = parseProjectContextFile(LOCAL_CONTEXT_PROMPT.slice(start, end).trim());
  expect(example.kind).toBe('archboard.project-context');
  expect(example.connections[0]?.source).toBe(example.components[0]?.key);
  expect(example.components[0]?.evidenceKeys).toContain(example.evidence[0]?.key);
});

it('asks for supported internal responsibilities and flows without implying microservices', () => {
  const modules = createLocalContextPrompt('modules');
  expect(modules).toContain('Do not collapse a modular backend');
  expect(LOCAL_CONTEXT_PROMPT).toContain('explicitly identify a monolith');
  expect(LOCAL_CONTEXT_PROMPT).toContain('Only include connections supported by code');
  expect(LOCAL_CONTEXT_PROMPT).toContain('Do not create one component per file');
});

it.each(Object.values(AI_DIAGRAM_FOCUSES))(
  'saves a parser-valid %s example and bounds local extraction',
  (focus) => {
    const prompt = createLocalContextPrompt(focus, 'Trace the order lifecycle.');
    const start = prompt.indexOf('\n{');
    const end = prompt.indexOf('\nRules:');
    const example = parseProjectContextFile(prompt.slice(start, end).trim());
    expect(example.diagramFocus).toBe(focus);
    expect(prompt).toContain('Trace the order lifecycle.');
    expect(prompt).toContain('Do not read or include secrets');
    expect(prompt).toContain('Do not scan unrelated subsystems in depth');
  },
);
