import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { apiRequest, serverUnavailable, setUnauthorizedListener } from '@/platform/api/api-client';

vi.mock('@/platform/config', () => ({
  loadWebConfig: () => ({ apiOrigin: 'https://api.example.test' }),
}));
const schema = z.object({ data: z.string() });
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_BAD_GATEWAY = 502;
const HTTP_UNAVAILABLE = 503;

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedListener(null);
});

describe('API failure classification', () => {
  it.each([
    { body: '<html>proxy unavailable</html>', status: HTTP_UNAVAILABLE },
    { body: '', status: HTTP_BAD_GATEWAY },
  ])('preserves HTTP $status for a non-JSON body', async ({ body, status }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status })),
    );
    const error = await apiRequest('/boards', schema).catch((error: unknown) => error);
    expect(error).toMatchObject({ kind: 'http', status });
    expect(serverUnavailable(error)).toBe(true);
  });

  it('keeps malformed successful JSON distinct from an outage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{', { status: HTTP_OK })),
    );
    const error = await apiRequest('/boards', schema).catch((error: unknown) => error);
    expect(error).toMatchObject({ kind: 'invalid-response', status: HTTP_OK });
    expect(serverUnavailable(error)).toBe(false);
  });

  it('handles 401 before reading its body', async () => {
    const notify = vi.fn();
    setUnauthorizedListener(notify);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('sign in', { status: HTTP_UNAUTHORIZED })),
    );
    await expect(apiRequest('/boards', schema)).rejects.toMatchObject({
      kind: 'unauthenticated',
      status: HTTP_UNAUTHORIZED,
    });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('classifies a dropped successful response body as a transport failure', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.error(new TypeError('connection lost'));
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream, { status: HTTP_OK })),
    );
    const error = await apiRequest('/boards', schema).catch((error: unknown) => error);
    expect(error).toMatchObject({ kind: 'network', status: HTTP_OK });
    expect(serverUnavailable(error)).toBe(true);
  });

  it('preserves abort identity while reading a response body', async () => {
    const controller = new AbortController();
    const aborted = new DOMException('Aborted', 'AbortError');
    const stream = new ReadableStream({
      start(body) {
        controller.abort();
        body.error(aborted);
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream)),
    );
    await expect(apiRequest('/boards', schema, { signal: controller.signal })).rejects.toBe(
      aborted,
    );
  });
});
