import { ConfigurationError } from '../config/api-config.js';
import { CollaborationWriterLockUnavailableError } from '../database/collaboration-writer-lock.service.js';
import { StartupReadinessUnavailableError } from './startup-errors.js';

export type StartupStage =
  'configuration' | 'application_creation' | 'http_setup' | 'application_initialization' | 'listen';

const CONFIGURATION_VARIABLES = new Set([
  'NODE_ENV',
  'PUBLIC_API_ORIGIN',
  'ALLOWED_WEB_ORIGINS',
  'PORT',
  'DATABASE_URL',
  'DATABASE_DIRECT_URL',
  'TYPEORM_POOL_MAX',
  'BETTER_AUTH_POOL_MAX',
  'DATABASE_CONNECTION_TIMEOUT_MS',
  'BETTER_AUTH_IDLE_TIMEOUT_MS',
  'BETTER_AUTH_SECRET',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
]);

// Only fixed codes are public. Driver messages, stacks and SQL can contain secrets.
const EXTERNAL_ERROR_CODES = new Map([
  ['ECONNREFUSED', 'CONNECTION_REFUSED'],
  ['ECONNRESET', 'CONNECTION_RESET'],
  ['ETIMEDOUT', 'CONNECTION_TIMEOUT'],
  ['ENOTFOUND', 'HOST_NOT_FOUND'],
  ['EAI_AGAIN', 'DNS_TEMPORARILY_UNAVAILABLE'],
  ['EADDRINUSE', 'PORT_IN_USE'],
  ['EACCES', 'PERMISSION_DENIED'],
  ['28P01', 'DATABASE_AUTHENTICATION_FAILED'],
  ['28000', 'DATABASE_AUTHORIZATION_FAILED'],
  ['3D000', 'DATABASE_NOT_FOUND'],
  ['53300', 'DATABASE_CONNECTION_LIMIT'],
  ['57P03', 'DATABASE_UNAVAILABLE'],
  ['DEPTH_ZERO_SELF_SIGNED_CERT', 'TLS_CERTIFICATE_REJECTED'],
  ['SELF_SIGNED_CERT_IN_CHAIN', 'TLS_CERTIFICATE_REJECTED'],
  ['CERT_HAS_EXPIRED', 'TLS_CERTIFICATE_EXPIRED'],
  ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'TLS_CERTIFICATE_REJECTED'],
]);

function emit(record: Readonly<Record<string, unknown>>): void {
  try {
    console.info(JSON.stringify(record));
  } catch {
    // Diagnostic failures must not prevent startup failure handling.
  }
}

export function logStartupStage(stage: StartupStage): void {
  emit({ event: 'runtime.startup_stage', stage });
}

export function logStartupFailure(stage: StartupStage, error: unknown): void {
  let code = 'STARTUP_FAILED';
  let variables: readonly string[] | undefined;
  if (error instanceof ConfigurationError) {
    code = 'INVALID_CONFIGURATION';
    variables = error.variables.filter((variable) => CONFIGURATION_VARIABLES.has(variable));
  } else if (error instanceof CollaborationWriterLockUnavailableError) {
    code = 'WRITER_ALREADY_RUNNING';
  } else if (error instanceof StartupReadinessUnavailableError) {
    code = 'STARTUP_READINESS_UNAVAILABLE';
  } else {
    try {
      if (typeof error === 'object' && error !== null && 'code' in error) {
        const externalCode = error.code;
        if (typeof externalCode === 'string') code = EXTERNAL_ERROR_CODES.get(externalCode) ?? code;
      }
    } catch {
      // Unknown exception objects may have throwing getters; never serialize them.
    }
  }
  emit({ event: 'runtime.startup_failed', stage, code, ...(variables ? { variables } : {}) });
}
