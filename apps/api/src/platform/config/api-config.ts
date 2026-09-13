import { z } from 'zod';

const MIN_PORT = 1;
const MAX_PORT = 65_535;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

const deploymentModeSchema = z.enum(['development', 'test', 'production']);

const requiredValue = (name: string) =>
  z
    .string({ error: `${name} is required.` })
    .trim()
    .min(1, `${name} is required.`);

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
  })
  .strict();

export interface ApiConfig {
  readonly mode: z.infer<typeof deploymentModeSchema>;
  readonly publicApiOrigin: string;
  readonly allowedWebOrigins: readonly string[];
  readonly port: number;
  readonly databaseUrl: string;
  readonly databaseDirectUrl: string;
}

interface ConfigIssue {
  readonly variable: string;
  readonly message: string;
}

export class ConfigurationError extends Error {
  public constructor(application: 'API' | 'web', issues: readonly ConfigIssue[]) {
    const details = issues.map((issue) => `${issue.variable}: ${issue.message}`);
    super(`Invalid ${application} configuration:\n- ${details.join('\n- ')}`);
    this.name = 'ConfigurationError';
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
  validateDatabaseUrl(parsed.data.DATABASE_DIRECT_URL, 'DATABASE_DIRECT_URL', issues);

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
  });
}
