import type { ErrorCode } from '@archboard/contracts';

export const VALIDATION_FAILURE_KINDS = {
  CAUSAL_GAP: 'causal-gap',
  DOCUMENT_INVALID: 'document-invalid',
  DOCUMENT_LIMIT: 'document-limit',
  OVERLOADED: 'overloaded',
  TIMEOUT: 'timeout',
  WORKER_FAILURE: 'worker-failure',
} as const;

export type ValidationFailureKind =
  (typeof VALIDATION_FAILURE_KINDS)[keyof typeof VALIDATION_FAILURE_KINDS];

export const VALIDATION_WORKER_DIRECTIVES = {
  VALIDATE: 'validate',
  HANG: 'hang',
  CRASH: 'crash',
} as const;

export type ValidationWorkerDirective =
  (typeof VALIDATION_WORKER_DIRECTIVES)[keyof typeof VALIDATION_WORKER_DIRECTIVES];

export interface ValidationWorkerRequest {
  readonly acceptedState: Uint8Array;
  readonly update: Uint8Array;
  readonly directive: ValidationWorkerDirective;
}

export interface ValidationWorkerSuccess {
  readonly ok: true;
  readonly candidateState: Uint8Array;
  readonly elapsedMs: number;
  readonly heapUsedBytes: number;
}

export interface ValidationWorkerFailure {
  readonly ok: false;
  readonly code: ErrorCode;
  readonly kind: ValidationFailureKind;
  readonly message: string;
}

export type ValidationWorkerResponse = ValidationWorkerSuccess | ValidationWorkerFailure;
