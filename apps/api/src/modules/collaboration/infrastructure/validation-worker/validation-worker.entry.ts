import { ERROR_CODES, type ErrorCode } from '@archboard/contracts';
import { DocumentValidationError, validateGraphDocument } from '@archboard/document-model';
import { parentPort, workerData } from 'node:worker_threads';
import * as Y from 'yjs';

import {
  assertCausallyComplete,
  CausallyIncompleteUpdateError,
} from '../yjs-compatibility/index.js';
import {
  VALIDATION_FAILURE_KINDS,
  VALIDATION_WORKER_DIRECTIVES,
  type ValidationFailureKind,
  type ValidationWorkerRequest,
  type ValidationWorkerResponse,
} from './validation-worker.protocol.js';

const HANG_KEEPALIVE_MS = 60_000;

function failure(
  code: ErrorCode,
  kind: ValidationFailureKind,
  message: string,
): ValidationWorkerResponse {
  return { ok: false, code, kind, message };
}

function mapFailure(error: unknown): ValidationWorkerResponse {
  if (error instanceof CausallyIncompleteUpdateError) {
    return failure(
      ERROR_CODES.CAUSAL_GAP,
      VALIDATION_FAILURE_KINDS.CAUSAL_GAP,
      'The update has missing causal dependencies.',
    );
  }
  if (error instanceof DocumentValidationError) {
    const kind =
      error.code === ERROR_CODES.DOCUMENT_LIMIT
        ? VALIDATION_FAILURE_KINDS.DOCUMENT_LIMIT
        : VALIDATION_FAILURE_KINDS.DOCUMENT_INVALID;
    return failure(error.code, kind, error.message);
  }
  return failure(
    ERROR_CODES.DOCUMENT_INVALID,
    VALIDATION_FAILURE_KINDS.DOCUMENT_INVALID,
    'The update could not be decoded or validated.',
  );
}

function validate(request: ValidationWorkerRequest): ValidationWorkerResponse {
  const startedAt = performance.now();
  const accepted = new Y.Doc();
  const candidate = new Y.Doc();
  try {
    Y.applyUpdate(accepted, request.acceptedState);
    assertCausallyComplete(accepted);
    validateGraphDocument(accepted);

    Y.applyUpdate(candidate, request.acceptedState);
    Y.applyUpdate(candidate, request.update);
    assertCausallyComplete(candidate);
    validateGraphDocument(candidate, accepted);

    return {
      ok: true,
      candidateState: Y.encodeStateAsUpdate(candidate),
      elapsedMs: performance.now() - startedAt,
      heapUsedBytes: process.memoryUsage().heapUsed,
    };
  } catch (error) {
    return mapFailure(error);
  } finally {
    accepted.destroy();
    candidate.destroy();
  }
}

const request = workerData as ValidationWorkerRequest;
if (request.directive === VALIDATION_WORKER_DIRECTIVES.CRASH) {
  throw new Error('Injected validation worker crash.');
}
if (request.directive === VALIDATION_WORKER_DIRECTIVES.HANG) {
  setInterval(() => undefined, HANG_KEEPALIVE_MS);
} else {
  const response = validate(request);
  parentPort?.postMessage(
    response,
    response.ok ? [response.candidateState.buffer as ArrayBuffer] : undefined,
  );
}
