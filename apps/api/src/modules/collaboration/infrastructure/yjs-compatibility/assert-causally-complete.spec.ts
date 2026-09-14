import * as Y from 'yjs';

import {
  assertCausallyComplete,
  CausallyIncompleteUpdateError,
  YjsCausalCompatibilityError,
} from './assert-causally-complete.js';
import { createCausalGapFixtures } from './causal-gap.fixtures.js';

const EXPECTED_CAUSAL_GAP_FIXTURE_COUNT = 2;

function createAcceptedDocument(): Y.Doc {
  const accepted = new Y.Doc({ gc: false });
  accepted.getMap<string>('accepted').set('stable', 'unchanged');
  return accepted;
}

function cloneDocument(source: Y.Doc): Y.Doc {
  const clone = new Y.Doc({ gc: false });
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(source));
  return clone;
}

describe('Yjs causal compatibility boundary', () => {
  it('accepts complete candidate documents', () => {
    const source = new Y.Doc({ gc: false });
    source.getMap<string>('values').set('complete', 'update');
    const candidate = new Y.Doc({ gc: false });
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(source));

    expect(() => assertCausallyComplete(candidate)).not.toThrow();
    candidate.destroy();
    source.destroy();
  });

  it.each(createCausalGapFixtures())(
    'rejects $name without changing the accepted document',
    ({ gapKind, dependencyUpdate, dependentUpdate }) => {
      const accepted = createAcceptedDocument();
      const acceptedBefore = Y.encodeStateAsUpdate(accepted);
      const candidate = cloneDocument(accepted);

      Y.applyUpdate(candidate, dependentUpdate);
      try {
        assertCausallyComplete(candidate);
        throw new Error('Expected the causally incomplete candidate to be rejected.');
      } catch (error) {
        expect(error).toBeInstanceOf(CausallyIncompleteUpdateError);
        expect((error as CausallyIncompleteUpdateError).gapKinds).toEqual([gapKind]);
      }
      expect(Y.encodeStateAsUpdate(accepted)).toEqual(acceptedBefore);

      Y.applyUpdate(candidate, dependencyUpdate);
      expect(() => assertCausallyComplete(candidate)).not.toThrow();
      candidate.destroy();
      accepted.destroy();
    },
  );

  it('pins both generated causal-gap fixture categories', () => {
    const fixtures = createCausalGapFixtures();
    expect(fixtures).toHaveLength(EXPECTED_CAUSAL_GAP_FIXTURE_COUNT);
    expect(new Set(fixtures.map(({ gapKind }) => gapKind))).toEqual(
      new Set(['structure', 'delete-set']),
    );
  });

  it('fails closed when the pinned Yjs StructStore shape changes', () => {
    const incompatibleCandidate = { store: { clients: new Map() } } as unknown as Y.Doc;

    expect(() => assertCausallyComplete(incompatibleCandidate)).toThrow(
      YjsCausalCompatibilityError,
    );
    expect(() => assertCausallyComplete(incompatibleCandidate)).toThrow(
      'StructStore.pendingStructs is absent',
    );
  });

  it('acts as an upgrade sentinel against the installed Y.Doc shape', () => {
    const installedDocument = new Y.Doc();

    expect(() => assertCausallyComplete(installedDocument)).not.toThrow();
    installedDocument.destroy();
  });
});
