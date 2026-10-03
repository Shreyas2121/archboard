import { describe, expect, it } from '@jest/globals';
import {
  CONTENT_UPDATE_BURST,
  CONTENT_UPDATES_PER_SECOND,
  MAX_BOARD_CONNECTIONS,
  ERROR_CODES,
  HELLO_TIMEOUT_MS,
} from '@archboard/contracts';
import { MAX_TRAFFIC_SCOPES } from './collaboration-limits.js';
import { CollaborationTrafficBudget, TokenBudget } from './collaboration-traffic-budget.js';

const ONE_SECOND = 1_000;
describe('monotonic bounded collaboration traffic', () => {
  it('preserves exact burst, sustained refill and clock high water', () => {
    const bucket = new TokenBudget(CONTENT_UPDATES_PER_SECOND, CONTENT_UPDATE_BURST, ONE_SECOND);
    for (let index = 0; index < CONTENT_UPDATE_BURST; index++)
      expect(bucket.take(ONE_SECOND)).toBe(true);
    expect(bucket.take(ONE_SECOND)).toBe(false);
    expect(bucket.take(0)).toBe(false);
    expect(bucket.take(ONE_SECOND)).toBe(false);
    for (let index = 0; index < CONTENT_UPDATES_PER_SECOND; index++)
      expect(bucket.take(ONE_SECOND + ONE_SECOND)).toBe(true);
    expect(bucket.take(ONE_SECOND + ONE_SECOND)).toBe(false);
    expect(bucket.take(NaN)).toBe(false);
  });
  it('covers all legal sockets, survives reconnect identities and isolates lanes and other boards', () => {
    const budget = new CollaborationTrafficBudget(() => 0);
    for (let index = 0; index < MAX_BOARD_CONNECTIONS * CONTENT_UPDATE_BURST; index++)
      expect(budget.take('board-a', 'account-a', 'content')).toBeNull();
    expect(budget.take('board-a', 'account-a', 'content')).toBe(ERROR_CODES.RATE_LIMITED);
    expect(budget.take('board-a', 'new-session-same-account', 'content')).toBe(
      ERROR_CODES.RATE_LIMITED,
    );
    expect(budget.take('board-a', 'account-a', 'presence')).toBeNull();
    expect(budget.take('board-a', 'account-a', 'presenter')).toBeNull();
    expect(budget.take('board-b', 'account-a', 'content')).toBeNull();
    for (let index = 0; index < MAX_BOARD_CONNECTIONS; index++)
      expect(budget.take('board-c', 'account-c', 'join')).toBeNull();
    expect(budget.take('board-c', 'account-c', 'join')).toBe(ERROR_CODES.RATE_LIMITED);
  });
  it('bounds retained identities without evicting spent credit, then reclaims fully idle scopes', () => {
    let now = 0;
    const budget = new CollaborationTrafficBudget(() => now);
    for (let index = 0; index < MAX_TRAFFIC_SCOPES - 1; index++)
      expect(budget.take('board', `actor-${index}`, 'join')).not.toBe(ERROR_CODES.SERVER_BUSY);
    expect(budget.take('board', 'overflow', 'join')).toBe(ERROR_CODES.SERVER_BUSY);
    now = HELLO_TIMEOUT_MS;
    expect(budget.take('other-board', 'actor', 'join')).toBeNull();
  });
});
