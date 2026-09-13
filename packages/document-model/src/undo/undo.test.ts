import { COLOR_TOKENS } from '@archboard/contracts';
import { FIXED_IDS, minimalGraphFixture } from '@archboard/fixtures';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { tombstoneNode } from '../commands/deletion.js';
import { createNode, moveNode, setNodeColor, setNodeTitle } from '../commands/nodes.js';
import { projectGraphDocument } from '../projection/project.js';
import { createGraphDocument } from '../schema/document.js';
import { hydrateGraphDocument } from '../schema/hydrate.js';
import { applyHydrationUpdate, applyRemoteUpdate, COMMAND_ORIGINS } from './origins.js';
import { createLocalUndoManager } from './undo.js';

const EXPECTED_LOCAL_UNDO_ITEMS = 2;

describe('local undo origins', () => {
  it('undoes eligible local edits without undoing a remote contribution', () => {
    const initial = hydrateGraphDocument(minimalGraphFixture);
    const local = createGraphDocument();
    const remote = createGraphDocument();
    applyHydrationUpdate(local, Y.encodeStateAsUpdate(initial));
    applyHydrationUpdate(remote, Y.encodeStateAsUpdate(initial));
    const undo = createLocalUndoManager(local);

    setNodeTitle(local, FIXED_IDS.NODE_A, 'Locally renamed');
    moveNode(remote, FIXED_IDS.NODE_A, { x: 80, y: 90 });
    applyRemoteUpdate(local, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(initial)));
    undo.undo();

    const node = projectGraphDocument(local).nodes.find(({ id }) => id === FIXED_IDS.NODE_A);
    expect(node).toMatchObject({ title: 'Web application', position: { x: 80, y: 90 } });
    expect(undo.undoStack).toHaveLength(0);
  });

  it('keeps creation and deletion outside generic undo', () => {
    const document = createGraphDocument();
    const undo = createLocalUndoManager(document);
    createNode(document, minimalGraphFixture.nodes[0]!);
    tombstoneNode(document, FIXED_IDS.NODE_A);
    undo.undo();

    expect(projectGraphDocument(document).nodes).toEqual([]);
    expect(undo.undoStack).toHaveLength(0);
  });

  it('tracks separate local property commands and supports redo', () => {
    const document = hydrateGraphDocument(minimalGraphFixture);
    const undo = createLocalUndoManager(document);
    setNodeTitle(document, FIXED_IDS.NODE_A, 'First edit');
    setNodeColor(document, FIXED_IDS.NODE_A, COLOR_TOKENS.RED);
    expect(undo.undoStack).toHaveLength(EXPECTED_LOCAL_UNDO_ITEMS);

    undo.undo();
    expect(projectGraphDocument(document).nodes[0]?.color).toBe(COLOR_TOKENS.BLUE);
    undo.undo();
    expect(projectGraphDocument(document).nodes[0]?.title).toBe('Web application');
    undo.redo();
    expect(projectGraphDocument(document).nodes[0]?.title).toBe('First edit');
  });

  it('labels hydration and remote transactions with stable excluded origins', () => {
    const document = createGraphDocument();
    const origins: unknown[] = [];
    document.on('afterTransaction', (transaction) => origins.push(transaction.origin));
    const update = Y.encodeStateAsUpdate(hydrateGraphDocument(minimalGraphFixture));
    applyHydrationUpdate(document, update);

    const remote = hydrateGraphDocument(minimalGraphFixture);
    setNodeColor(remote, FIXED_IDS.NODE_A, COLOR_TOKENS.RED);
    applyRemoteUpdate(document, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(document)));

    expect(origins).toContain(COMMAND_ORIGINS.HYDRATION);
    expect(origins).toContain(COMMAND_ORIGINS.REMOTE);
    expect(COMMAND_ORIGINS.LOCAL_EDIT).not.toBe(COMMAND_ORIGINS.REMOTE);
    expect(COMMAND_ORIGINS.LOCAL_STRUCTURAL).not.toBe(COMMAND_ORIGINS.HYDRATION);
  });
});
