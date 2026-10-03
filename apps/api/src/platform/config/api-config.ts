import { z } from 'zod';

import {
  BETTER_AUTH_IDLE_TIMEOUT_MS_DEFAULT,
  BETTER_AUTH_POOL_MAX_DEFAULT,
  DATABASE_CONNECTION_TIMEOUT_MS_DEFAULT,
  TYPEORM_POOL_MAX_DEFAULT,
} from './operational-defaults.js';

const MIN_PORT = 1;
const MAX_PORT = 65_535;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const MIN_POOL_SIZE = 1;
const MAX_POOL_SIZE = 50;
const MIN_DATABASE_TIMEOUT_MS = 1;
const MAX_DATABASE_TIMEOUT_MS = 120_000;
const MIN_BETTER_AUTH_SECRET_CHARACTERS = 32;
const GITHUB_CLIENT_ID_PATTERN = /^[A-Za-z0-9._-]{16,128}$/;
const GITHUB_CLIENT_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;
const GITHUB_PLACEHOLDER_PREFIX = 'replace-with-';

const deploymentModeSchema = z.enum(['development', 'test', 'production']);

const requiredValue = (name: string) =>
  z
    .string({ error: `${name} is required.` })
    .trim()
    .min(1, `${name} is required.`);

const boundedInteger = (name: string, minimum: number, maximum: number, defaultValue: number) =>
  z
    .string()
    .regex(/^\d+$/, `${name} must be a base-10 integer.`)
    .default(String(defaultValue))
    .transform(Number)
    .pipe(z.number().int().min(minimum).max(maximum));

function isExactOrigin(value: string, protocols: ReadonlySet<string>): boolean {
  try {
    const url = new URL(value);

    return (
      !value.includes('*') &&
      protocols.has(url.protocol) &&
      url.username === '' &&
      url.password === '' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

function isSecureOrLocalHttpOrigin(value: string, mode: z.infer<typeof deploymentModeSchema>) {
  const url = new URL(value);
  return url.protocol === 'https:' || (mode !== 'production' && LOCAL_HOSTNAMES.has(url.hostname));
}

const rawApiConfigSchema = z
  .object({
    NODE_ENV: deploymentModeSchema.default('development'),
    PUBLIC_API_ORIGIN: requiredValue('PUBLIC_API_ORIGIN'),
    ALLOWED_WEB_ORIGINS: requiredValue('ALLOWED_WEB_ORIGINS'),
    PORT: requiredValue('PORT')
      .regex(/^\d+$/, 'PORT must be a base-10 integer.')
      .transform(Number)
      .pipe(
        z
          .number()
          .int('PORT must be an integer.')
          .min(MIN_PORT, `PORT must be between ${MIN_PORT} and ${MAX_PORT}.`)
          .max(MAX_PORT, `PORT must be between ${MIN_PORT} and ${MAX_PORT}.`),
      ),
    DATABASE_URL: requiredValue('DATABASE_URL'),
    DATABASE_DIRECT_URL: requiredValue('DATABASE_DIRECT_URL'),
    TYPEORM_POOL_MAX: boundedInteger(
      'TYPEORM_POOL_MAX',
      MIN_POOL_SIZE,
      MAX_POOL_SIZE,
      TYPEORM_POOL_MAX_DEFAULT,
    ),
    BETTER_AUTH_POOL_MAX: boundedInteger(
      'BETTER_AUTH_POOL_MAX',
      MIN_POOL_SIZE,
      MAX_POOL_SIZE,
      BETTER_AUTH_POOL_MAX_DEFAULT,
    ),
    DATABASE_CONNECTION_TIMEOUT_MS: boundedInteger(
      'DATABASE_CONNECTION_TIMEOUT_MS',
      MIN_DATABASE_TIMEOUT_MS,
      MAX_DATABASE_TIMEOUT_MS,
      DATABASE_CONNECTION_TIMEOUT_MS_DEFAULT,
    ),
    BETTER_AUTH_IDLE_TIMEOUT_MS: boundedInteger(
      'BETTER_AUTH_IDLE_TIMEOUT_MS',
      MIN_DATABASE_TIMEOUT_MS,
      MAX_DATABASE_TIMEOUT_MS,
      BETTER_AUTH_IDLE_TIMEOUT_MS_DEFAULT,
    ),
    BETTER_AUTH_SECRET: requiredValue('BETTER_AUTH_SECRET').min(
      MIN_BETTER_AUTH_SECRET_CHARACTERS,
      `BETTER_AUTH_SECRET must contain at least ${MIN_BETTER_AUTH_SECRET_CHARACTERS} characters.`,
    ),
    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
  })
  .strict();

export interface ApiConfig {
  readonly mode: z.infer<typeof deploymentModeSchema>;
  readonly publicApiOrigin: string;
  readonly allowedWebOrigins: readonly string[];
  readonly port: number;
  readonly databaseUrl: string;
  readonly databaseDirectUrl: string;
  readonly typeormPoolMax: number;
  readonly betterAuthPoolMax: number;
  readonly databaseConnectionTimeoutMs: number;
  readonly betterAuthIdleTimeoutMs: number;
  readonly betterAuthSecret: string;
  readonly githubClientId: string | null;
  readonly githubClientSecret: string | null;
}

interface ConfigIssue {
  readonly variable: string;
  readonly message: string;
}

export class ConfigurationError extends Error {
  public readonly variables: readonly string[];

  public constructor(application: 'API' | 'web', issues: readonly ConfigIssue[]) {
    const details = issues.map((issue) => `${issue.variable}: ${issue.message}`);
    super(`Invalid ${application} configuration:\n- ${details.join('\n- ')}`);
    this.name = 'ConfigurationError';
    this.variables = [...new Set(issues.map((issue) => issue.variable))];
  }
}

function validateDatabaseUrl(value: string, name: string, issues: ConfigIssue[]): void {
  try {
    const url = new URL(value);
    if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
      issues.push({
        message: `${name} must use the postgres: or postgresql: protocol.`,
        variable: name,
      });
    }
  } catch {
    issues.push({
      message: `${name} must be a valid PostgreSQL URL.`,
      variable: name,
    });
  }
}

export function loadApiConfig(environment: NodeJS.ProcessEnv): ApiConfig {
  const parsed = rawApiConfigSchema.safeParse({
    NODE_ENV: environment.NODE_ENV,
    PUBLIC_API_ORIGIN: environment.PUBLIC_API_ORIGIN,
    ALLOWED_WEB_ORIGINS: environment.ALLOWED_WEB_ORIGINS,
    PORT: environment.PORT,
    DATABASE_URL: environment.DATABASE_URL,
    DATABASE_DIRECT_URL: environment.DATABASE_DIRECT_URL,
    TYPEORM_POOL_MAX: environment.TYPEORM_POOL_MAX,
    BETTER_AUTH_POOL_MAX: environment.BETTER_AUTH_POOL_MAX,
    DATABASE_CONNECTION_TIMEOUT_MS: environment.DATABASE_CONNECTION_TIMEOUT_MS,
    BETTER_AUTH_IDLE_TIMEOUT_MS: environment.BETTER_AUTH_IDLE_TIMEOUT_MS,
    BETTER_AUTH_SECRET: environment.BETTER_AUTH_SECRET,
    GITHUB_CLIENT_ID: environment.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: environment.GITHUB_CLIENT_SECRET,
  });
  if (!parsed.success) {
    throw new ConfigurationError(
      'API',
      parsed.error.issues.map((issue) => ({
        message: issue.message,
        variable: String(issue.path[0] ?? 'environment'),
      })),
    );
  }

  const issues: ConfigIssue[] = [];
  const { NODE_ENV: mode, PUBLIC_API_ORIGIN: publicApiOrigin } = parsed.data;

  if (!isExactOrigin(publicApiOrigin, HTTP_PROTOCOLS)) {
    issues.push({
      message:
        'PUBLIC_API_ORIGIN must be an exact HTTP(S) origin without a path, credentials, query, fragment, or wildcard.',
      variable: 'PUBLIC_API_ORIGIN',
    });
  } else if (!isSecureOrLocalHttpOrigin(publicApiOrigin, mode)) {
    issues.push({
      message:
        'PUBLIC_API_ORIGIN must use HTTPS in production; HTTP is allowed only for local development hosts.',
      variable: 'PUBLIC_API_ORIGIN',
    });
  }

  const allowedWebOrigins = parsed.data.ALLOWED_WEB_ORIGINS.split(',').map((origin) =>
    origin.trim(),
  );
  if (allowedWebOrigins.some((origin) => !isExactOrigin(origin, HTTP_PROTOCOLS))) {
    issues.push({
      message: 'ALLOWED_WEB_ORIGINS must be a comma-separated list of exact HTTP(S) origins.',
      variable: 'ALLOWED_WEB_ORIGINS',
    });
  } else if (allowedWebOrigins.some((origin) => !isSecureOrLocalHttpOrigin(origin, mode))) {
    issues.push({
      message:
        'ALLOWED_WEB_ORIGINS must use HTTPS in production; HTTP is allowed only for local development hosts.',
      variable: 'ALLOWED_WEB_ORIGINS',
    });
  }

  if (new Set(allowedWebOrigins).size !== allowedWebOrigins.length) {
    issues.push({
      message: 'ALLOWED_WEB_ORIGINS must not contain duplicate origins.',
      variable: 'ALLOWED_WEB_ORIGINS',
    });
  }

  validateDatabaseUrl(parsed.data.DATABASE_URL, 'DATABASE_URL', issues);
  if (
    mode === 'production' &&
    (allowedWebOrigins.length !== 1 || allowedWebOrigins[0] !== publicApiOrigin)
  ) {
    issues.push({
      variable: 'ALLOWED_WEB_ORIGINS',
      message:
        'Production frontend, auth, REST and WebSocket traffic must share PUBLIC_API_ORIGIN.',
    });
  }
  validateDatabaseUrl(parsed.data.DATABASE_DIRECT_URL, 'DATABASE_DIRECT_URL', issues);

  const githubClientId = parsed.data.GITHUB_CLIENT_ID?.trim() || null;
  const githubClientSecret = parsed.data.GITHUB_CLIENT_SECRET?.trim() || null;
  if (mode === 'production' || githubClientId !== null || githubClientSecret !== null) {
    if (
      githubClientId === null ||
      !GITHUB_CLIENT_ID_PATTERN.test(githubClientId) ||
      githubClientId.startsWith(GITHUB_PLACEHOLDER_PREFIX)
    ) {
      issues.push({
        variable: 'GITHUB_CLIENT_ID',
        message: 'GITHUB_CLIENT_ID must be a valid GitHub OAuth client ID.',
      });
    }
    if (
      githubClientSecret === null ||
      !GITHUB_CLIENT_SECRET_PATTERN.test(githubClientSecret) ||
      githubClientSecret.startsWith(GITHUB_PLACEHOLDER_PREFIX)
    ) {
      issues.push({
        variable: 'GITHUB_CLIENT_SECRET',
        message: 'GITHUB_CLIENT_SECRET must be a valid GitHub OAuth client secret.',
      });
    }
  }

  if (issues.length > 0) {
    throw new ConfigurationError('API', issues);
  }

  return Object.freeze({
    mode,
    publicApiOrigin,
    allowedWebOrigins: Object.freeze(allowedWebOrigins),
    port: parsed.data.PORT,
    databaseUrl: parsed.data.DATABASE_URL,
    databaseDirectUrl: parsed.data.DATABASE_DIRECT_URL,
    typeormPoolMax: parsed.data.TYPEORM_POOL_MAX,
    betterAuthPoolMax: parsed.data.BETTER_AUTH_POOL_MAX,
    databaseConnectionTimeoutMs: parsed.data.DATABASE_CONNECTION_TIMEOUT_MS,
    betterAuthIdleTimeoutMs: parsed.data.BETTER_AUTH_IDLE_TIMEOUT_MS,
    betterAuthSecret: parsed.data.BETTER_AUTH_SECRET,
    githubClientId,
    githubClientSecret,
  });
}
