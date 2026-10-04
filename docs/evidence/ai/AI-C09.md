# AI-C09 — REST, body limits, SSE, and availability

Branch: `ai-diagram-integration`.
Parent: `5e494b60a9dab7f06e53014975a3ac636bb9e215`.
Commit subject: `feat(api): expose authenticated AI run and event endpoints`.
Scope: the five authenticated run/availability routes, strict transport validation,
route-specific body allowance, durable polling/allowance, bounded authorized SSE,
safe DTO/error mapping, OpenAPI and prepared PostgreSQL/session fixtures.

## Implementation

- `AiController` requires the trusted session actor, validates shared request,
  path, query and selected header contracts, calls the application facade and
  serializes strict envelopes. `AppModule` supplies the existing auth registration
  to `AiModule`. Disabled mode registers the routes and safe unavailable responses
  without AI persistence, content keys or provider dispatch. Database-free Nest
  composition covers enabled and disabled registration.
- Creation uses C08's server-owned identity/configuration entry point and C06/C07's
  committed admission/coordinator. Existing receipts, active dedupe and exact
  cache hits retain their original run/accounting/expiry. Public DTOs exclude
  provider/accounting/identity/fence internals. Status and cancellation reauthorize
  owned runs; cross-user and forged IDs remain undisclosed. Current viewer,
  archived-board and revoked-member errors apply to stored results and events.
- Only canonical AI creation selects a separate 8 MiB JSON parser, preserving the
  ordinary 65,536-byte and import parser ceilings and Better Auth ordering. Raw
  bytes, UTF-8, depth/prototype safety and strict shared-schema validation remain
  bounded. A request above the import parser ceiling but within AI's allowance
  reaches semantic validation rather than a size rejection. Reviewed context
  files still have the separate 1 MiB limit; model input preflight still applies.
- All product responses use existing protected `no-store` headers, including
  parser, authentication, permission, quota and SSE errors. Configured API/web
  origins and Fetch Metadata reject foreign browser requests, including alternate
  route casing. Strict empty queries reject token-bearing URLs; forwarded headers
  establish no trust or actor identity.
- Status, availability, cancellation and every stream read consume durable actor
  poll frequency. Stream concurrency uses C07's bounded local connection gate.
  Advisory availability reads both fresh minute/day limits and outstanding
  actor/global daily/monthly/lifetime money liability under coordinator locks.
  Unknown reservations survive rollover; reset times remain null. Creation still
  performs its independent atomic admission. Authoritative positive quota delays
  set `Retry-After`; unknown holds receive no invented reset. Input-too-large maps
  to 413 and expired receipt/content errors to 410; ordinary expired completed
  content is an honest 200 snapshot and never generates.
- SSE carries shared-contract status/result/expiry/failure/cancellation notices,
  never provider streams, prompt text or proposal content. Decimal IDs mark run
  update timestamps; bounded `Last-Event-ID` input always resumes with a fresh
  authorized snapshot and no replay queue or new generation. Sessions and board
  authority are rechecked before every snapshot/heartbeat. Terminal events close;
  post-header errors close without replay. Five-second delivery, a 120-second
  connection deadline, 64-frame/64 KiB total ceilings, one bounded write under
  backpressure and close/error/shutdown cleanup bound transport resources.
  Closing a subscription never cancels generation.
- [The HTTP contract](../../ai-http.md), OpenAPI and the shared-contract README
  document status codes, cancellation's possible unknown outcome, expiry,
  heartbeat/resumption, terminal events, origin policy and resource bounds.

## Checks

| Check                                                                                                                                                                                                                                        | Result                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Database-free AI and HTTP Node/Jest suites: `pnpm --filter @archboard/api exec node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.config.cjs --runInBand --testPathPatterns modules/ai platform/http --silent` | PASS — 282 tests, 22 suites                                                                              |
| Final changed controller/SSE Node fixtures                                                                                                                                                                                                   | PASS — 20 tests, 2 suites; includes separate parser selection, foreign origins, deadlines and revocation |
| Shared contracts: `pnpm --filter @archboard/contracts test -- src/ai/contracts.test.ts`                                                                                                                                                      | PASS — package runner executed all 211 tests, 10 suites; no browser/database                             |
| Contracts/dependent package and API builds via API pretest; final API build                                                                                                                                                                  | PASS                                                                                                     |
| `pnpm --filter @archboard/api typecheck`                                                                                                                                                                                                     | PASS — includes prepared integration source, not its execution                                           |
| `pnpm lint`                                                                                                                                                                                                                                  | PASS                                                                                                     |
| Dependency boundary scan with negative fixtures                                                                                                                                                                                              | PASS — 31 AI and 4 Phase 2 forbidden cases rejected                                                      |

`pnpm format:check` and `git diff --check`: PASS.
Staged whitespace checks are recorded with the final commit handoff.
During implementation, fixture typing and lint findings were corrected and their
checks rerun. No failing result was substituted for deferred acceptance.

## Deferred acceptance and next task

- PostgreSQL/Neon/schema/migration/database-backed HTTP/auth/session/socket checks:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
  `ai-persistence.integration-spec.ts` now prepares real HttpOnly session creation,
  AI creation/replay/status/terminal stream, same-namespace cross-user protection,
  viewer/archive/revocation checks, active-stream membership revocation, and real
  sign-out rejection. Only an independent fixture provider is used; it never
  contacts a paid endpoint. Run this suite against an explicitly reviewed isolated
  test database during final verification, along with its existing persistence,
  cache, admission and migration cases. No database command was run for C09.
- Browser/Playwright/native browser/served-preview/OAuth-browser/SSE checks:
  **UNRUN (deferred by user)**. Same-origin cookie/CORS/proxy behavior and browser
  reconnect acceptance remain OPEN.
- Live compatibility, quality, latency and cost evaluation:
  **UNRUN (requires separately authorized operator budget and reviewed inputs)**.

AI-C09 implementation is delivered. Database/browser/live-provider and original
Version 1 release gates remain **OPEN**. No push, merge, deployment or migration
was performed.

Next: [AI-C10 — prompt/form/JSON review UI](../../../guide.md#ai-c10--prompt-form-json-review-and-typed-transport),
depending on this task's actual introducing commit. Build explicit reviewed Generate
intent and a typed API/SSE client using [the HTTP contract](../../ai-http.md).
Treat snapshot IDs as resumption markers rather than gap-free replay offsets;
fetch authorized results after notices and render expired/unknown/disabled states
truthfully. Keep private drafts/context scoped to the current actor/board, and
preserve both verification deferrals. AI-C11 remains responsible for proposal
mapping/fresh graph IDs and distinct Apply identity; C09 does not mutate graphs.
