# AI-C06 — Durable admission quotas and spending reservations

Date: 4 October 2026.
Branch: `ai-diagram-integration`.
Parent: `10a08bdb04a140453daeed7e793964b919747d57` (AI-C05).
Commit subject: `feat(api): enforce AI admission quotas and spending reservations`.

## Implemented behavior

Fresh creation atomically funds actor/global concurrency, provider RPM/input/output
allowances, UTC fresh-call minute/day scopes and money reservations, with the run
and receipt in the same transaction. Replays/deduplicated work never fund twice.
Separately committed actor create frequency counts failed funding and replays.
Polling has an independent minute limit; C08 will invoke that port on user polls.

The versioned server snapshot must exactly match the selected configured profile.
Reservation uses full input/output bounds for initial/repair/rejection-retry attempts,
maximum configured cache-write/read/uncached rates, separate reasoning when billable
and conservative per-category upward rounding. Integer bigint calculations reject
missing/zero required prices, unpriced usage, unsupported allowance and overflow.
No tokenizer approximation, live provider pricing or account quota was assumed.

Lifetime actor/global held-money totals carry active/unknown liability into later
UTC days/months. Actor day/month totals are tracked even when the optional actor
daily ceiling is absent. Known settlement charges origin and settlement periods
conservatively, with lifetime charges once. Unknown settlement releases execution
capacity and unused provider allowance while retaining full monetary holds.
Receipt/result expiry does not release money.

Dispatch commits a UUID fence and immutable first attempt claim. Every additional
attempt must claim its reserved capacity in the actual UTC minute before network
I/O; total claims are bounded by funded allowance and deadline. Claimed provider
capacity stays consumed even for unsuccessful/unsent work. Remaining holds survive
minute rollover and release only at terminal settlement. C07 still owns classified
retry/repair decisions and provider orchestration.

The new forward migration adds fixed-second scopes and `ai_provider_attempts`,
immutable ordinal/fence constraints, the complete funding allocation matrix,
balanced lifetime actor/deployment liabilities and mandatory claimed dispatch.
Existing applied sources remain unchanged. This financial migration refuses a
destructive down; later accounting changes require a reviewed forward migration.

The HTTP filter exposes fixed safe codes/messages for rate and budget denial and
disabled AI. Authoritative transient windows get positive integer `Retry-After`;
money exhaustion and concurrency/connection denial do not invent reset times.
A bounded per-actor SSE connection gate supports idempotent release for C08, with a
256-connection process ceiling under the existing single-writer deployment.
Its local Map is cheap connection admission; paid coordination stays PostgreSQL.

Optional operator overrides remain optional. The finite default RPM changes from
two to three to cover initial + one repair + one rejection retry reservation.
Default input/output ceilings remain 60,000/10,000 tokens/minute; money defaults and
the optional actor ceiling remain unchanged. Profiles still require operator prices.
See [admission/accounting design](../../ai-admission.md),
[persistence lock order](../../ai-persistence.md) and
[operator configuration](../../ai-operator-configuration.md).

## Verification

| Check                                                                             | Result                                                                         |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Focused API Jest (AI, config, startup diagnostics, HTTP exception filter)         | **PASS** — 267 tests, 13 suites                                                |
| New admission/pricing/fake-clock/contention units and HTTP classifications        | **PASS** — 26 admission cases plus 4 HTTP cases                                |
| API typecheck, including prepared integration source                              | **PASS**                                                                       |
| API production build                                                              | **PASS** — compilation and checked-in SQL copying; no database startup         |
| Root lint                                                                         | **PASS**                                                                       |
| Boundary scanner/negative fixtures                                                | **PASS** — 31 AI and 4 existing negative cases                                 |
| ORM versus forward SQL source alignment                                           | **PASS** — nine tables; no migration execution or configured datasource import |
| Changed-file format, local links, whitespace and new fixture/test build exclusion | **PASS**                                                                       |

Tests cover rounding/cache-write premiums, all-attempt caps, disabled/missing/zero
budgets, under-reservation/forged prices, actor/global money/concurrency races,
provider rate/token denial, failed-intent rollback, replay, cheap request limits,
restart/fresh quotas, per-attempt minute transfer, deadlines/fences, settlement once,
known/unknown/unsent/failed work, actor-private payload encryption rollback,
day/month rollover, polling/SSE admission and sanitized Retry-After.

These source and memory/QueryRunner checks do not prove PostgreSQL locking,
transaction or constraint behavior. Prepared acceptance extends
[`ai-persistence.integration-spec.ts`](../../../apps/api/src/modules/ai/infrastructure/persistence/ai-persistence.integration-spec.ts)
with two-instance budget/concurrency/RPM/input/output races, allocation-bypass
rejection and clock-driven unknown-liability rollover. The suite includes the C06
forward source and actual admission when executing the existing C05 cases later.
No database operation or integration test was executed.

## Deferred proof and next task

- PostgreSQL/Neon/database-backed HTTP/auth/session/socket/schema/migration/races:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
- Browser/Playwright/native browser/served-preview acceptance:
  **UNRUN (deferred by user)**.
- Live provider model/account/pricing/quota/compatibility/quality/latency/cost:
  **UNRUN (requires separately authorized operator budget and reviewed inputs)**.

Database, browser, live-provider and release gates remain **OPEN**. Follow the
[verification policy](../../verification-policy.md); the original Version 1
implementation trigger remains outstanding.

Next: [AI-C07](https://github.com/Shreyas2121/archboard/blob/37b663661045f8fe6cbed7db265141b84131718e/guide.md#ai-c07--run-orchestration-and-recovery),
`feat(api): coordinate bounded AI execution and recovery`.
Wire the existing funded creation/attempt/settlement ports into provider execution
outside locks, establish rendered-request token-counting bounds, enforce classified
retry/repair decisions, and implement lease/crash/shutdown recovery. C08 must gate
polls/connections and expose safe authenticated projections only after orchestration.
