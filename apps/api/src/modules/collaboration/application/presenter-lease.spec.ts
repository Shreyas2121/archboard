import { PresenterLease } from './presenter-lease.js';
import { PRESENTER_LEASE_TIMEOUT_MS, WS_PING_INTERVAL_MS } from '@archboard/contracts';

const COMPETING_REQUEST_AT = 100;
const BEFORE_DEADLINE = PRESENTER_LEASE_TIMEOUT_MS - 1;
const RENEWED_DEADLINE = BEFORE_DEADLINE + PRESENTER_LEASE_TIMEOUT_MS;

describe('connection-bound transient presenter lease', () => {
  it('rejects nonholders and deleted/pending-only steps without mutating state', () => {
    const lease = new PresenterLease();
    expect(lease.acquire('a', 0)).toBe(true);
    expect(lease.select('a', 'committed', true)).toBe(true);
    const before = lease.snapshot();
    expect(lease.acquire('b', COMPETING_REQUEST_AT)).toBe(false);
    expect(lease.select('b', 'committed', true)).toBe(false);
    expect(lease.select('a', 'pending', false)).toBe(false);
    expect(lease.release('b')).toBe(false);
    expect(lease.snapshot()).toEqual(before);
    lease.reconcile([]);
    expect(lease.snapshot()).toEqual({ ...before, stepId: null });
  });
  it('requires holder heartbeat before the deadline and starts empty after restart', () => {
    const lease = new PresenterLease();
    lease.acquire('a', 0);
    expect(lease.heartbeat('b', WS_PING_INTERVAL_MS)).toBe(false);
    expect(lease.heartbeat('a', BEFORE_DEADLINE)).toBe(true);
    expect(lease.expire(RENEWED_DEADLINE - 1)).toBe(false);
    expect(lease.heartbeat('a', RENEWED_DEADLINE)).toBe(false);
    expect(lease.expire(RENEWED_DEADLINE)).toBe(true);
    expect(new PresenterLease().snapshot()).toEqual(lease.snapshot());
  });
});
