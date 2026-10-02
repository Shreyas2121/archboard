import { portableGraphProjectionSchema, type GraphProjection } from '@archboard/contracts';
import * as Y from 'yjs';
import { hydrateGraphDocument } from '../schema/hydrate.js';
import { validateGraphDocument } from '../validation/validate.js';
import { remapGraphProjection } from './remap.js';

/** Initialize a new namespace from semantic content, never source CRDT bytes/history. */
export function createFreshGraphUpdate(source: GraphProjection): Uint8Array {
  const graph = portableGraphProjectionSchema.parse(source);
  const document = hydrateGraphDocument(
    portableGraphProjectionSchema.parse(remapGraphProjection(graph)),
  );
  try {
    validateGraphDocument(document);
    return Y.encodeStateAsUpdate(document);
  } finally {
    document.destroy();
  }
}
