import {
  aiCreateRunSchema,
  projectContextV1Schema,
  MAX_AI_CONTEXT_FILE_BYTES,
  type AiCreateRun,
  type ProjectContextV1,
} from '@archboard/contracts';
import { parseBoundedJson } from '@archboard/export';

export const AI_JSON_INDENT = 2;
export const AI_RECEIPT_WINDOW_MS = 86_400_000;
export interface AiContextForm {
  name: string;
  description: string;
  technologies: string;
  constraints: string;
  unknowns: string;
  components: (ProjectContextV1['components'][number] & { rowId: string })[];
  connections: (ProjectContextV1['connections'][number] & { rowId: string })[];
}
export const emptyAiForm = (): AiContextForm => ({
  name: '',
  description: '',
  technologies: '',
  constraints: '',
  unknowns: '',
  components: [],
  connections: [],
});
const lines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
export function contextFromForm(form: AiContextForm): ProjectContextV1 {
  return projectContextV1Schema.parse({
    kind: 'archboard.project-context',
    schemaVersion: 1,
    project: {
      name: form.name,
      description: form.description,
      technologies: lines(form.technologies),
    },
    components: form.components.map(({ rowId: _rowId, ...component }) => {
      void _rowId;
      return component;
    }),
    connections: form.connections.map(({ rowId: _rowId, ...connection }) => {
      void _rowId;
      return connection;
    }),
    constraints: lines(form.constraints),
    unknowns: lines(form.unknowns),
    groups: [],
    evidence: [],
  });
}
export function parseAiContext(bytes: Uint8Array): ProjectContextV1 {
  if (bytes.byteLength > MAX_AI_CONTEXT_FILE_BYTES) throw new Error('Context file exceeds 1 MiB.');
  return projectContextV1Schema.parse(parseBoundedJson(bytes, MAX_AI_CONTEXT_FILE_BYTES));
}
export function reviewAiRequest(
  prompt: string,
  boardId: string,
  context?: ProjectContextV1,
): AiCreateRun {
  return aiCreateRunSchema.parse({
    schemaVersion: 1,
    task: context ? 'propose-design' : 'diagram-described',
    target: { kind: 'board', boardId },
    prompt,
    ...(context ? { context } : {}),
    history: [],
  });
}
export function aiValidationMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'issues' in error &&
    Array.isArray(error.issues)
  ) {
    const maximumIssues = 8;
    return error.issues
      .slice(0, maximumIssues)
      .map(
        (issue: { path?: unknown[]; message?: string }) =>
          `${issue.path?.join('.') || 'Request'}: ${issue.message || 'Invalid value.'}`,
      )
      .join('\n');
  }
  return error instanceof Error ? error.message : 'The AI request could not be validated.';
}
