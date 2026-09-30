import { describe, expect, it } from 'vitest';
import { FIXED_IDS, allEntityGraphFixture } from '@archboard/fixtures';

import { hydrateGraphDocument } from '../schema/hydrate.js';
import { projectGraphDocument } from '../projection/project.js';
import { setComponentExternalUrl } from './nodes.js';

describe('external URL draft commits', () => {
  it('compares the draft baseline against the current URL before writing', () => {
    const document = hydrateGraphDocument(allEntityGraphFixture);
    const id = FIXED_IDS.NODE_A;
    try {
      setComponentExternalUrl(document, id, null);
      setComponentExternalUrl(document, id, 'https://peer.example');
      const update = () => setComponentExternalUrl(document, id, 'https://local.example', null);
      expect(update).toThrow('The URL changed while this draft was being edited.');
      const node = projectGraphDocument(document).nodes.find((node) => node.id === id);
      expect(node?.kind === 'component' && node.content.externalUrl).toBe('https://peer.example');
      setComponentExternalUrl(document, id, 'https://local.example', 'https://peer.example');
      const saved = projectGraphDocument(document).nodes.find((node) => node.id === id);
      expect(saved?.kind === 'component' && saved.content.externalUrl).toBe(
        'https://local.example',
      );
    } finally {
      document.destroy();
    }
  });
});
