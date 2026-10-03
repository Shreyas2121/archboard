import {
  ERROR_CODES,
  MAX_CLIENT_UPDATE_BYTES,
  MAX_ENCODED_YJS_STATE_BYTES,
  MAX_VALIDATION_QUEUE,
  MAX_VALIDATION_WORKERS,
  VALIDATION_TIMEOUT_MS,
  type ErrorCode,
} from '@archboard/contracts';
import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { reportCollaborationMetric } from '../../application/collaboration-metrics.js';
import { MAX_REPLAY_BYTES, MAX_REPLAY_RECORDS } from '../room/committed-graph.js';
import type {
  CandidateValidator,
  CandidateValidationInput,
} from '../../application/candidate-validator.js';
export type { CandidateValidationInput } from '../../application/candidate-validator.js';

import {
  VALIDATION_FAILURE_KINDS,
  VALIDATION_WORKER_DIRECTIVES,
  type ValidationFailureKind,
  type ValidationWorkerDirective,
  type ValidationWorkerRequest,
  type ValidationWorkerResponse,
  type ValidationWorkerSuccess,
} from './validation-worker.protocol.js';

export interface ValidationWorkerPoolOptions {
  readonly timeoutMs?: number;
  readonly maxWorkers?: number;
  readonly maxQueueDepth?: number;
  readonly workerUrl?: URL;
}

interface ValidationJob {
  readonly enqueuedAt: number;
  readonly input: CandidateValidationInput;
  readonly directive: ValidationWorkerDirective;
  readonly resolve: (result: ValidationWorkerSuccess) => void;
  readonly reject: (error: ValidationWorkerError) => void;
}

export class ValidationWorkerError extends Error {
  public constructor(
    public readonly code: ErrorCode,
    public readonly kind: ValidationFailureKind,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ValidationWorkerError';
  }
}

function requirePositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be positive.`);
}

function requireNonNegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} cannot be negative.`);
}

function defaultWorkerUrl(): URL {
  const adjacent = new URL('./validation-worker.entry.js', import.meta.url);
  if (existsSync(adjacent)) return adjacent;
  // Source-mode Nest tests run against compiled worker assets in dist.
  return new URL(
    '../../../../../dist/modules/collaboration/infrastructure/validation-worker/validation-worker.entry.js',
    import.meta.url,
  );
}

export class ValidationWorkerPool implements CandidateValidator {
  readonly timeoutMs: number;
  readonly maxWorkers: number;
  readonly maxQueueDepth: number;

  private readonly workerUrl: URL;
  private readonly queue: ValidationJob[] = [];
  private readonly workers = new Set<Worker>();
  private readonly cancelActive = new Map<Worker, () => void>();
  private readonly finishedWorkers = new Map<
    Worker,
    { promise: Promise<void>; resolve: () => void }
  >();
  private closing?: Promise<void>;
  private nextDirective: ValidationWorkerDirective = VALIDATION_WORKER_DIRECTIVES.VALIDATE;
  private closed = false;

  public constructor(options: ValidationWorkerPoolOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? VALIDATION_TIMEOUT_MS;
    this.maxWorkers = options.maxWorkers ?? MAX_VALIDATION_WORKERS;
    this.maxQueueDepth = options.maxQueueDepth ?? MAX_VALIDATION_QUEUE;
    this.workerUrl = options.workerUrl ?? defaultWorkerUrl();
    requirePositiveInteger('timeoutMs', this.timeoutMs);
    requirePositiveInteger('maxWorkers', this.maxWorkers);
    requireNonNegativeInteger('maxQueueDepth', this.maxQueueDepth);
  }

  public get activeWorkerCount(): number {
    return this.workers.size;
  }

  public get queueDepth(): number {
    return this.queue.length;
  }

  /** Test-only deterministic fault injection; it affects exactly the next submitted job. */
  public injectNextWorkerDirective(directive: ValidationWorkerDirective): void {
    this.nextDirective = directive;
  }

  public validate(input: CandidateValidationInput): Promise<ValidationWorkerSuccess> {
    if (this.closed) {
      return Promise.reject(this.workerFailure('The validation worker pool is closed.'));
    }
    if (
      !(input.acceptedState instanceof Uint8Array) ||
      !(input.update instanceof Uint8Array) ||
      input.acceptedState.byteLength > MAX_ENCODED_YJS_STATE_BYTES ||
      input.update.byteLength > MAX_CLIENT_UPDATE_BYTES ||
      (input.reconstruction !== undefined &&
        (input.reconstruction.updates.length > MAX_REPLAY_RECORDS ||
          input.reconstruction.updates.some(
            (update) =>
              !(update instanceof Uint8Array) || update.byteLength > MAX_CLIENT_UPDATE_BYTES,
          ) ||
          input.acceptedState.byteLength +
            input.reconstruction.updates.reduce((bytes, update) => bytes + update.byteLength, 0) >
            MAX_REPLAY_BYTES))
    ) {
      return Promise.reject(
        new ValidationWorkerError(
          ERROR_CODES.DOCUMENT_LIMIT,
          VALIDATION_FAILURE_KINDS.DOCUMENT_LIMIT,
          'The update or accepted state exceeds its byte limit.',
          false,
        ),
      );
    }
    if (this.workers.size >= this.maxWorkers && this.queue.length >= this.maxQueueDepth) {
      reportCollaborationMetric('collaboration.validation_reject', {
        kind: VALIDATION_FAILURE_KINDS.OVERLOADED,
        count: 1,
      });
      return Promise.reject(
        new ValidationWorkerError(
          ERROR_CODES.SERVER_BUSY,
          VALIDATION_FAILURE_KINDS.OVERLOADED,
          'The validation queue is full.',
          true,
        ),
      );
    }

    const directive = this.nextDirective;
    this.nextDirective = VALIDATION_WORKER_DIRECTIVES.VALIDATE;
    return new Promise((resolve, reject) => {
      // Snapshot caller-owned buffers at admission, including jobs waiting in the queue.
      const job: ValidationJob = {
        enqueuedAt: performance.now(),
        input: {
          acceptedState: Uint8Array.from(input.acceptedState),
          update: Uint8Array.from(input.update),
          ...(input.reconstruction === undefined
            ? {}
            : {
                reconstruction: {
                  remap: input.reconstruction.remap,
                  updates: input.reconstruction.updates.map((update) => Uint8Array.from(update)),
                },
              }),
        },
        directive,
        resolve,
        reject,
      };
      if (this.workers.size < this.maxWorkers) this.start(job);
      else this.queue.push(job);
    });
  }

  public close(): Promise<void> {
    if (this.closing !== undefined) return this.closing;
    this.closed = true;
    const error = this.workerFailure('The validation worker pool is closed.');
    for (const job of this.queue.splice(0)) job.reject(error);
    for (const cancel of this.cancelActive.values()) cancel();
    this.closing = Promise.all(
      [...this.finishedWorkers.values()].map((finished) => finished.promise),
    ).then(() => undefined);
    return this.closing;
  }

  private start(job: ValidationJob): void {
    const startedAt = performance.now();
    reportCollaborationMetric('collaboration.validation_queue', {
      durationMs: Math.max(0, startedAt - job.enqueuedAt),
      depth: this.queue.length,
    });
    const request: ValidationWorkerRequest = {
      acceptedState: job.input.acceptedState,
      update: job.input.update,
      directive: job.directive,
      ...(job.input.reconstruction === undefined
        ? {}
        : { reconstruction: job.input.reconstruction }),
    };
    let worker: Worker;
    try {
      worker = new Worker(this.workerUrl, { workerData: request });
    } catch {
      job.reject(this.workerFailure());
      return;
    }
    this.workers.add(worker);
    let resolveFinished!: () => void;
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    this.finishedWorkers.set(worker, { promise: finished, resolve: resolveFinished });
    let settled = false;

    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      reportCollaborationMetric('collaboration.validation_worker', {
        durationMs: Math.max(0, performance.now() - startedAt),
      });
      clearTimeout(timer);
      worker.removeAllListeners();
      void worker.terminate().then(
        () => this.finalize(worker, action),
        () => this.finalize(worker, action),
      );
    };

    const timer = setTimeout(() => {
      reportCollaborationMetric('collaboration.validation_reject', {
        kind: VALIDATION_FAILURE_KINDS.TIMEOUT,
        count: 1,
      });
      finish(() =>
        job.reject(
          new ValidationWorkerError(
            ERROR_CODES.SERVER_BUSY,
            VALIDATION_FAILURE_KINDS.TIMEOUT,
            `Candidate validation exceeded ${this.timeoutMs} ms.`,
            true,
          ),
        ),
      );
    }, this.timeoutMs);
    timer.unref();
    this.cancelActive.set(worker, () =>
      finish(() => job.reject(this.workerFailure('The validation worker pool is closed.'))),
    );

    worker.once('message', (response: ValidationWorkerResponse) => {
      finish(() => {
        if (response.ok) job.resolve(response);
        else {
          reportCollaborationMetric('collaboration.validation_reject', {
            kind: response.kind,
            count: 1,
          });
          job.reject(
            new ValidationWorkerError(response.code, response.kind, response.message, false),
          );
        }
      });
    });
    worker.once('error', () => finish(() => job.reject(this.workerFailure())));
    worker.once('exit', (code) => {
      finish(() => job.reject(this.workerFailure(`The validation worker exited (${code}).`)));
    });
  }

  private drain(): void {
    while (!this.closed && this.workers.size < this.maxWorkers) {
      const job = this.queue.shift();
      if (job === undefined) break;
      this.start(job);
    }
  }

  private finalize(worker: Worker, action: () => void): void {
    this.workers.delete(worker);
    this.cancelActive.delete(worker);
    this.finishedWorkers.get(worker)?.resolve();
    this.finishedWorkers.delete(worker);
    action();
    this.drain();
  }

  private workerFailure(message = 'The validation worker failed.'): ValidationWorkerError {
    return new ValidationWorkerError(
      ERROR_CODES.SERVER_BUSY,
      VALIDATION_FAILURE_KINDS.WORKER_FAILURE,
      message,
      true,
    );
  }
}
