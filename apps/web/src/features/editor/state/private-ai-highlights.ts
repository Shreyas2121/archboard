import type { PrivateAiHighlights } from './editor-ui-store';

const NO_PRIVATE_HIGHLIGHTS = Object.freeze({ nodeIds: [], edgeIds: [] });
export function privateAiHighlightsForScope(
  highlights: PrivateAiHighlights | null,
  scope: string | undefined,
  revision: number | undefined,
  presenting: boolean,
) {
  return !presenting && highlights && highlights.scope === scope && highlights.revision === revision
    ? highlights
    : NO_PRIVATE_HIGHLIGHTS;
}
