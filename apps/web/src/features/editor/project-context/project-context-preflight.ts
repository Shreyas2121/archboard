import {
  MAX_CLIENT_UPDATE_BYTES,
  MAX_ENCODED_YJS_STATE_BYTES,
  graphProjectionSchema,
  type GraphProjection,
} from '@archboard/contracts';
import {
  createGraphObjects,
  createPresentationStep,
  projectGraphDocument,
  validateGraphDocument,
} from '@archboard/document-model';
import * as Y from 'yjs';
/** Full CRDT state, including tombstones/history, is cloned; the source is never mutated. */
export function preflightGraphAdditions(
  source: Uint8Array,
  graph: GraphProjection,
  limits: { updateBytes?: number; stateBytes?: number; clientId?: number } = {},
): { readonly updateBytes: number; readonly stateBytes: number } {
  const updateLimit = Math.min(
    limits.updateBytes ?? MAX_CLIENT_UPDATE_BYTES,
    MAX_CLIENT_UPDATE_BYTES,
  );
  const stateLimit = Math.min(
    limits.stateBytes ?? MAX_ENCODED_YJS_STATE_BYTES,
    MAX_ENCODED_YJS_STATE_BYTES,
  );
  if (source.byteLength > stateLimit)
    throw new Error('Existing diagram state exceeds its byte budget.');
  const candidate = new Y.Doc({ gc: false });
  const accepted = new Y.Doc({ gc: false });
  try {
    Y.applyUpdate(candidate, source);
    Y.applyUpdate(accepted, source);
    // Apply uses the live writer's ID so variable-width CRDT IDs cannot undercount bytes.
    if (limits.clientId !== undefined) candidate.clientID = limits.clientId;
    validateGraphDocument(candidate);
    const vector = Y.encodeStateVector(candidate);
    const batch = graphProjectionSchema.parse(graph);
    createGraphObjects(candidate, batch);
    for (const step of batch.steps) createPresentationStep(candidate, step);
    validateGraphDocument(candidate, accepted);
    // Includes existing live content and capacity, not only the new proposal.
    graphProjectionSchema.parse(projectGraphDocument(candidate));
    const updateBytes = Y.encodeStateAsUpdate(candidate, vector).byteLength;
    const stateBytes = Y.encodeStateAsUpdate(candidate).byteLength;
    if (updateBytes > updateLimit || stateBytes > stateLimit)
      throw new Error('Prepared diagram exceeds its encoded byte budget.');
    return { updateBytes, stateBytes };
  } finally {
    candidate.destroy();
    accepted.destroy();
  }
}
