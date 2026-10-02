# Phase 7 verification

Phase 7 presentation and portability acceptance is **OPEN**. The
[Version 1 verification policy](verification-policy.md) defers every database,
session/socket and configured schema check until M00–M08 implementation is complete.
Browser verification requires independent explicit resumption. No mode name
overrides these conditions. Historical evidence stays attached to its original tree.

## Modes and reporting

| Command                               | Children executed                                                                                                                                                                                                                                  | Full acceptance                                                                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm phase7:verify --implementation` | Formatting, lint, types, one workspace build, Node contracts/fixtures/model/export/API/web units, presentation/portability/account/storage lifecycle Node tests, public/evidence scans, generated-cache source scan, boundaries and browser syntax | OPEN; real DB and browser rows UNRUN                                                                                                             |
| `pnpm phase7:verify --non-browser`    | Implementation children plus all real API integration suites, auth compatibility and configured migration inspection                                                                                                                               | OPEN; browser rows UNRUN. Do not run during the database pause                                                                                   |
| `pnpm phase7:verify`                  | Non-browser children plus native browser units and seven served harnesses                                                                                                                                                                          | Fails closed on any failed, blocked, missing or unwired required boundary, including the three manual rows below. Do not run during either pause |

Only one mode is accepted; unknown and combined switches reject. There is no
silent `--quick` or automatic browser/database fallback. Installation is not a
child: if setup requires it, use the existing pinned pnpm and frozen lockfile
separately. The verifier never starts an API, database or preview service.

Each child reports PASS/FAIL/UNRUN, duration, fixed command/cwd and required unit
test counts. Zero/missing counts, skipped required tests, failed process starts,
signals/nonzero exits, pending configured migrations and failed prerequisites
cannot pass. Independent later children continue after failure; build-dependent
children cannot use stale dist artifacts. Syntax children use `node --check`,
which does not import a harness, launch a browser or connect to an API/database.

Reports go to a fresh system temporary directory as sanitized JSON. Child output
is bounded in memory and discarded; no raw logs, snippets, graph content, HTTP
headers, credentials, storage state, traces or URLs enter the report. The final
report is secret-scanned. Implementation mode does not load root env files and
removes DB/Neon/auth-secret variables from child environments. Static secret
scanners may read local credential values solely for comparisons, never requests
or output. Builds use inert API/WS origins in partial modes. Full mode builds for
`P7_API_ORIGIN`; a production served run must use that exact built origin.

An implementation/non-browser exit code 0 would mean only that mode's checks
passed. It would not close the full gate. The current inherited boundary failures
still produce exit code 1. Default full mode also cannot pass while required
manual evidence remains unwired; no boolean flag can turn those rows into PASS.

## Acceptance map

| Criterion   | Pure/Node proof                                                                                                                                                                                                      | Prepared real PostgreSQL/session/socket proof                                                                                                                                                                                                                                           | Prepared served proof and remaining limits                                                                                                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A16         | Checkpoint service/controller units enforce scoped sequence/cap/queue/idempotency rules; P7-08 capture blockers and generation fences                                                                                | `boards.integration-spec.ts`: committed snapshot/log capture, immutable bytes/metadata after editing/compaction, 409, post-commit-only hints, viewer/cross-board denial, archive/downgrade/remove/expire lock races, checkpoint cap and rollback, private restore and revoked replay    | P7-08 route/capture/restore subset; P7-11 file-created original, independent offline pending client, immutable direct route, fresh restored client and subsequent original/restored edits. Actual execution remains required                             |
| A17         | Export JSON strict/full-content units; model fresh initialization and canonical fixture comparison include all authored geometry/content/style/order/endpoints/highlights; three templates and mutually disjoint IDs | Import/duplicate/restore/template stored snapshots now use one semantic normalizer. Import/duplicate/template/capture/restore rollback, board cap competition and actor-scoped retries; duplicate retry advances a complete committed update rather than sequence metadata alone        | P7-08 actual download/import and uncertain retry; P7-10 blank/templates/demo/export-import; P7-11 all-kind actual file semantics and ID isolation. Above-cap full recovery/storage-failure matrix remains manual                                         |
| A18         | Strict versions/unknown fields/prototype/URL/reference/UTF-8/bytes/depth negatives; controlled XML primitives, escaping, size/area/scope tests; adapter resource lifecycle units                                     | P7-11 raw unsafe-envelope requests reject before any board/receipt; authenticated import/role/session/access boundaries in API suites                                                                                                                                                   | P7-09 real SVG/PNG download/decode/header/alpha/scale, hostile text under CSP, no remote fetch, cleanup/failure/cancel/offline; P7-11 inert imported editor text and URL. Host CSP/rewrite and real limit/selection controls remain explicit manual gaps |
| A21         | Presenter lease/connection/liveness units; explicit follow, pan release, stale lease/account/connection rejection and viewport state tests                                                                           | `auth-websocket.integration-spec.ts`: independent acquisition contention, viewer/same-account-tab denial, ready/current-state ordering, holder-only controls, deleted/pending targets, silent 30-second expiry, disconnect/session/role/archive/removal release, unchanged durable rows | P7-05 two distinct authenticated owner/viewer contexts verify opt-in, exact camera fit, pan then later frame preservation, lease loss/reconnect/new lease and board/account switch. Active worker is now awaited before offline reload                   |
| A10/A22     | Actual recovery adapter/complete pending projection export, device/server-save distinction, pending persistence/outbox blockers and uncertainty                                                                      | Auth/permission/receipt/durable update/session regression suites; mocks do not prove IndexedDB or durability                                                                                                                                                                            | P7-03 offline authoring/reload; P7-10 isolated demo offline export; P7-11 original offline pending export/reload and restore namespace. Combined multi-tab real storage failures and oversized recovery remain manual                                    |
| A11/A27     | Shared permission and checkpoint/presenter state units                                                                                                                                                               | Board archive/update/capture and access lock races; raw viewer writes/lease/capture/cross-board denials and revoked fanout in real HTTP/socket suites                                                                                                                                   | P7-03 owner/editor/viewer/archived board authoring; P7-05 viewer/archive live-control absence. No inherited performance/fault gate is closed                                                                                                             |
| A13         | Seeded independent replica step text/property/reorder/delete and local undo with remote preservation; native text shortcut regressions                                                                               | Existing accepted-document/update tests reject physical map removal/tombstone clearing                                                                                                                                                                                                  | P7-03 keyboard authoring/local playback and named/focus controls; browser offline/local persistence remains UNRUN                                                                                                                                        |
| A24         | PortabilityGeneration, request/account-scope fences, retained uncertain payload/key, account transition/editor loader and selected-account tests                                                                     | Real auth/session revocation and replay authorization regressions                                                                                                                                                                                                                       | P7-05 board/account follow isolation; full late GET/POST/file-read/export switch/sign-out with preserved real queued bytes remains in mandatory manual recovery row                                                                                      |
| A25         | Generated service worker static navigation/precache exclusion and public/evidence scans                                                                                                                              | Checkpoint REST no-store and current scoped reads                                                                                                                                                                                                                                       | P7-08 and P7-11 direct checkpoint route/offline unavailable plus actual active Cache Storage exclusion. Source cache/CSP policy is not runtime host evidence                                                                                             |
| Focused A28 | Native shortcut/text behavior units and labeled control source review                                                                                                                                                | No DB substitute                                                                                                                                                                                                                                                                        | Keyboard presentation/export/import/restore and focus observations in prepared scripts; spoken screen-reader, narrow-screen and template visual review remain mandatory human evidence. No release-wide A28 claim                                        |

All current-tree database rows: **UNRUN (deferred by user — until Version 1
implementation is complete)**. All rendered/browser rows: **UNRUN (deferred by
user)**. A16/A17/A18/A21 and combined acceptance remain OPEN.

## Later database setup

After M00–M08 implementation, confirm the intended disposable test target before
execution. Integration harnesses own isolated schemas and migration/cleanup
lifecycles; prefer a separate local PostgreSQL test database where compatible.
Provide paired pooled/direct URLs and auth configuration in ignored root env files.
Non-browser/full map `DATABASE_URL_UNPOOLED` to `DATABASE_DIRECT_URL` when present.
Configured migration inspection is read-only and separate from test-schema
migrations. This guide authorizes no configured migration or deployment.

The real DB child uses all `apps/api/jest.integration.config.cjs` suites, without
`--passWithNoTests`; this retains permission/auth/durable graph regressions alongside
Phase 7. For diagnosis after resumption, focused commands include:

- `pnpm --filter @archboard/api test:integration -- boards.integration-spec.ts`
- `pnpm --filter @archboard/api test:integration -- auth-websocket.integration-spec.ts`
- `pnpm auth:schema:check` and `pnpm db:migration:show` (configured state boundary).

## Later browser setup and executable inventory

After explicit browser resumption (and the DB condition for connected scripts),
serve the full-mode production build and real API with correct credentials/CORS,
WebSocket upgrades, SPA rewrites, CSP, no-store and protected API cache exclusion.
Use synthetic disposable boards/accounts and independently authenticated state
files outside Git. Do not print state files, cookies, graph content or credentials.
Run against the same production build recorded in evidence, with `P7_WEB_ORIGIN`
and `P7_API_ORIGIN` pointing to those services. Harnesses do not provision fixtures
or start servers; successful fixture writes are disposable test data.

| Command (`node scripts/<file>`)           | Configuration and cases                                                                                                                                                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `p7-03-local-presentation.browser.mjs`    | `P7_WEB_ORIGIN`; fresh isolated demo; capture, incremental fields, reorder, keyboard/focus, active-worker offline reload                                                                                                                                         |
| `p7-03-board-presentation.browser.mjs`    | Web/API origins, `P7_BOARD_ID`, `P7_ARCHIVED_BOARD_ID`, `P7_OWNER_STATE`, `P7_EDITOR_STATE`, `P7_VIEWER_STATE`; inspect the script's fixed fixture checks; role/archive/local-authoring and remote active-step deletion                                          |
| `p7-05-presenter-follow.browser.mjs`      | Web/API origins, active/archived IDs, owner/viewer states; distinct users with owner/viewer roles, two consecutive named committed steps with different rectangles, quiet board. A21 and transient/no-write evidence                                             |
| `p7-08-portability.browser.mjs`           | Web origin, owner state, active owner board ID; JSON file/retry, checkpoint route/capture/restore, offline unavailable and real worker cache exclusion                                                                                                           |
| `p7-09-image-export.browser.mjs`          | Web origin; fresh local demo; image bytes/decode/dimensions/alpha and failure/cancel/cleanup/CSP/offline. No DB needed                                                                                                                                           |
| `p7-10-templates.browser.mjs`             | Web origin, owner state below cap; creates blank/three templates and explicit demo import; lost template response retry, fit/steps/keyboard and local offline demo                                                                                               |
| `p7-11-portability-lifecycle.browser.mjs` | Web/API origins, owner state below cap; creates a hostile-text all-kind file source and restored board, independent same-owner offline original context; real downloads, capture retry, immutable checkpoint, pending-work/namespace isolation and Cache Storage |

Native browser suites are separately wired through `pnpm test:browser`. The
verifier syntax-checks all seven files during implementation without importing
them. Browser process exit success is only that harness's asserted subset,
never a substitute for its remaining matrix or host/human observations.

## Required missing evidence and full-mode blockers

These rows remain explicitly UNRUN even in full mode until actual reviewed
evidence is wired and validated. They cannot be bypassed by a mode flag or a
unit/mock result. A later owner must bind observations to the exact tree/build,
fixture, actor/context and command, retain safe counts/status only, and add
positive/negative evidence-validation tests before replacing a row.

1. `combined-A10-A22-A24-recovery`: real IndexedDB pending persistence/outbox,
   quota/storage failure and above-5-MiB untruncated recovery; independently queued
   tabs, sign-out/account/access change during late file read/GET/POST/export,
   exact preserved bytes/namespace and safe late-result rejection. Include 24-hour
   uncertain-request expiry, review before new-key submission, no automatic
   reconnect retry and remaining import/duplicate/restore response-loss cases.
2. `A18-host-and-image-limits`: real production host headers/CSP/rewrite evidence;
   oversized image limits before canvas allocation, selected nodes/internal edges
   and omitted edge-only feedback, download failure/unmount/account switch cleanup,
   retained original graph/outbox under simultaneous edits, and no resource
   execution/fetch. XML/pixel unit proof does not close this row.
3. `A28-and-template-legibility`: all template cards, edges/labels/boundaries/notes
   at fit-to-content, narrow/desktop and light/dark; complete keyboard traversal,
   file/export/restore dialogs and focus/announcements plus spoken screen-reader
   spot checks. This does not close Phase 8 release accessibility/performance.

Prior Phase 2/4/5/6 gates retain their historical failures/UNRUN boundaries and
OPEN statuses. P7-12 audits the final history/evidence and hands consolidated
missing proof to M08; it does not resume verification or certify deployment.
