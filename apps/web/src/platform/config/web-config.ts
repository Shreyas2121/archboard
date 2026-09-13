import { z } from 'zod';

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

const rawWebConfigSchema = z
  .object({
    VITE_API_ORIGIN: z.string({ error: 'VITE_API_ORIGIN is required.' }).trim().min(1),
    VITE_WS_ORIGIN: z.string({ error: 'VITE_WS_ORIGIN is required.' }).trim().min(1),
    MODE: z.enum(['development', 'test', 'production']).default('development'),
  })
  .strict();

export interface WebConfig {
  readonly apiOrigin: string;
  readonly webSocketOrigin: string;
}

function validateOrigin(
  value: string,
  name: 'VITE_API_ORIGIN' | 'VITE_WS_ORIGIN',
  secureProtocol: 'https:' | 'wss:',
  localProtocol: 'http:' | 'ws:',
  mode: 'development' | 'test' | 'production',
): string | undefined {
  try {
    const url = new URL(value);
    const isLocal = LOCAL_HOSTNAMES.has(url.hostname);
    const protocolAllowed =
      url.protocol === secureProtocol ||
      (mode !== 'production' && isLocal && url.protocol === localProtocol);
    const isExact =
      !value.includes('*') &&
      url.username === '' &&
      url.password === '' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      url.origin === value;

    if (!protocolAllowed || !isExact) {
      return `${name} must be an exact ${secureProtocol.slice(0, -1).toUpperCase()} origin; ${localProtocol.slice(0, -1).toUpperCase()} is allowed only for local development hosts.`;
    }
  } catch {
    return `${name} must be a valid origin.`;
  }

  return undefined;
}

export function loadWebConfig(environment: Record<string, unknown>): WebConfig {
  const parsed = rawWebConfigSchema.safeParse({
    MODE: environment.MODE,
    VITE_API_ORIGIN: environment.VITE_API_ORIGIN,
    VITE_WS_ORIGIN: environment.VITE_WS_ORIGIN,
  });
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid web configuration:\n- ${details.join('\n- ')}`);
  }

  const errors = [
    validateOrigin(
      parsed.data.VITE_API_ORIGIN,
      'VITE_API_ORIGIN',
      'https:',
      'http:',
      parsed.data.MODE,
    ),
    validateOrigin(parsed.data.VITE_WS_ORIGIN, 'VITE_WS_ORIGIN', 'wss:', 'ws:', parsed.data.MODE),
  ].filter((error): error is string => error !== undefined);

  if (errors.length > 0) {
    throw new Error(`Invalid web configuration:\n- ${errors.join('\n- ')}`);
  }

  return Object.freeze({
    apiOrigin: parsed.data.VITE_API_ORIGIN,
    webSocketOrigin: parsed.data.VITE_WS_ORIGIN,
  });
}
