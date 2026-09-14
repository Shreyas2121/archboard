import { ERROR_CODES, type ErrorCode } from '@archboard/contracts';
import { Worker } from 'node:worker_threads';

import {
  MAX_VALIDATION_QUEUE_DEPTH,
  MAX_VALIDATION_WORKERS,
  VALIDATION_TIMEOUT_MS,
} from '../../../../platform/config/index.js';
import {
  VALIDATION_FAILURE_KINDS,
  VALIDATION_WORKER_DIRECTIVES,
  type ValidationFailureKind,
  type ValidationWorkerDirective,
  type ValidationWorkerRequest,
  type ValidationWorkerResponse,
  type ValidationWorkerSuccess,
} from './validation-worker.protocol.js';

export interface CandidateValidationInput {
  readonly acceptedState: Uint8Array;
  readonly update: Uint8Array;
}

export interface ValidationWorkerPoolOptions {
  readonly timeoutMs?: number;
  readonly maxWorkers?: number;
  readonly maxQueueDepth?: number;
  readonly workerUrl?: URL;
}

interface ValidationJob {
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

export class ValidationWorkerPool {
  readonly timeoutMs: number;
  readonly maxWorkers: number;
  readonly maxQueueDepth: number;

  private readonly workerUrl: URL;
  private readonly queue: ValidationJob[] = [];
  private readonly workers = new Set<Worker>();
  private nextDirective: ValidationWorkerDirective = VALIDATION_WORKER_DIRECTIVES.VALIDATE;
  private closed = false;

  public constructor(options: ValidationWorkerPoolOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? VALIDATION_TIMEOUT_MS;
    this.maxWorkers = options.maxWorkers ?? MAX_VALIDATION_WORKERS;
    this.maxQueueDepth = options.maxQueueDepth ?? MAX_VALIDATION_QUEUE_DEPTH;
    this.workerUrl = options.workerUrl ?? new URL('./validation-worker.entry.js', import.meta.url);
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
    if (this.workers.size >= this.maxWorkers && this.queue.length >= this.maxQueueDepth) {
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
      const job: ValidationJob = { input, directive, resolve, reject };
      if (this.workers.size < this.maxWorkers) this.start(job);
      else this.queue.push(job);
    });
  }

  public async close(): Promise<void> {
    this.closed = true;
    const error = this.workerFailure('The validation worker pool is closed.');
    for (const job of this.queue.splice(0)) job.reject(error);
    await Promise.all([...this.workers].map(async (worker) => worker.terminate()));
  }

  private start(job: ValidationJob): void {
    const request: ValidationWorkerRequest = {
      acceptedState: job.input.acceptedState.slice(),
      update: job.input.update.slice(),
      directive: job.directive,
    };
    const worker = new Worker(this.workerUrl, { workerData: request });
    this.workers.add(worker);
    let settled = false;

    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeAllListeners();
      void worker.terminate().then(
        () => this.finalize(worker, action),
        () => this.finalize(worker, action),
      );
    };

    const timer = setTimeout(() => {
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

    worker.once('message', (response: ValidationWorkerResponse) => {
      finish(() => {
        if (response.ok) job.resolve(response);
        else {
          job.reject(
            new ValidationWorkerError(response.code, response.kind, response.message, false),
          );
        }
      });
    });
    worker.once('error', () => finish(() => job.reject(this.workerFailure())));
    worker.once('exit', (code) => {
      if (code !== 0) finish(() => job.reject(this.workerFailure()));
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
