import { ERROR_CODES, type ErrorCode } from '@archboard/contracts';

export interface DocumentValidationIssue {
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export class DocumentValidationError extends Error {
  readonly code: ErrorCode;
  readonly issues: readonly DocumentValidationIssue[];

  constructor(
    issues: readonly DocumentValidationIssue[],
    code: ErrorCode = ERROR_CODES.DOCUMENT_INVALID,
  ) {
    super(issues[0]?.message ?? 'The Yjs document is invalid.');
    this.name = 'DocumentValidationError';
    this.code = code;
    this.issues = issues;
  }
}
