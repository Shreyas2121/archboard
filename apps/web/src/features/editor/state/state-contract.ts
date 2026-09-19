import type { EditorUiState } from './editor-ui-store.js';

type ForbiddenDurableKey = Extract<
  keyof EditorUiState,
  'nodes' | 'edges' | 'boundaries' | 'steps' | 'graph' | 'projection' | 'document'
>;
type Assert<T extends true> = T;
type HasNoDurableGraphKeys = Assert<[ForbiddenDurableKey] extends [never] ? true : false>;

export const EDITOR_UI_STATE_EXCLUDES_DURABLE_GRAPH_CONTENT: HasNoDurableGraphKeys = true;
