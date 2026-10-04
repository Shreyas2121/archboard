# AI-C07 — Run orchestration and recovery

Branch: `ai-diagram-integration`.
Parent: `f21dccbd9ee845d81c7e3e0611719d7a3763aba2`.
Commit subject: `feat(api): coordinate bounded AI execution and recovery`.
Scope: neutral provider execution after durable admission, bounded retry/repair,
cancel/drain, fenced recovery and authorized pull subscriptions. No public AI route
is enabled by this commit.

## Changes and contracts

- `AiRunCoordinator` executes only newly created, funded intent. Replay and
  different-key active deduplication return the durable run. Provider/model/task,
  output limits and deadline come from the admitted snapshot; the cloned request
  cannot be modified by a caller after start. Registry/adapter selection remains
  server-owned. Existing OpenAI SDK request/client `maxRetries: 0` is preserved.
- Dispatch and every retry/repair claim commit before provider I/O. Every attempt
  checks its lease: an expired lease cannot claim again even before
  the overall deadline expires. There is one
  classified rejection retry with bounded Retry-After/backoff and one repair of
  invalid completed JSON, both under the original reservation/deadline. Repair
  retains original reviewed context, adds a fixed instruction and never resends
  malformed model output. Zod and task-kind validation precede encrypted storage.
- Serialized input (including history and schema) uses a conservative UTF-8 byte
  ceiling against the configured input-token allowance. This may reject requests
  that a tokenizer could fit; it avoids optimistic token admission. Output bytes
  and event count are bounded; deltas are counted and discarded, not retained.
  One bounded terminal result per worker is validated and persisted. No raw stream
  reaches subscribers, logs, graph state or public contracts.
- All completed/failed repair usage is combined in disjoint billing categories.
  Refusal/incomplete output settles known usage. Ambiguous transport, missing
  terminal output, unknown usage, interrupted cancellation and expired deadlines
  retain maximum financial liability; none initiates another paid attempt.
- Trusted recovery inspects expired dispatch leases or expired unsent intent,
  settles once through the existing dispatch fence, and never dispatches.
  Expired active status reads recover before returning a fresh authorized snapshot.
  A worker/persistence outage leaves durable intent available for recovery instead
  of reporting committed success. Recovery discovery/periodic sweeping belongs
  to C17; this commit exposes per-run recovery without a background paid queue.
- Shutdown aborts workers and drains for a bounded interval. Trusted AI settlement
  may start an already-admitted transaction during graceful shutdown; ownership
  loss and incompatible schema still fence both transaction start and commit.
  Ordinary transactions continue refusing new admission. Provider promises that
  ignore abort cannot hold up the coordinator; late output cannot settle again.
- `AiRunSubscriptions` uses the C06 connection gate, one authorized snapshot read
  at a time, zero queued private content, a fixed idle expiry and shutdown cleanup.
  Closing a subscription never cancels its run. Each delivery rechecks authority;
  revoked access closes that subscription. Slow/overlapping consumers must resume
  through an authorized status read. C09 supplies HTTP SSE heartbeat/event IDs.
- Enabled durable Nest composition includes coordinator/subscriptions; disabled
  configuration still creates neither. Exact result caching remains C08.

## Checks

- `pnpm.cmd --filter @archboard/api exec node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.config.cjs --runInBand --testPathPatterns modules/ai --silent`:
  PASS, 10 suites / 180 tests. Fixture/in-memory proof includes call counts,
  commit-before-call, retry, repair accounting, dedupe/reconnect, cancellation,
  dead-worker recovery, output bounds, revocation and settlement failure.
  Earlier `pnpm.cmd --filter @archboard/api test --runInBand --testPathPatterns modules/ai`
  pretest built contracts, fixtures, document model and API without database I/O;
  the final direct runner reused those builds after test instrumentation changes.
- `pnpm.cmd --filter @archboard/api test --runInBand --testPathPatterns platform/lifecycle/runtime-admission`:
  PASS, 3 tests, including trusted graceful settlement and ownership-loss fencing.
- `pnpm.cmd --filter @archboard/api exec node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.config.cjs --runInBand --testPathPatterns platform/database/postgres-transaction`:
  PASS, 5 database-free QueryRunner fixture tests.
- `pnpm.cmd --filter @archboard/api typecheck`: PASS.
- `pnpm.cmd --filter @archboard/api build`: PASS.
- `pnpm.cmd lint`: PASS.
- `pnpm.cmd boundary:check`: PASS, including 31 negative AI boundary fixtures.
- Changed-file Prettier and `git diff --check`: PASS.

These results do not establish PostgreSQL locking/durability, real provider
accounting, browser behavior or production acceptance. An initial shell command
with pipe alternatives in its test-path argument was rejected before Jest;
separate focused commands above supplied the actual proof. Initial lint findings
were corrected and lint rerun. The transaction fixture initially confused an
unrelated concurrent transaction with the provider's own execution context;
AsyncLocalStorage corrected that assertion before the final 180-test PASS.

## Deferred acceptance

- PostgreSQL/process-crash/lease/late-settlement races and database-backed authority,
  shutdown and durable once-only accounting:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
  Added a prepared concurrent expired-lease recovery/late-completion case to
  `ai-persistence.integration-spec.ts`. Run that existing isolated-schema suite
  against an explicitly selected direct test database only after the trigger.
  Final process-fault acceptance must kill a worker after dispatch commit, recover
  without a provider call, interrupt settlement after completion and verify replay,
  and exercise graceful drain versus writer ownership loss.
- Browser/Playwright/native browser/served-preview/OAuth and real SSE reconnect:
  **UNRUN (deferred by user)**.
- Live provider compatibility, cost, cancellation/usage behavior and evaluation:
  **UNRUN (requires separately authorized operator budget and reviewed inputs)**.

All corresponding acceptance and release gates remain **OPEN**. Original M00–M08
implementation completion is not established by this task.

## Handoff

Next: AI-C08 exact private result caching and retention, on top of this introducing
commit plus the actual C05/C06 commits. Keep provider I/O outside transactions,
authorize cache returns, preserve unknown liabilities and never regenerate on
GET, receipt replay, lost worker lease or subscription reconnect. C09 may expose
routes only after C08 integration; no routes were enabled here. Map the actual
AI-C07 introducing hash in the next index update; do not amend historical evidence.
