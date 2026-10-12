import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { currentUserQueryOptions } from '@/features/auth/current-user-query';
import { ApiClientError } from '@/platform/api/api-client';

const load = vi.hoisted(() => vi.fn());
vi.mock('@/features/auth/auth-transition-coordinator', () => ({ loadCurrentUser: load }));
vi.mock('@/platform/config', () => ({
  loadWebConfig: () => ({ apiOrigin: 'https://api.example.test' }),
}));

it('keeps a failed session check in error across observer remounts until explicitly retried', async () => {
  const client = new QueryClient();
  load.mockRejectedValue(new ApiClientError('network', null, null, 'API unavailable'));
  const first = new QueryObserver(client, currentUserQueryOptions);
  const unsubscribe = first.subscribe(() => undefined);
  await client.fetchQuery(currentUserQueryOptions).catch(() => undefined);
  expect(load).toHaveBeenCalledTimes(1);
  unsubscribe();
  first.destroy();
  const next = new QueryObserver(client, currentUserQueryOptions);
  const stop = next.subscribe(() => undefined);
  await new Promise((resolve) => setImmediate(resolve));
  expect(load).toHaveBeenCalledTimes(1);
  expect(next.getCurrentResult().isError).toBe(true);
  await next.refetch();
  const attempts = 2;
  expect(load).toHaveBeenCalledTimes(attempts);
  stop();
  next.destroy();
  client.clear();
});
