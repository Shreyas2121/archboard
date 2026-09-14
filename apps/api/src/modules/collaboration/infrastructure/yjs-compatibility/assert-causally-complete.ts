import type * as Y from 'yjs';

export type CausalGapKind = 'structure' | 'delete-set';

interface PendingStructures {
  readonly missing: Map<number, number>;
  readonly update: Uint8Array;
}

interface PinnedStructStore {
  readonly pendingStructs: PendingStructures | null;
  readonly pendingDs: Uint8Array | null;
}

const EXPECTED_STORE_FIELDS = ['pendingStructs', 'pendingDs'] as const;

export class YjsCausalCompatibilityError extends Error {
  public constructor(detail: string) {
    super(`Unsupported Yjs causal store representation: ${detail}`);
    this.name = 'YjsCausalCompatibilityError';
  }
}

export class CausallyIncompleteUpdateError extends Error {
  public constructor(public readonly gapKinds: readonly CausalGapKind[]) {
    super(`Candidate Y.Doc has pending causal dependencies: ${gapKinds.join(', ')}.`);
    this.name = 'CausallyIncompleteUpdateError';
  }
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingClockMap(value: unknown): value is Map<number, number> {
  if (!(value instanceof Map)) return false;
  for (const [client, clock] of value) {
    if (!Number.isSafeInteger(client) || client < 0 || !Number.isSafeInteger(clock) || clock < 0) {
      return false;
    }
  }
  return true;
}

function isPendingStructures(value: unknown): value is PendingStructures {
  return (
    isRecord(value) &&
    Object.hasOwn(value, 'missing') &&
    Object.hasOwn(value, 'update') &&
    isMissingClockMap(value.missing) &&
    value.update instanceof Uint8Array
  );
}

function readPinnedStore(candidate: Y.Doc): PinnedStructStore {
  const documentRecord = candidate as unknown as Record<PropertyKey, unknown>;
  const store = documentRecord.store;
  if (!isRecord(store)) {
    throw new YjsCausalCompatibilityError('Doc.store is absent or is not an object.');
  }
  for (const field of EXPECTED_STORE_FIELDS) {
    if (!Object.hasOwn(store, field)) {
      throw new YjsCausalCompatibilityError(`StructStore.${field} is absent.`);
    }
  }

  const pendingStructs = store.pendingStructs;
  if (pendingStructs !== null) {
    if (!isPendingStructures(pendingStructs)) {
      throw new YjsCausalCompatibilityError(
        'StructStore.pendingStructs does not match { missing: Map<number, number>, update: Uint8Array } | null.',
      );
    }
  }

  const pendingDs = store.pendingDs;
  if (pendingDs !== null && !(pendingDs instanceof Uint8Array)) {
    throw new YjsCausalCompatibilityError(
      'StructStore.pendingDs does not match Uint8Array | null.',
    );
  }

  return { pendingStructs, pendingDs };
}

/**
 * The pinned Yjs 13.6.32 public API does not expose causal-buffer completeness.
 * Keep all StructStore compatibility assumptions in this one fail-closed boundary.
 */
export function assertCausallyComplete(candidate: Y.Doc): void {
  const store = readPinnedStore(candidate);
  const gapKinds: CausalGapKind[] = [];
  if (store.pendingStructs !== null) gapKinds.push('structure');
  if (store.pendingDs !== null) gapKinds.push('delete-set');
  if (gapKinds.length > 0) throw new CausallyIncompleteUpdateError(Object.freeze(gapKinds));
}
