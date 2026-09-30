import type * as Y from 'yjs';

import { resolveGraphText, type GraphTextTarget } from '../commands/text.js';

export interface GraphTextAccess {
  readonly value: string;
  subscribe(listener: (delta: GraphTextDelta) => void): () => void;
}

export type GraphTextDelta = readonly {
  readonly retain?: number;
  readonly delete?: number;
  readonly insert?: string;
}[];

export function accessGraphText(document: Y.Doc, target: GraphTextTarget): GraphTextAccess {
  const text = resolveGraphText(document, target);
  return {
    get value() {
      return text.toString();
    },
    subscribe(listener) {
      const observe = (event: Y.YTextEvent): void =>
        listener(
          event.delta.map((change) => ({
            ...(change.retain === undefined ? {} : { retain: change.retain }),
            ...(change.delete === undefined ? {} : { delete: change.delete }),
            ...(change.insert === undefined
              ? {}
              : { insert: typeof change.insert === 'string' ? change.insert : '\uFFFC' }),
          })),
        );
      text.observe(observe);
      return () => text.unobserve(observe);
    },
  };
}
