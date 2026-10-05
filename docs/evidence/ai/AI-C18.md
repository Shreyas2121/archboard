# AI-C18 — Focused regression and prepared acceptance

Branch: `ai-diagram-integration`.
Parent: `203dc074d3acb7a3a33965537f7845a0bb4a747e`.
Commit subject: `test(ai): cover provider cache quota and recovery boundaries`.
Scope: substantive cross-layer regressions, static AI credential checks, expired
dispatch-lease discovery and recoverable acceptance inventory. Existing OpenAI
SDK/SSE and independent neutral-provider fixtures are reused; no new production
adapter or paid provider call is introduced.

## Changes

- Public orchestration fixtures combine receipt replay/deduplication races under
  one paid slot, global concurrency, body conflict, actor-private cache reuse,
  and fresh generation for another actor. Unknown usage with valid output cannot
  enter cache; its reservation still blocks fresh work after UTC rollover and
  receipt expiry. Revocation after a cache lookup denies disclosure while retaining
  the committed receipt for authorized replay without another paid attempt.
- Pricing checks exhaust all partitions of four input tokens among uncached,
  cache-read and two cache-write classes, with separate reasoning and fractional
  micro-USD rates. Every actual price remains within conservative reservation.
- Maintenance discovery now checks dispatch lease expiry as well as deadlines
  for undispatched work, matching the existing recovery eligibility rule. The
  in-memory restart test catches expiry before the total deadline. A prepared
  PostgreSQL test races two repository/maintenance instances and requires one
  unknown settlement. Existing lease/deadline indexes remain; no migration added.
- A lost local Apply response after structural mutation is recovered from the
  persisted intent and converged replica without duplicate graph IDs or another
  mutation. This Node case does not establish IndexedDB/outbox or committed ACK.
- The shared public-artifact scanner rejects AI operator secret names, configured
  values and recognizable provider-key patterns. Synthetic security tests verify
  count-only results. No secret values or excerpts are printed.
- [Verification inventory](../../ai-verification.md) maps existing/new fixtures,
  explicit allowed commands and precise database/browser/live-provider resume
  conditions. It documents interruption recovery and retains actual-process,
  transaction, rendered UI and paid evaluation proof as OPEN. No aggregate added.

## Checks

All executed tests are database-free and browser-free:

| Check                                                                | Result                                                            |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| API/configuration unit Jest: `modules/ai platform/config/ai-config`  | PASS, 19 suites / 335 tests                                       |
| AI shared contracts: `packages/contracts/src/ai`                     | PASS, 1 file / 47 tests                                           |
| Document-model atomic commands and Undo                              | PASS, 2 files / 22 tests                                          |
| AI editor/transport/layout web-node fixtures                         | PASS, 8 files / 95 tests                                          |
| Security policy Node fixtures                                        | PASS, 6 tests                                                     |
| Root typecheck, including prepared integration source                | PASS                                                              |
| Root lint                                                            | PASS                                                              |
| Boundary checks                                                      | PASS, 33 AI and 4 existing negative fixtures                      |
| Public secret scanner                                                | PASS, 346 public source/artifact files                            |
| Generated cache policy                                               | PASS, 137 precache entries                                        |
| Bundled AI layout worker                                             | PASS, isolated, bounded, referenced, CSP-compatible and precached |
| Prettier on all changed files; Git unstaged/staged whitespace checks | PASS                                                              |

Exact focused commands and static artifact sequence are in the verification
inventory. API pretest builds shared exports/API; Jest excludes integration files.
The web-node harness uses Node. Package-local Vitest executable resolution failed
on Windows; the successful commands use the installed root Vitest module.
An initial unknown-outcome test incorrectly expected replay at the 24-hour receipt
expiry boundary; it now verifies the required expired tombstone and retained
liability, and the full focused API set passes.

Root `pnpm.cmd build`: PASS with HTTPS/WSS fixture origins from the verification
inventory, including generated service worker (137 precache entries). The default
local HTTP origins were rejected by the existing production CSP. A subsequent
sandbox build reported `terser` missing; frozen-lockfile installation found the
dependencies already current, and direct inspection showed sandbox read denial
on its installed manifest. The approved build outside the sandbox passed without
dependency/lockfile changes. No fixture host was contacted. Existing large-chunk
warnings remain advisory.

## Deferred acceptance

- PostgreSQL locking/rollback/cache/maintenance races, real HTTP/auth/session/SSE,
  schema/migration round trip and actual process crash/restart:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
- Browser/native browser/Playwright, offline persistence, rendered proposals,
  expiry, permissions, accessibility and actual committed ACK recovery:
  **UNRUN (deferred by user)**.
- Live model schema compatibility, grounding quality, latency, cache usage,
  breaker and measured cost:
  **UNRUN (requires separately authorized operator budget and reviewed inputs)**.

All database/browser/live-provider and original Version 1 phase/release gates
remain OPEN. AI-C18 completion does not satisfy the original M00–M08 trigger.

## Handoff

Next: AI-C19 operator and product handoff. Resolve this evidence's introducing
commit from Git history in the next index update; do not amend it to embed its own
hash. Preserve private reviewed input, normal graph commands, durable unknown
liabilities and all verification deferrals. No push, merge, deployment, migration,
browser, database verification or paid call occurred.
