import {
  ERROR_CODES,
  apiErrorEnvelopeSchema,
  currentUserResponseSchema,
  type CurrentUser,
  type ErrorCode,
} from '@archboard/contracts';
import type { z } from 'zod';

import { loadWebConfig } from '@/platform/config';

const API_ORIGIN = loadWebConfig(import.meta.env).apiOrigin;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NO_CONTENT = 204;
const HTTP_SERVER_ERROR = 500;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MILLISECONDS_PER_SECOND = 1000;

export type ApiFailureKind = 'unauthenticated' | 'http' | 'network' | 'invalid-response';

export class ApiClientError extends Error {
  public constructor(
    public readonly kind: ApiFailureKind,
    public readonly status: number | null,
    public readonly code: ErrorCode | null,
    message: string,
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export class ApiRequestTimeoutError extends ApiClientError {
  public constructor(timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    super(
      'network',
      null,
      null,
      `The API did not respond within ${Math.ceil(timeoutMs / MILLISECONDS_PER_SECOND)} seconds.`,
    );
    this.name = 'ApiRequestTimeoutError';
  }
}

export function serverUnavailable(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.kind === 'network' ||
      (error.kind === 'http' && (error.status ?? 0) >= HTTP_SERVER_ERROR))
  );
}

type UnauthorizedListener = () => void;
let unauthorizedListener: UnauthorizedListener | null = null;

export function setUnauthorizedListener(listener: UnauthorizedListener | null): void {
  unauthorizedListener = listener;
}

export interface ApiRequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  readonly notifyOnUnauthorized?: boolean;
  readonly maxResponseBytes?: number;
}

export async function apiRequest<T>(
  path: `/${string}`,
  schema: z.ZodType<T>,
  options: ApiRequestOptions = {},
): Promise<T> {
  return readApiResponse(await fetchApiResponse(path, options), schema, options);
}

export async function fetchApiResponse(
  path: `/${string}`,
  options: ApiRequestOptions = {},
  accept = 'application/json',
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(new URL(`/api/v1${path}`, API_ORIGIN), {
      method: options.method ?? 'GET',
      credentials: 'include',
      cache: 'no-store',
      ...(options.signal ? { signal: options.signal } : {}),
      headers: {
        accept,
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiClientError('network', null, null, 'The API could not be reached.');
  }
  return response;
}

export async function boundedResponseText(response: Response, maximum: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximum) throw new Error('Response bound exceeded.');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new ApiClientError(
      'invalid-response',
      response.status,
      null,
      'The API response could not be validated.',
    );
  } finally {
    reader.releaseLock();
  }
}

export async function readApiResponse<T>(
  response: Response,
  schema: z.ZodType<T>,
  options: ApiRequestOptions = {},
): Promise<T> {
  if (response.status === HTTP_UNAUTHORIZED) {
    if (options.notifyOnUnauthorized !== false) unauthorizedListener?.();
    throw new ApiClientError(
      'unauthenticated',
      response.status,
      ERROR_CODES.UNAUTHENTICATED,
      'Sign in to continue.',
    );
  }

  if (response.status === HTTP_NO_CONTENT) {
    const parsed = schema.safeParse(undefined);
    if (parsed.success) return parsed.data;
    throw new ApiClientError(
      'invalid-response',
      response.status,
      null,
      'The API returned an invalid response.',
    );
  }

  let body: string;
  try {
    body =
      options.maxResponseBytes === undefined
        ? await response.text()
        : await boundedResponseText(response, options.maxResponseBytes);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (error instanceof ApiClientError) throw error;
    throw new ApiClientError(
      response.ok ? 'network' : 'http',
      response.status,
      null,
      'The API response could not be read.',
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    if (!response.ok) {
      throw new ApiClientError('http', response.status, null, 'The API request failed.');
    }
    throw new ApiClientError(
      'invalid-response',
      response.status,
      null,
      'The API returned an invalid response.',
    );
  }

  if (!response.ok) {
    const parsed = apiErrorEnvelopeSchema.safeParse(payload);
    const code = parsed.success ? parsed.data.error.code : null;
    if (code === ERROR_CODES.UNAUTHENTICATED) {
      if (options.notifyOnUnauthorized !== false) unauthorizedListener?.();
      throw new ApiClientError(
        'unauthenticated',
        response.status,
        ERROR_CODES.UNAUTHENTICATED,
        'Sign in to continue.',
      );
    }
    throw new ApiClientError(
      'http',
      response.status,
      code,
      parsed.success ? parsed.data.error.message : 'The API request failed.',
      retryAfter(response.headers.get('retry-after')),
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiClientError(
      'invalid-response',
      response.status,
      null,
      'The API returned an invalid response.',
    );
  }
  return parsed.data;
}

function retryAfter(value: string | null): number | null {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : null;
}

export async function getCurrentUser(signal?: AbortSignal): Promise<CurrentUser | null> {
  try {
    const response = await apiRequest('/me', currentUserResponseSchema, {
      ...(signal ? { signal } : {}),
      notifyOnUnauthorized: false,
    });
    return response.data;
  } catch (error) {
    if (error instanceof ApiClientError && error.kind === 'unauthenticated') return null;
    throw error;
  }
}
