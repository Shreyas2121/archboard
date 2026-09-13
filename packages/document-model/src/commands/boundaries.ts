import type { Boundary } from '@archboard/contracts';
import type * as Y from 'yjs';

import { BOUNDARY_FIELDS } from '../schema/constants.js';
import { getGraphDocumentRoots } from '../schema/document.js';
import {
  LOCAL_EDIT_ORIGIN,
  LOCAL_STRUCTURAL_ORIGIN,
  assertFreshId,
  assertLiveCapacity,
  boundaryMap,
  liveBoundary,
  parseBoundary,
  replaceText,
  requireText,
} from './internal.js';

export function createBoundary(document: Y.Doc, input: Boundary): void {
  const boundary = parseBoundary(input);
  assertFreshId(document, boundary.id);
  assertLiveCapacity(document, { boundaries: 1 });
  document.transact(
    () => getGraphDocumentRoots(document).boundaries.set(boundary.id, boundaryMap(boundary)),
    LOCAL_STRUCTURAL_ORIGIN,
  );
}

export function editBoundary(
  document: Y.Doc,
  id: string,
  changes: Partial<Pick<Boundary, 'title' | 'rect' | 'color'>>,
): void {
  const boundary = parseBoundary({ ...liveBoundary(document, id), ...changes });
  const map = getGraphDocumentRoots(document).boundaries.get(id) as Y.Map<unknown>;
  document.transact(() => {
    if (changes.title !== undefined)
      replaceText(
        requireText(map.get(BOUNDARY_FIELDS.TITLE), `Boundary ${id}`, BOUNDARY_FIELDS.TITLE),
        boundary.title,
      );
    if (changes.rect !== undefined) map.set(BOUNDARY_FIELDS.RECT, { ...boundary.rect });
    if (changes.color !== undefined) map.set(BOUNDARY_FIELDS.COLOR, boundary.color);
  }, LOCAL_EDIT_ORIGIN);
}
