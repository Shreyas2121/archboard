import {
  aiCreateRunSchema,
  projectContextV1Schema,
  MAX_AI_CONTEXT_FILE_BYTES,
  type AiCreateRun,
  type ProjectContextV1,
  type AiRun,
} from '@archboard/contracts';
import { parseBoundedJson } from '@archboard/export';

export const AI_JSON_INDENT = 2;
export const AI_RECEIPT_WINDOW_MS = 86_400_000;
export const DEFAULT_AI_FILE_PROMPT =
  'Diagram the existing architecture described in the supplied project context. Show the components and their connections, use the supplied groups where helpful, and clearly identify unknowns. Do not invent unsupported components or connections.';
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
export function aiRunFailureMessage(failure: NonNullable<AiRun['failure']>): string {
  switch (failure.code) {
    case 'AI_OUTPUT_INVALID':
      return 'The AI response could not be validated. No proposal was applied.';
    case 'AI_REFUSED':
      return 'The AI declined this request. Review your instructions before starting a new request.';
    case 'AI_OUTCOME_UNKNOWN':
      return 'The generation outcome and charge may be unknown. Check the original run; it will not be resubmitted automatically.';
    case 'AI_GENERATION_FAILED':
      return 'AI generation failed. No proposal was applied. You can check this run or explicitly start a new reviewed request.';
    case 'AI_INPUT_TOO_LARGE':
      return 'The reviewed context exceeds this model’s input limit. Reduce the context before starting a new request.';
    default:
      return `This request ended with ${failure.code.replaceAll('_', ' ').toLowerCase()}. Check the original run before starting a new request.`;
  }
}
