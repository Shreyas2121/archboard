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
const HTTP_SERVER_ERROR = 500;

export type ApiFailureKind = 'unauthenticated' | 'http' | 'network' | 'invalid-response';

export class ApiClientError extends Error {
  public constructor(
    public readonly kind: ApiFailureKind,
    public readonly status: number | null,
    public readonly code: ErrorCode | null,
    message: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
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

interface ApiRequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly signal?: AbortSignal;
  readonly notifyOnUnauthorized?: boolean;
}

export async function apiRequest<T>(
  path: `/${string}`,
  schema: z.ZodType<T>,
  options: ApiRequestOptions = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(new URL(`/api/v1${path}`, API_ORIGIN), {
      method: options.method ?? 'GET',
      credentials: 'include',
      ...(options.signal ? { signal: options.signal } : {}),
      headers: {
        accept: 'application/json',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiClientError('network', null, null, 'The API could not be reached.');
  }

  if (response.status === HTTP_UNAUTHORIZED) {
    if (options.notifyOnUnauthorized !== false) unauthorizedListener?.();
    throw new ApiClientError(
      'unauthenticated',
      response.status,
      ERROR_CODES.UNAUTHENTICATED,
      'Sign in to continue.',
    );
  }

  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    if (options.signal?.aborted) throw error;
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
