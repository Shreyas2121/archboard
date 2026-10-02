import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  accessGraphText,
  createGraphDocument,
  createNode,
  editGraphText,
} from '@archboard/document-model';
import { COLOR_TOKENS, MAX_NODE_TITLE_CHARACTERS } from '@archboard/contracts';

import { TextDraft } from '@/features/editor/inspector/text-draft';

function setup(baseline = 'abcd') {
  const document = createGraphDocument();
  const id = crypto.randomUUID();
  createNode(document, {
    id,
    kind: 'note',
    title: baseline,
    color: COLOR_TOKENS.BLUE,
    position: { x: 0, y: 0 },
    size: { width: 240, height: 140 },
    content: { body: '' },
  });
  const target = { entity: 'node', id, field: 'title' } as const;
  const peer = createGraphDocument();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(document));
  const access = accessGraphText(document, target);
  const draft = new TextDraft(access.value);
  const unsubscribe = access.subscribe((delta) => draft.receive(delta));
  return { document, peer, access, draft, target, unsubscribe };
}

describe('text draft rebasing', () => {
  it.each([
    { index: 0, deleteCount: 0, insert: 'X', expected: 'Xa語d' },
    { index: 1, deleteCount: 0, insert: 'X', expected: 'aX語d' },
    { index: 2, deleteCount: 0, insert: 'X', expected: 'a語Xd' },
    { index: 4, deleteCount: 0, insert: 'X', expected: 'a語dX' },
    { index: 0, deleteCount: 1, insert: '', expected: '語d' },
    { index: 1, deleteCount: 1, insert: '', expected: 'a語d' },
    { index: 3, deleteCount: 1, insert: '', expected: 'a語' },
  ])('preserves peer edits around and inside composition: $expected', (remote) => {
    const { document, peer, access, draft, target, unsubscribe } = setup();
    try {
      editGraphText(peer, target, remote);
      Y.applyUpdate(document, Y.encodeStateAsUpdate(peer));
      const changes = draft.edits('a語d');
      unsubscribe();
      let transactions = 0;
      document.on('update', () => (transactions += 1));
      editGraphText(document, target, changes);
      expect(access.value).toBe(remote.expected);
      expect(transactions).toBe(1);
      Y.applyUpdate(peer, Y.encodeStateAsUpdate(document));
      expect(accessGraphText(peer, target).value).toBe(remote.expected);
    } finally {
      unsubscribe();
      document.destroy();
      peer.destroy();
    }
  });

  it('keeps multiple peer deltas while an over-limit draft is corrected', () => {
    const { document, peer, access, draft, target, unsubscribe } = setup('abc');
    try {
      const invalid = `ab${'語'.repeat(MAX_NODE_TITLE_CHARACTERS)}c`;
      expect(invalid.length).toBeGreaterThan(MAX_NODE_TITLE_CHARACTERS);
      editGraphText(peer, target, { index: 1, deleteCount: 0, insert: 'X' });
      Y.applyUpdate(document, Y.encodeStateAsUpdate(peer));
      editGraphText(peer, target, { index: 0, deleteCount: 1, insert: '' });
      Y.applyUpdate(document, Y.encodeStateAsUpdate(peer));
      unsubscribe();
      editGraphText(document, target, draft.edits('ab語c'));
      expect(access.value).toBe('Xb語c');
    } finally {
      unsubscribe();
      document.destroy();
      peer.destroy();
    }
  });

  it('validates the full rebased batch before any mutation', () => {
    const { document, peer, access, target, unsubscribe } = setup();
    try {
      const before = access.value;
      expect(() =>
        editGraphText(document, target, [
          { index: 0, deleteCount: 1, insert: '' },
          { index: 0, deleteCount: 0, insert: 'X'.repeat(MAX_NODE_TITLE_CHARACTERS) },
        ]),
      ).toThrow();
      expect(access.value).toBe(before);
    } finally {
      unsubscribe();
      document.destroy();
      peer.destroy();
    }
  });
});
