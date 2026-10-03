import {
  CONTENT_UPDATES_PER_SECOND,
  CONTENT_UPDATE_BURST,
  PRESENCE_UPDATES_PER_SECOND,
  MAX_BOARD_CONNECTIONS,
  HELLO_TIMEOUT_MS,
  type ErrorCode,
  ERROR_CODES,
} from '@archboard/contracts';
import { MAX_TRAFFIC_SCOPES } from './collaboration-limits.js';

const MILLISECONDS_PER_SECOND = 1_000;
type Lane = 'content' | 'presence' | 'presenter' | 'join';

/** Server monotonic time; clock rollback cannot create or revoke earned credit. */
export class TokenBudget {
  private tokens: number;
  private refilledAt: number;
  public constructor(
    private readonly rate: number,
    private readonly burst: number,
    now: number,
  ) {
    this.tokens = burst;
    this.refilledAt = now;
  }
  public take(now: number): boolean {
    if (!Number.isFinite(now)) return false;
    const at = Math.max(this.refilledAt, now);
    this.tokens = Math.min(
      this.burst,
      this.tokens + ((at - this.refilledAt) * this.rate) / MILLISECONDS_PER_SECOND,
    );
    this.refilledAt = at;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

interface Scope {
  readonly lanes: Record<Lane, TokenBudget>;
  touchedAt: number;
}

/** Account+board and board ceilings survive reconnects without retaining session tokens.
 * Aggregate content/transient ceilings cover all ten legal sockets at their declared
 * budgets. Joining has a separate 10/s burst-10 abuse budget per account+board/board.
 */
export class CollaborationTrafficBudget {
  private readonly scopes = new Map<string, Scope>();
  public constructor(private readonly now = () => performance.now()) {}

  public take(boardId: string, userId: string, lane: Lane): ErrorCode | null {
    const now = this.now();
    if (!Number.isFinite(now)) return ERROR_CODES.SERVER_BUSY;
    const keys = [`board:${boardId}`, `actor:${boardId}:${userId}`];
    // Idle buckets have fully refilled before eviction; never evict spent credit.
    for (const [key, scope] of this.scopes)
      if (now - scope.touchedAt >= HELLO_TIMEOUT_MS) this.scopes.delete(key);
    const needed = keys.filter((key) => !this.scopes.has(key)).length;
    if (this.scopes.size + needed > MAX_TRAFFIC_SCOPES) return ERROR_CODES.SERVER_BUSY;
    let allowed = true;
    for (const key of keys) {
      let scope = this.scopes.get(key);
      if (scope === undefined) {
        const transient = MAX_BOARD_CONNECTIONS * PRESENCE_UPDATES_PER_SECOND;
        scope = {
          touchedAt: now,
          lanes: {
            content: new TokenBudget(
              MAX_BOARD_CONNECTIONS * CONTENT_UPDATES_PER_SECOND,
              MAX_BOARD_CONNECTIONS * CONTENT_UPDATE_BURST,
              now,
            ),
            presence: new TokenBudget(transient, transient, now),
            presenter: new TokenBudget(transient, transient, now),
            join: new TokenBudget(MAX_BOARD_CONNECTIONS, MAX_BOARD_CONNECTIONS, now),
          },
        };
        this.scopes.set(key, scope);
      }
      scope.touchedAt = Math.max(scope.touchedAt, now);
      // Charge both scopes even on a rejection; no partial admission creates work.
      if (!scope.lanes[lane].take(now)) allowed = false;
    }
    return allowed ? null : ERROR_CODES.RATE_LIMITED;
  }
}
