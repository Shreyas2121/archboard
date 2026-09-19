import type * as Y from 'yjs';

import { resolveGraphText, type GraphTextTarget } from '../commands/text.js';

export interface GraphTextAccess {
  readonly value: string;
  subscribe(listener: () => void): () => void;
}

export function accessGraphText(document: Y.Doc, target: GraphTextTarget): GraphTextAccess {
  const text = resolveGraphText(document, target);
  return {
    get value() {
      return text.toString();
    },
    subscribe(listener) {
      const observe = (): void => listener();
      text.observe(observe);
      return () => text.unobserve(observe);
    },
  };
}
