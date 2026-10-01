# Phase 6 sharing and discussion audit

Status: **OPEN**. P6-01–P6-11 implementation and P6-12 documentation are delivered
on `phase-6-discussion-sharing`, based on `7cb7c889ae03d9a687def2c07334bf4c87124e30`.
The [evidence index](evidence/phase6/README.md) records every planned commit, the
inspector layout fix and intervening verification-policy commit. No full phase or
release PASS follows from this handoff.

The [Version 1 verification policy](verification-policy.md) defers all database,
session/socket and schema/migration checks until M00–M08 implementation is complete.
Browser checks require separate user resumption. Both pauses remain effective after
Phase 6 completion. Missing proof and inherited failures below remain gate blockers.

## Run and recovery

Use Node 22.23.2 and pnpm 11.24.0. Follow [root setup](../README.md) for ignored
`.env`/`.env.local`, paired pooled/direct database configuration, auth configuration
and `pnpm dev`. Normal development setup does not direct paused verification or
authorize configured migrations. Keep credentials and synthetic authenticated
storage-state files outside tracked files. The [verification guide](phase6-verification.md)
describes production-host headers, independent actors and reproducible later checks.

On an active board, owners manage member roles/removal and invitations; ownership
is immutable. Editors write discussion and edit/delete their own messages; owners
can moderate others. Viewers read discussion. Current owner/editor roles can
resolve/reopen threads. Archived boards retain authorized reads and disable writes;
invitation management requires active owner authority. Self-leave/removal recovery
must freeze pending graph work, offer local recovery export and require an explicit
preservation choice. Losing access never authorizes deletion of local graph storage.

Discussion accepts node/edge/point anchors and up to 4,000 Unicode code points of
plain text, preserving nonblank formatting. Limits are 2,000 threads per board and
500 messages per thread, including deletion markers. Node/edge context comes from
the committed graph; missing/deleted targets retain truthful fallback context.
Discussion records, member roles and invitation state are server-owned relational data.

Drafts stay in account/board-scoped memory and may be lost on navigation/reload.
They never become Y.Doc, graph undo, outbox, IndexedDB or service-worker data.
A stale edit returns 409; the UI retains unsent text, reads current content/version
and requires explicit review/retry or cancel. Failed/uncertain versioned mutations
require a successful current-resource read before retry; no blind overwrite or
automatic text merge is claimed. Resolution is not applied optimistically.

An uncertain thread/reply creation preserves the exact original key, target and
body. Explicit retry uses that request during the conservative 23-hour UI window
within the server's 24-hour receipt lifetime. After expiry, visible-results inspection
must complete before deliberate authorization of a new submission; a separate Send
creates its key. Edited/deleted/missing results and similar text leave duplicate risk.
An idempotency conflict or failed inspection cannot unlock replacement-key submission.

Offline views display previously downloaded data with stale/fetch-time labels;
uncached views are unavailable and REST writes stay disabled. Reconnect/focus/online
recovery cancels stale reads, rechecks the session and refreshes active views.
It never submits discussion drafts or accepts an invitation. Late old-account results
cannot populate the selected account or clear its drafts. Account/access failure hides
protected content while keeping graph recovery bytes in their original namespace.

Invitation creation returns the bearer link once; safe list metadata never reconstructs
it. Discard/copy/revoke are explicit. `/invite/:token` requires sign-in before minimal
preview and explicit acceptance; uncertain acceptance needs same-account confirmation.
Documents require no-store/no-referrer and SPA rewrites. Keep bearer paths, OAuth
continuations, cookies, token hashes and bodies out of logs/telemetry/evidence; never
persist invite responses in query or service-worker caches. Actual host/cache/referrer
and clipboard observations remain deferred.

## Schema and API inventory

Phase 6 adds no dependency/catalog/lockfile or migration changes relative to its base.
Only the root `phase6:verify` script was registered. Existing `comment_threads`,
`comments` and `api_idempotency` tables, integer versions, lifecycle fields and
discussion cursor indexes were reused. `synchronize` and automatic migration execution
remain disabled. P6-01–P6-04 isolated schemas applied foundation and retention migrations;
the configured target separately reported foundation applied and retention pending.
Current configured state is **UNRUN (deferred by user — until Version 1 implementation
is complete)**; no configured migration was applied by Phase 6.

The source-reviewed controllers and `createOpenApiDocument` agree on these operations.
OpenAPI is served at `GET /api/v1/openapi.json`. Shared Zod DTOs are authoritative;
objects use `{ data: ... }`, lists include cursor metadata, and errors use the standard
safe code/message/requestId envelope. This source review is not a fresh HTTP observation.

| Method and path under `/api/v1`                                        | Contract/status                                                                                 |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| GET `/boards/:id/threads`                                              | Thread summaries, descending createdAt/UUID cursor; optional literal true/false resolved filter |
| GET `/boards/:id/threads/:threadId/comments`                           | Messages ascending createdAt/UUID cursor                                                        |
| POST `/boards/:id/threads`                                             | Strict anchor/body plus Idempotency-Key; 201 thread and first comment                           |
| POST `/boards/:id/threads/:threadId/comments`                          | Strict body plus Idempotency-Key; 201 comment                                                   |
| PATCH `/boards/:id/comments/:commentId`                                | body/expectedVersion; 200 comment                                                               |
| DELETE `/boards/:id/comments/:commentId`                               | JSON expectedVersion body; 200 retained deletion-marker comment                                 |
| PATCH `/boards/:id/threads/:threadId`                                  | resolved boolean/expectedVersion; 200 thread                                                    |
| GET/PATCH/DELETE `/boards/:id/members[/:userId]`                       | Existing list, role change and removal/self-leave; immutable owner                              |
| GET/POST `/boards/:id/invites`, DELETE `/boards/:id/invites/:inviteId` | Existing owner list, one-time creation and revoke                                               |
| POST `/invites/preview`, POST `/invites/accept`                        | Existing authenticated bearer-body preview and atomic acceptance                                |

Member GET uses the collection; PATCH/DELETE require userId. Pagination uses strict
shared limit/cursor schemas. Unknown actor/time/version fields are rejected, with
server-owned authorship and current role/session/archive enforcement. Post-commit
resource hints reconcile REST views and do not advance graph sequence or acknowledge
graph outbox entries. Existing WS envelopes are unchanged; resource callbacks were added.

## Deliverables and exit criteria

Numbers follow [phase6.md section 16](../phase6.md#16-deliverables); each row also
covers its related section 17 exit condition. Supporting PASS applies only to the
named boundary. Every required current-tree DB and rendered boundary below is UNRUN
under its respective pause, so every integrated exit criterion remains OPEN.

| Deliverable / exit condition                             | Implementation and supporting proof                                                                                                                                                | Remaining required proof / blocker                                                                                                |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1. Contracts, limits, documentation                      | [P6-01](evidence/phase6/P6-01.md), [P6-11](evidence/phase6/P6-11.md): strict DTO/cursor/Unicode negatives, 113 contracts; source route/Swagger agreement                           | Current HTTP/DB/schema proof; boundary scan FAIL                                                                                  |
| 2. Transactional creation, caps, idempotency, pagination | [P6-02](evidence/phase6/P6-02.md): historical real-session/isolated PostgreSQL 39-case selection PASS; [P6-11](evidence/phase6/P6-11.md) prepared five query-plan observations     | Current transactions/rollback/concurrent caps/receipt expiry; 301-thread/500-message query plans UNRUN                            |
| 3. Authorship, moderation, markers, resolution           | [P6-03](evidence/phase6/P6-03.md): historical stored versions/races; full invocation FAIL followed by three corrected rollback cases PASS; Node policies PASS                      | Current stored winning state and independent rendered role/conflict/deletion proof                                                |
| 4. Share/members/ownership/preservation                  | [P6-05](evidence/phase6/P6-05.md): role, freeze/export/cancel policies PASS; P6-11 keyboard/role harness prepared                                                                  | Served owner/editor/viewer matrix, pending IndexedDB bytes/export/self-leave/removal                                              |
| 5. Invitations and recipient route                       | [P6-06](evidence/phase6/P6-06.md), [P6-07](evidence/phase6/P6-07.md): actual adapters, token/result scope and uncertainty states PASS                                              | Current A19 race; independent signed-in route; token/cache/referrer/clipboard/telemetry inspection                                |
| 6. Anchored panel, drafts, conflicts, keyboard           | [P6-08](evidence/phase6/P6-08.md), [layout fix](evidence/phase6/P6-08-sidebar-fix.md), [P6-09](evidence/phase6/P6-09.md): Node adapters, attribute compatibility and recovery PASS | Served node/edge/point/deleted anchors, rendered A20, layout/keyboard/spoken accessibility                                        |
| 7. Commit hints, reconnect, authority                    | [P6-04](evidence/phase6/P6-04.md): eight historical new session/socket/DB cases plus 68 regressions PASS; P6-10 actual transport/query policies PASS                               | Current fanout ordering, missed-event reconnect and rendered REST refetch for pages/filters                                       |
| 8. Offline/archive/account/session integration           | [P6-10](evidence/phase6/P6-10.md): late-response fencing, session-before-recovery, stale memory data, no draft auto-send PASS                                                      | Combined A10/A24/A25/A27 across independent tabs, actual offline worker/IndexedDB and `/demo` isolation                           |
| 9. A11/A19/A20 and regressions                           | Historical API/socket results and current Node checks below; [P6-11 coverage matrix](phase6-verification.md#coverage-and-required-boundaries)                                      | Current DB/socket integrations and independent browser product proof; inherited blockers                                          |
| 10. Verifier and run guidance                            | [P6-11 report](evidence/phase6/P6-11-report.json): modes wired, failure propagation/privacy tests PASS; full fails closed on manual UNRUN                                          | Aggregate FAIL on 32 inherited boundaries; DB/browser paused; future reviewed human-evidence validation step needed for full PASS |
| 11. Audit and evidence index                             | [Index](evidence/phase6/README.md), [P6-12](evidence/phase6/P6-12.md): history/link/format inspection                                                                              | Documentation completion cannot close acceptance                                                                                  |

### A11, A19 and A20 separately

- **A11 OPEN:** P6-04 historical real-cookie raw WS viewer denial and affected
  permission/board/invite regressions PASS; P6-02/03 discussion denials have historical
  stored-state proof. P6-11 prepares combined cross-board discussion/member/invite
  denials and unchanged rows/graph sequence. Those new cases and all current-tree
  DB/socket checks are UNRUN; served role negatives are also UNRUN.
- **A19 OPEN:** P6-04's historical invite regression suite includes independent
  acceptance/retry races and upgrade/no-demotion semantics. P6-07 Node route-state
  and adapter checks PASS, without proving PostgreSQL acceptance. Current independent
  DB acceptance and P6-07 two-recipient rendered preview/acceptance race, reload,
  uncertainty and privacy proof remain UNRUN.
- **A20 OPEN:** P6-03 historical edit/edit, both edit/delete and resolve/reopen
  orderings retain winning stored state; its failed full invocation is preserved
  separately from corrected focused PASS. P6-09 actual moderation coordinator tests
  PASS for retained drafts/current-content review/explicit retry. Current stored-state
  races and independent rendered conflict review remain UNRUN. Neither a 409 alone
  nor an invalidation hint establishes rendered recovery.

## Recorded environment and permitted verification

P6-11 code tree: `039842e677743c4ef3be3fbc2cd2e366a731e698`, parent
`f54c85dfabda15819ec8164f4d58efcaf7c6e61d`. Windows, Node 22.23.2, pnpm 11.24.0,
TypeScript 6.0.3, Vite 8.3.0; pinned Zod 4.6.4, TypeORM 1.1.1, Better Auth 1.7.4,
pg 8.23.0. Historical remote PostgreSQL server version was not captured; current
PostgreSQL/browser versions are UNRUN. No runtime browser build observation follows.

`pnpm.cmd phase6:verify --implementation` ran outside the sandbox after dependency
metadata EPERM failures: **FAIL**, exit 1, 22 PASS / 1 FAIL / 10 UNRUN rows.
430 tests PASS: contracts 113, fixtures 16, document-model 51, API 139, selected web
Node 18, sharing/discussion/lifecycle 92, account selection 1. Frozen install,
format/lint/types, workspace build, bundle/cache/public/evidence/report scans and
five browser syntax checks PASS. Dependency boundaries FAIL: 32 unchanged findings
(13 frontend test/config paths, 19 API layer/cross-feature imports); four negative
fixtures PASS. The checker was not waived or weakened.

Exact commands, child working directories, counts and timings are in the
[sanitized report](evidence/phase6/P6-11-report.json) and
[P6-11 evidence](evidence/phase6/P6-11.md). Frozen install took 2.264 s, format
11.378 s, lint 11.091 s, types 49.728 s, build 44.805 s, API units 47.033 s,
lifecycle tests 3.138 s. Raw logs and credentials were not persisted. Final production
entry `index-CWs__Ozh.js` has SHA-256
`D4A475F2740990CB76A486905115495011CA76AB2FE437F087DD20A673F8ED63`;
the implementation build uses a fixed synthetic public API origin. Existing large-chunk
warning remains. P6-12 changes only documentation, so it references this unchanged-code
run and performs focused documentation checks without repeating the aggregate.

## Deferred verification and inherited blockers

**UNRUN (deferred by user — until Version 1 implementation is complete):**
`pnpm phase6:verify --non-browser`, real DB-backed HTTP/session/socket suites,
auth-schema comparison and configured migration inspection. After M00–M08, verify
the intended target and run isolated migrated fixtures; inspect configured migrations
separately. Historical foundation-applied/retention-pending state remains a blocker
until current configured proof exists. This audit applies no migration.

**UNRUN (deferred by user):** full `pnpm phase6:verify`, native browser units and
all five prepared served harnesses. After browser resumption, follow
[fixture/host setup](phase6-verification.md#later-served-browser-setup), including
the required deleted-anchor fixture, independent accounts and actual offline/worker
conditions. Complete combined pending graph/account flows, keyboard traversal,
spoken accessibility, clipboard failure and host/CDN/proxy/application-log observations.
The current full verifier intentionally reports required manual evidence UNRUN and
exits nonzero; reviewed evidence validation must be added before a future full PASS.

The P6-11 prepared security harness checks inert HTML/script/URL-looking message
text without execution or preview requests (discussion-scoped A18); actual execution
is UNRUN. Full import/XML A18 belongs to Phase 7. A10/A24 preservation/account,
A25 route/cache and A27 archive/write regressions remain OPEN at the combined
served boundary; keyboard/spoken checks do not establish release-wide A28.

[Phase 3](phase-3-identity-boards.md) retains its historical PASS.
[Phase 2](phase-2-editor.md) remains OPEN: recorded pan p95 83.3 ms versus 32 ms,
spoken screen-reader and other missing browser proof. [Phase 4](phase-4-collaboration.md)
remains OPEN: recorded visibility p95 4,876 ms versus 500 ms, configured retention
migration, ownership boundaries, literal process kill/lock-loss, socket fault and
combined preservation gaps. [Phase 5](phase-5-offline.md) remains OPEN: historical
presence fanout failure and combined offline/reconnect/access/account/worker-update
proof. These measurements were not remeasured or relabeled. P6-04's affected
68-test socket/authority regressions are focused historical follow-up, not blanket
closure of the earlier presence/performance/fault gates.

Permission, schema/migration, protected fanout/order, preservation and account
failures bind dependent Phase 6 criteria and prevent full PASS. Broader pan/visibility
budgets and release accessibility remain owned by their prior audits; Phase 6
does not revise or certify them. All remain visible for final verification.

## Phase 7 handoff

Phase 7 implementation may proceed with the gate OPEN. Shared graph schemas and
document-model projection/restore/remap operate on graph data; discussion/access
records remain outside Y.Doc. Existing duplicate-board creation uses remapped committed
graph bytes and creates independent authority; it does not copy comments, memberships,
invitations or receipts. Phase 7 must maintain this boundary in export/import/copy,
templates and checkpoint restore, and add actual portability proof at its owning task.
Restoring a checkpoint must not restore or erase current access/discussion state.

Preserve deletion fallback context and server authority when graph IDs change;
do not treat graph saved/ACK status as discussion freshness or include memory drafts
and invite secrets in graph recovery downloads. Keep local pending work recoverable
under its original account namespace. The audit does not claim that Phase 7 portability,
presentation, Phase 8 hardening, deployment or Version 1 release is implemented or verified.
