import { afterEach, expect, it, vi } from 'vitest';
import { submitBoardAction } from '@/features/boards/board-api';

vi.mock('@/platform/config', () => ({
  loadWebConfig: () => ({
    apiOrigin: 'https://api.example.test',
    webSocketOrigin: 'wss://api.example.test',
  }),
}));
afterEach(() => vi.unstubAllGlobals());

it('accepts the governing strict creation summary without requiring detail-only memberCount', async () => {
  const timestamp = '2026-10-02T00:00:00.000Z';
  const board = {
    id: crypto.randomUUID(),
    title: 'Architecture',
    description: '',
    owner: { id: 'owner', name: 'Owner', image: null },
    effectiveRole: 'owner',
    archivedAt: null,
    metadataVersion: 1,
    latestSeq: '0',
    contentUpdatedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const created = 201;
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(JSON.stringify({ data: board }), {
        status: created,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetch);
  expect(await submitBoardAction('create', null, 'Architecture', '', crypto.randomUUID())).toEqual(
    board,
  );
  expect(String(fetch.mock.calls[0]?.[0])).toBe('https://api.example.test/api/v1/boards');
});
