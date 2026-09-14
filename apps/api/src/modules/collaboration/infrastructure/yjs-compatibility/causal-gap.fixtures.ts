import * as Y from 'yjs';

import type { CausalGapKind } from './assert-causally-complete.js';

export interface ExecutableCausalGapFixture {
  readonly name: string;
  readonly gapKind: CausalGapKind;
  readonly dependencyUpdate: Uint8Array;
  readonly dependentUpdate: Uint8Array;
}

function structureGapFixture(): ExecutableCausalGapFixture {
  const source = new Y.Doc({ gc: false });
  const values = source.getMap<string>('structure-gap');
  const emptyState = Y.encodeStateVector(source);
  values.set('dependency', 'first client clock');
  const dependencyUpdate = Y.encodeStateAsUpdate(source, emptyState);
  const dependencyState = Y.encodeStateVector(source);
  values.set('dependent', 'next client clock');
  const dependentUpdate = Y.encodeStateAsUpdate(source, dependencyState);
  source.destroy();
  return {
    name: 'out-of-order-structure-update',
    gapKind: 'structure',
    dependencyUpdate,
    dependentUpdate,
  };
}

function deleteSetGapFixture(): ExecutableCausalGapFixture {
  const source = new Y.Doc({ gc: false });
  const values = source.getMap<string>('delete-set-gap');
  const emptyState = Y.encodeStateVector(source);
  values.set('deleted-later', 'dependency');
  const dependencyUpdate = Y.encodeStateAsUpdate(source, emptyState);
  const dependencyState = Y.encodeStateVector(source);
  values.delete('deleted-later');
  const dependentUpdate = Y.encodeStateAsUpdate(source, dependencyState);
  source.destroy();
  return {
    name: 'out-of-order-delete-set-update',
    gapKind: 'delete-set',
    dependencyUpdate,
    dependentUpdate,
  };
}

export function createCausalGapFixtures(): readonly ExecutableCausalGapFixture[] {
  return [structureGapFixture(), deleteSetGapFixture()];
}
