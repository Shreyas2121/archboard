import type {
  ColorToken,
  ComponentContent,
  GraphProjection,
  ProjectContextV1,
} from '@archboard/contracts';
import type { ProjectLayout } from './project-context-layout';

export const CONTEXT_INSTRUCTION_LIMIT = 4_000;
export const CONTEXT_ADDITIVE_GAP = 160;
export const CONTEXT_PREVIEW_INDENT = 2;
export const CONTEXT_COORDINATE_DIVISOR = 2;
export const CONTEXT_CATEGORY_COLORS: Readonly<Record<ComponentContent['category'], ColorToken>> = {
  client: 'teal',
  service: 'blue',
  database: 'green',
  queue: 'violet',
  cache: 'amber',
  external: 'gray',
  generic: 'gray',
};

export interface ProjectContextDraft {
  readonly context: ProjectContextV1;
  readonly graph: GraphProjection;
  readonly layout: Pick<ProjectLayout, 'status' | 'reason'>;
}

export function projectContextError(cause: unknown): string {
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'issues' in cause &&
    Array.isArray(cause.issues)
  ) {
    const maximum = 8;
    return cause.issues
      .slice(0, maximum)
      .map(
        (issue: { path?: unknown[]; message?: string }) =>
          `${issue.path?.join('.') || 'File'}: ${issue.message || 'Invalid value.'}`,
      )
      .join('\n');
  }
  return cause instanceof Error ? cause.message : 'The project context could not be prepared.';
}
