import * as Y from 'yjs';

import { getGraphDocumentRoots } from '../schema/document.js';
import { COMMAND_ORIGINS } from './origins.js';

export function createLocalUndoManager(document: Y.Doc): Y.UndoManager {
  const roots = getGraphDocumentRoots(document);
  return new Y.UndoManager([roots.nodes, roots.edges, roots.boundaries, roots.steps], {
    captureTimeout: 0,
    trackedOrigins: new Set([COMMAND_ORIGINS.LOCAL_EDIT]),
  });
}
