# AI-C08 — Exact result cache and private retention

Branch: `ai-diagram-integration`.
Parent: `e4161e74f24a4a8d8f51952f3082206458265a3f`.
Commit subject: `feat(api): cache private validated AI results`.
Scope: server-constructed exact identities, actor-private validated semantic result
reuse, fixed encrypted retention, bounded aggregate capacity and prepared database
race/fault fixtures. No AI route is enabled by this task.

## Changes and contracts

- `AiRunApplication` is the server-owned creation entry point for C09. It resolves
  the operator provider/model, prepares the prompt/snapshot/reservation, and
  validates results against the reviewed request's evidence, references and field
  preconditions before settlement/indexing. A failed validation uses C07's one
  bounded repair; still-invalid output is never cached. The provider port and SDK
  boundaries remain unchanged.
- HMAC identities canonically include actor/deployment/target/access-policy scope,
  exact normalized prompt/context/history, graph/local changes/preconditions,
  provider/model, prompt/schema/adapter versions, generation settings, immutable
  snapshot and nonsecret operator configuration. Object-key order canonicalizes;
  text/array order, case, whitespace and constraints remain exact. Hash domains
  separate receipt identity from result identity. Configuration changes invalidate
  result reuse without resubmitting an existing receipt under a new configuration.
  The dedicated secret is private, independent of encryption, and never logged.
- Cache lookup follows current board authority and request-frequency admission
  inside the existing namespace/fingerprint coordination. Cache misses, active
  dedupe and settlement share that coordination. A hit aliases the original
  completed run/payload with a new receipt, preserving fixed expiry, accounting and
  one encrypted copy. It consumes no new fresh-call/token/money/concurrency capacity.
  The application reads again under current authority before returning content.
- The forward `ai_result_cache` table/ORM/runtime migration registrations add
  owner-linked origin/payload bindings and a deferred successful-known-result
  constraint. Payload deletion cascades the index; durable run locators/receipts
  and spending metadata remain untouched. No applied migration was edited or run.
- Actor/global entry and byte ceilings cover **all unique private payloads**,
  including results without a cache entry. Exact COUNT/SUM queries run under the
  namespace coordinator; bounded victim queries return metadata only. Settlement
  evicts at most 64 earliest-expiring payloads per transaction before insertion.
  Nonce/tag overhead counts toward capacity. Capacity reductions can require
  multiple bounded cleanup passes; oversized/new content is not inserted above a
  cap. No L1 cache, plaintext copy, generated graph UUID, viewport or application
  receipt enters the cache.
- Nested content savepoints isolate optional storage/index failure from known
  settlement. Index failure preserves retained content. Payload failure/insufficient
  capacity leaves completed accounting and honest expired content rather than
  triggering another provider call. Outer commit failures remain subject to C07's
  conservative recovery fencing.
- Cache hits never renew TTL. Every content lookup checks fixed expiry and decrypts
  only authorized owner-bound payloads. Missing/tampered/unavailable-key content is
  a safe miss for a new explicit request or expiry for an old read; GET cannot
  generate. Cache eligibility excludes errors, refusals, invalid/partial/failed,
  cancelled and unknown results. The operator TTL validation now matches the
  existing snapshot's 15-minute hard ceiling.
- Rotation behavior and C09/C11/C17 responsibilities are recorded in
  [the cache contract](../../ai-cache.md). A hit returns semantic content only;
  C11 must create new graph IDs and a distinct Apply intent rather than treating
  the origin run/creation receipt as an already-applied graph batch.

## Checks

- `pnpm.cmd --filter @archboard/api exec node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.config.cjs --runInBand --testPathPatterns modules/ai --silent`:
  PASS, 13 suites / 212 tests. Includes canonical order versus exact text/history,
  actor/board/deployment/config/secret changes, local context/preconditions,
  current authority, request-frequency charging for hits, no call on hit/replay/GET,
  simultaneous dedupe/hits, fixed expiry, global/actor entry/byte caps, ciphertext
  overhead, noncacheable payload capacity, optional write rollback, key rotation,
  semantic-only reuse and rejection of nonexistent evidence through repair.
- `pnpm.cmd --filter @archboard/api exec node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.config.cjs --runInBand --testPathPatterns platform/config/ai-config --silent`:
  PASS, 58 tests including rejection of a TTL above the persisted ceiling.
- `pnpm.cmd --filter @archboard/api exec node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.config.cjs --runInBand --testPathPatterns platform/database/database-options --silent`:
  PASS, 3 configuration-only tests; no pool connection or database read.
- `pnpm.cmd --filter @archboard/api typecheck`: PASS.
- `pnpm.cmd --filter @archboard/api build`: PASS.
- `pnpm.cmd lint`: PASS.
- `pnpm.cmd boundary:check`: PASS; 31 negative AI isolation fixtures rejected.
- Changed-file Prettier, local documentation links and `git diff --check`: PASS.

The API package pretest builds contracts, fixtures, document model and API without
database I/O; the final direct Jest runner reuses those builds. Early fixture
issues (cross-case active-intent interference, guessed context fields and readonly
configuration mutation) were corrected before the final checks. QueryRunner
savepoint probes and checked-in schema/entity source agreement are fixture/static
proof only; no database connection, migration inspection or configured operation
was used.

## Deferred acceptance

- PostgreSQL cache/index/byte-accounting/settlement/cleanup races, FK/constraint
  enforcement, migration application/round-trip and actual savepoint rollback:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
  Extended `ai-persistence.integration-spec.ts` with the new isolated-schema
  migration plus concurrent exact-hit reuse, concurrent capacity eviction and an
  actual FK index-write failure. Final verification must also run physical expiry
  cleanup versus cache lookup, restart/outer-commit faults and real permission
  revocation. Use an explicitly selected direct test database only after the
  Version 1 implementation trigger.
- Browser/Playwright/native browser/served-preview and real authenticated SSE:
  **UNRUN (deferred by user)**.
- Live model/cache-hit/cost/latency/quality evaluation:
  **UNRUN (requires separately authorized operator budget and reviewed inputs)**.

Database/browser/live-provider, original M00–M08 completion and production release
acceptance gates remain **OPEN**. Fixture passes do not close them.

## Handoff

Next: AI-C09 authenticated REST/SSE/body limits/availability on this introducing
commit. Use `AiRunApplication` for server-owned creation; map internal results to
strict public contracts, apply `no-store`, bound inexpensive endpoint admission
and polling, preserve existing auth/body-cap/HTTP boundaries, and reauthorize
every result/stream delivery. No read/reconnect may dispatch work. Background
cleanup/key procedures remain C17; Apply/layout remain C11/C12. Map the actual
AI-C08 introducing hash in the next index update; do not amend historical evidence.
