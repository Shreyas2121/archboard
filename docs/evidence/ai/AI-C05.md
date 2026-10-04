# AI-C05 — Durable runs, receipts, and accounting intent

Date: 4 October 2026.
Branch: `ai-diagram-integration`.
Parent: `fa2e967e8c6b25508f5f3fbd1f4ac712e043141c` (AI-C04).
Commit subject: `feat(api): persist AI run and accounting intent`.
Scope: neutral persistence ports/service, PostgreSQL repositories/entities, forward
migration source, bounded encrypted payload adapter, source/fixture proof and
prepared integration acceptance.

## Implemented behavior

Eight feature-owned tables represent runs, actor-private idempotency receipts,
reservation and once-only settlement intent, encrypted private result payloads,
durable capacity scopes, UTC budget periods and origin-period allocations.
Provider/model/configuration/pricing/token-counting/product versions and prices are
captured in an immutable nonsecret run snapshot. No prompt, context or plaintext
result is persisted in accounting. Each payload has a strict byte limit and TTL;
aggregate exact result-cache capacity belongs to C16.

The application service creates pending run/reservation/receipt atomically,
coordinates replay and active fingerprint aliases, retains expired keys as
tombstones and blocks unfunded dispatch. Current authority precedes AI locks and
receipt/run/result disclosure. Trusted worker settlement returns no private data
and can retain accounting after board access is revoked. Fenced terminal effects
are once-only; unknown financial outcomes retain maximum liability. Known late or
stale effects cannot replace terminal accounting or results.

The PostgreSQL adapter uses the shared transaction lifecycle and only its scoped
manager. PostgreSQL clock and transaction advisory locks cover absent rows.
Migration sources define active uniqueness, ownership foreign keys, immutable
accounting/configuration, coherent deferred run/reservation/settlement constraints,
positive reservation amounts and UTC period identities. Existing migration history
and disabled synchronization remain unchanged. Runtime and migration registration
include the new forward source; no configured datasource was imported for checking.

Enabled application composition binds the durable adapter/cipher/service with the
shared datasource, authority port and runtime admission. Provider-only composition
remains available for existing isolated tests; disabled AI binds no durable
providers. Construction performs no database or provider I/O.

AES-256-GCM authenticates actor/namespace/run/payload/schema/key/expiry bindings.
Random nonces, strict byte accounting, fixed safe errors and private key fields
protect result storage. Bounded cleanup removes expired ciphertext while retaining
safe receipts, reservations and settlements. See the
[persistence contract and lock order](../../ai-persistence.md).

This is infrastructure foundation. C06 still implements actual admission and
atomic capacity/budget arithmetic; C07 implements execution/recovery, C08 routes and
public projection, and C16 exact cache identity/capacity. No inference, deployment
or configured database mutation occurred.

## Verification

| Check                                                        | Result                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Focused API Jest (AI, config, startup diagnostics)           | **PASS** — 229 tests, 11 suites                                        |
| New persistence/service/cipher/repository/composition units  | **PASS** — 38 database-free cases                                      |
| API typecheck (including prepared integration source)        | **PASS**                                                               |
| API production build                                         | **PASS** — compiles and copies checked-in SQL assets only              |
| Root lint                                                    | **PASS**                                                               |
| Boundary scanner with negative fixtures                      | **PASS** — 31 AI and 4 existing negatives; 6 allowed AI fixtures       |
| ORM column/table types versus checked-in migration source    | **PASS** — eight tables; no migration execution or database inspection |
| Changed-file format, documentation links and diff whitespace | **PASS**                                                               |
| New unit/integration/test-helper production exclusion        | **PASS** — new test outputs and fixture helpers absent                 |

Units cover atomic rollback, concurrent replay/deduplication, actor/namespace
isolation, changed/expired keys, current denial/archive authority, no private
worker disclosure, funded-dispatch prerequisite, stale/elapsed fences, once-only
settlement, retained unknown liability, zero-charge unsent work, encrypted result
round-trip/tampering/ownership/expiry/caps, safe driver failure and DI construction.
The memory adapter preserves Date/byte prototypes inside Jest's VM so encrypted
records round-trip through strict schemas. Source alignment checks do not execute
a migration or inspect a database.

## Deferred proof and handoff

The prepared PostgreSQL suite is
[`ai-persistence.integration-spec.ts`](../../../apps/api/src/modules/ai/infrastructure/persistence/ai-persistence.integration-spec.ts).
It requires an explicitly selected direct test database, creates isolated schemas,
runs checked-in migrations and cleans only those generated schemas. Its cases
cover cross-instance races, real lock blocking, rollback, uniqueness, funded
dispatch constraints, immutable snapshots/receipts/settlement, encrypted payload
retention/isolation, current archived/downgraded/removed board access, unknown
liability, period constraints and isolated forward/down/forward migration behavior.
**No integration case was executed.**

- PostgreSQL/Neon/database-backed HTTP/auth/session/socket/schema/migration checks:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
- Browser/Playwright/native browser/served-preview acceptance:
  **UNRUN (deferred by user)**.
- Live OpenAI model/account/schema compatibility, quality, latency and cost:
  **UNRUN (requires separately authorized operator budget and reviewed inputs)**.

All corresponding acceptance gates remain **OPEN**. The existing Phase 8 closure
does not resume the original Version 1 implementation trigger. Follow the
[verification policy](../../verification-policy.md); do not invoke aggregate
commands with deferred children.

Next: [AI-C06](../../../guide.md#ai-c06--durable-rate-token-concurrency-and-spending-gates),
`feat(api): enforce AI admission quotas and spending reservations`. Apply the
current optional budget/provider overrides and finite defaults. Add atomic
funding/settlement over origin-period allocations under the recorded lock order,
using this actual introducing commit after it lands; preserve unknown liability
and the no-network-under-lock boundary.
