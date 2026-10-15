import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { ReactFlow, ReactFlowProvider, useStoreApi } from '@xyflow/react';
import type * as FlowModule from '@xyflow/react';
import { expect, it, vi } from 'vitest';
import { ProjectContextPreview } from '@/features/editor/project-context/project-context-preview';

const observed = vi.hoisted<{ editor?: unknown; preview?: unknown }>(() => ({}));
vi.mock('@xyflow/react', async (importOriginal) => {
  const actual = await importOriginal<typeof FlowModule>();
  return {
    ...actual,
    // Only the DOM canvas is stubbed. Real providers/hooks expose their store identity.
    ReactFlow: function PreviewStoreProbe() {
      observed.preview = actual.useStoreApi().getState;
      return null;
    },
  };
});
function EditorStoreProbe() {
  observed.editor = useStoreApi().getState;
  return null;
}
it('owns a separate Flow store when its dialog is nested inside the editor provider', () => {
  renderToString(
    createElement(
      ReactFlowProvider,
      null,
      createElement(EditorStoreProbe),
      createElement(ReactFlow),
    ),
  );
  expect(observed.preview).toBe(observed.editor);
  renderToString(
    createElement(
      ReactFlowProvider,
      null,
      createElement(EditorStoreProbe),
      createElement(ProjectContextPreview, {
        graph: { schemaVersion: 1, nodes: [], edges: [], boundaries: [], steps: [] },
      }),
    ),
  );
  expect(observed.editor).toBeDefined();
  expect(observed.preview).toBeDefined();
  expect(observed.preview).not.toBe(observed.editor);
});
