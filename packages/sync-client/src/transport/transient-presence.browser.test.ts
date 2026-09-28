import { MAX_PRESENCE_SELECTED_IDS, PRESENCE_EXPIRY_MS } from '@archboard/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransientPresence } from './transient-presence.js';

const BURST_SIZE = 100;
const SEND_WINDOW_MS = 70;
const TWO = 2;
afterEach(() => vi.useRealTimers());

describe('connection-local presence', () => {
  it('coalesces a burst, sends a count for large selections, and retains a trailing drag clear', async () => {
    vi.useFakeTimers();
    const send = vi.fn(() => true);
    const presence = new TransientPresence(send);
    presence.connect(crypto.randomUUID());
    const selectedIds = Array.from({ length: MAX_PRESENCE_SELECTED_IDS + 1 }, () =>
      crypto.randomUUID(),
    );
    for (let x = 0; x < BURST_SIZE; x += 1) {
      presence.publish({ cursor: { x, y: 0 }, selectedIds, dragPreview: null });
    }
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith({
      event: 'presence',
      data: {
        cursor: { x: 99, y: 0 },
        selectedIds: [],
        selectedCount: selectedIds.length,
        dragPreview: null,
      },
    });
    presence.publish({
      cursor: null,
      selectedIds: [],
      dragPreview: {
        positions: selectedIds.map((id) => ({ id, position: { x: 10, y: 10 } })),
      },
    });
    await vi.advanceTimersByTimeAsync(SEND_WINDOW_MS);
    expect(send.mock.calls).toHaveLength(TWO);
    presence.publish({ cursor: null, selectedIds: [], dragPreview: null });
    await vi.advanceTimersByTimeAsync(SEND_WINDOW_MS);
    expect(send).toHaveBeenLastCalledWith({
      event: 'presence',
      data: {
        cursor: null,
        selectedIds: [],
        selectedCount: 0,
        dragPreview: null,
      },
    });
    presence.clear();
  });

  it('expires peers without further messages and clears all pending state on reconnect', async () => {
    vi.useFakeTimers();
    const send = vi.fn(() => true);
    const presence = new TransientPresence(send);
    const ownId = crypto.randomUUID();
    presence.connect(ownId);
    const peer = {
      connectionId: crypto.randomUUID(),
      user: { id: 'peer', name: 'Peer', color: 'blue' as const },
      presence: { cursor: { x: 1, y: 2 }, selectedIds: [], dragPreview: null },
      expiresAt: new Date(Date.now() + PRESENCE_EXPIRY_MS).toISOString(),
    };
    presence.receive({ ...peer, connectionId: ownId });
    expect(presence.getSnapshot()).toEqual([]);
    presence.receive(peer);
    expect(presence.getSnapshot()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(PRESENCE_EXPIRY_MS);
    expect(presence.getSnapshot()).toEqual([]);
    presence.receive({
      ...peer,
      expiresAt: new Date(Date.now() + PRESENCE_EXPIRY_MS).toISOString(),
    });
    presence.publish(peer.presence);
    presence.connect(crypto.randomUUID());
    await vi.advanceTimersByTimeAsync(PRESENCE_EXPIRY_MS);
    expect(presence.getSnapshot()).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    presence.clear();
  });
});
