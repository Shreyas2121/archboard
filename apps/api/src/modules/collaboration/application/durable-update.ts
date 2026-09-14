import type { ErrorCode, ServerSequence } from '@archboard/contracts';

export interface AuthenticatedUpdateActor {
  readonly userId: string;
}

export interface UpdateSessionAuthenticator {
  authenticate(sessionToken: string): Promise<AuthenticatedUpdateActor | null>;
}

export interface ProposedDurableUpdate {
  readonly boardId: string;
  readonly updateId: string;
  readonly sessionToken: string;
  readonly updateBytes: Uint8Array;
}

export interface DurableUpdateReceipt {
  readonly boardId: string;
  readonly updateId: string;
  readonly actorUserId: string;
  readonly payloadHash: Uint8Array;
  readonly sequence: ServerSequence;
  readonly createdAt: Date;
}

export interface DurableUpdateAcceptance {
  readonly receipt: DurableUpdateReceipt;
  readonly acknowledgementEligible: true;
  readonly broadcastEligible: boolean;
}

export class DurableUpdateRejectedError extends Error {
  public constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DurableUpdateRejectedError';
  }
}

export const DURABLE_UPDATE_FAILPOINTS = {
  AFTER_VALIDATION_BEFORE_TRANSACTION: 'after-validation-before-transaction',
  DATABASE_COMMIT: 'database-commit',
  AFTER_COMMIT_BEFORE_ACK: 'after-commit-before-ack',
} as const;

export type DurableUpdateFailpoint =
  (typeof DURABLE_UPDATE_FAILPOINTS)[keyof typeof DURABLE_UPDATE_FAILPOINTS];

export class InjectedDatabaseCommitFailureError extends Error {
  public constructor() {
    super('Injected database commit failure.');
    this.name = 'InjectedDatabaseCommitFailureError';
  }
}

export class InjectedPostCommitCrashError extends Error {
  public constructor() {
    super('Injected crash after commit and before acknowledgement.');
    this.name = 'InjectedPostCommitCrashError';
  }
}

type FailpointAction = () => void | Promise<void>;

export class DurableUpdateFailpointController {
  private readonly actions = new Map<DurableUpdateFailpoint, FailpointAction>();

  public arm(point: DurableUpdateFailpoint, action?: FailpointAction): void {
    this.actions.set(point, action ?? (() => this.defaultFailure(point)));
  }

  public async reach(point: DurableUpdateFailpoint): Promise<void> {
    const action = this.actions.get(point);
    if (action === undefined) return;
    this.actions.delete(point);
    await action();
  }

  private defaultFailure(point: DurableUpdateFailpoint): never {
    if (point === DURABLE_UPDATE_FAILPOINTS.AFTER_COMMIT_BEFORE_ACK) {
      throw new InjectedPostCommitCrashError();
    }
    throw new InjectedDatabaseCommitFailureError();
  }
}
