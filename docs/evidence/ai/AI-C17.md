# AI-C17 — Cleanup, metrics, kill switch, and shutdown

Branch: `ai-diagram-integration`.
Parent: `ad05052b4f4b90f7251e9311b0271f652663d49a`.
Commit subject: `feat(api): add AI retention cleanup and safe operational metrics`.
Scope: scheduled bounded encrypted-content cleanup, fenced restart recovery,
fixed-cardinality diagnostics, operator spending switch, per-configuration circuit
breakers, bounded cancellation/shutdown and key-rotation runbook.

## Changes and contracts

- Maintenance waits for writer/runtime admission, never overlaps passes, and
  schedules 30 seconds after each pass. It deletes at most 64 expired payloads,
  reports exact retained entries/bytes and remaining expired-payload backlog,
  and recovers at most 64 expired active runs in separate transactions. Cleanup
  takes the existing namespace coordinator; recovery retains established lock
  order. Receipt tombstones, settlements, reservations and unknown liabilities
  survive content expiry. Recovery cannot redispatch.
- A new forward partial index supports active-deadline discovery without
  scanning terminal run history. Runtime and migration registries plus ORM
  metadata agree by source review. No migration was executed or inspected.
- `AiOperations` reports only fixed aggregate counters/gauges through a safe
  JSON sink and trusted snapshot method. No private content/identities, URLs,
  paths, raw errors, native SDK fields or fingerprint labels enter metrics.
  Usage/cost observations happen after settlement commit and are not duplicated
  on settlement replay. Process metrics reset on restart and are advisory;
  durable accounting remains authoritative.
- Optional validated absolute `AI_KILL_SWITCH_FILE` checks marker presence,
  failing closed on I/O errors. Creation, cache/receipt reuse and protected reads
  follow the existing disabled-read policy; authorized cancellation, recovery
  and settlement continue. Dispatch and every retry/repair recheck before send.
  Already-sent calls settle under their original snapshot.
- Breakers isolate provider/model/configuration with bounded process state.
  Three failed foreground executions open for 30 seconds. Half-open probes
  use a single foreground lease under normal paid admission. No background
  spending, failover or automatic regeneration is introduced.
- Authorized unavailable-key/tampered payload reads now return truthful expired
  content instead of propagating a cipher error. Old run/accounting metadata
  remains intact. The [operations runbook](../../ai-operations.md) documents
  routine/emergency key rotation, persistent disable, diagnostic limits and
  restart recovery.
- Worker cancellation and drain wait at most five seconds; maintenance waits at
  most one second and cancels future scheduling. Platform writer fencing,
  database transaction timeouts and the overall process shutdown deadline remain
  authoritative if persistence cannot complete.

## Checks

Allowed focused commands are database-free and browser-free:

- `pnpm.cmd --filter @archboard/api test --runInBand --testPathPatterns modules/ai platform/config/ai-config`:
  PASS, 19 suites / 330 tests. Its inspected pretest builds contracts, fixtures,
  document-model and API. Jest excludes `*.integration-spec.ts`. Covers
  fake-clock TTL/scheduling, bounded batches/capacity, preserved liabilities,
  restart-style recovery, failed/stalled maintenance, breaker isolation/probes,
  marker transitions, switch checks between admission/dispatch, disabled HTTP
  read/cancel policy, redacted metrics and duplicate settlement observations.
  After making the marker-path fixture portable across operating systems, the
  same 330 tests were rerun from `apps/api` with
  `node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.config.cjs --runInBand --testPathPatterns modules/ai platform/config/ai-config`
  using the already-built dependencies: PASS.
- `pnpm.cmd --filter @archboard/api typecheck`: PASS, including prepared
  integration source; no database connection.
- `pnpm.cmd lint`: PASS.
- `pnpm.cmd boundary:check`: PASS, including 33 AI negative boundary fixtures
  and 4 existing negative import fixtures.
- `pnpm.cmd --filter @archboard/api run security:scan`: PASS, 346 public
  source/artifact files; configured secret values are compared without printing.
- `pnpm.cmd exec prettier --check` over the AI directory, changed configuration,
  migration/registries and task documentation: PASS.
- `git diff --check` and staged diff check: PASS.

Initial allowed checks found a stalled-maintenance shutdown test waiting on a
stopped scheduler, reserved provider-native metric names, and lint constant
issues. Final HTTP proof also caught the strict run contract rejecting a withheld
completed-result DTO; disabled cancellation now performs the authorized operation
and returns `AI_DISABLED` when a response would disclose private completed content.
These issues were corrected and the affected checks rerun. A Windows shell
interpreted a combined quoted test regex as a pipe; the successful command above
passes separate Jest patterns. No deferred test was launched.

## Deferred acceptance

- PostgreSQL cleanup/settlement races, cascade/byte accounting, restart after
  dispatch, failed maintenance, unknown-liability preservation, transaction
  stalls, writer loss and forward migration round trip:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
  Prepared cases live in `ai-persistence.integration-spec.ts`; source review
  and in-memory proof cannot establish database atomicity. Real process
  termination/restart scenarios are detailed in the runbook for final verification.
- Browser expiry, disabled/read/SSE/cancel UI behavior, native browser and
  served-preview/OAuth flows: **UNRUN (deferred by user)**.
- Live provider breaker, latency, usage, cache hit rate and cost evaluation:
  **UNRUN (requires separately authorized operator budget and reviewed inputs)**.

All corresponding database/browser/live-provider and Version 1 release gates
remain OPEN. AI-C17 completion does not satisfy the M00–M08 trigger.

## Handoff

Next: AI-C18, focused regression and prepared acceptance, depending on this
introducing commit. Resolve its actual SHA from Git history in the next index
update; do not amend historical evidence. Preserve private reviewed intent,
durable spending/recovery, provider isolation, normal graph commands and the
verification deferrals. No push, merge, deployment, migration or paid call occurred.
