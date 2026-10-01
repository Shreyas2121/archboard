# Phase 6 verification

The [Version 1 verification policy](verification-policy.md) applies. Run only
`pnpm phase6:verify --implementation` during M00–M08 implementation. Completing
Phase 6 does not resume database checks; browser checks require separate user resumption.

## Modes and results

| Command                               | Children                                                                                                                                                                                                                                                                                           | Result meaning                                                                                                                                                                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm phase6:verify --implementation` | Frozen install, formatting/lint/types, one workspace build, contracts/fixtures/document-model Node units, API units, existing web Node units, sharing/discussion/lifecycle Node harnesses, account-selection tests, bundle/cache/evidence/public secret scans, boundaries, browser **syntax only** | Database/schema/socket/browser execution is UNRUN. Exit zero means these permitted children passed; full gate stays OPEN.                                                                                                                         |
| `pnpm phase6:verify --non-browser`    | Implementation checks plus real PostgreSQL HTTP/session/socket integrations, auth schema and configured migration inspection                                                                                                                                                                       | Run only after all Version 1 implementation. No browser child executes; browser/manual acceptance stays OPEN.                                                                                                                                     |
| `pnpm phase6:verify`                  | Non-browser checks plus native browser units and all five prepared served Phase 6 browser harnesses                                                                                                                                                                                                | Run only after both pauses permit it. Required human/combined acceptance remains UNRUN and causes nonzero exit until reviewed proof is supplied through a future evidence validation step. Full PASS is never inferred from the automated subset. |

The plan is in `scripts/phase6-check-plan.mjs`. Execution is sequential, uses Node
and pnpm without shell command interpolation, and continues independent checks after
a failure. A failed build prevents tests/scans from using stale generated artifacts;
those children report UNRUN. Unknown or combined mode flags fail before any child.
Test children require a nonzero observed test count. Unapplied configured migrations
fail independently from isolated test-schema migrations. No mode applies configured migrations.

Each child reports duration/status and test count when applicable. A temporary
`archboard-phase6-*` directory contains `report.json`: fixed check IDs, numeric results,
commands and relative working directories. Raw child output is kept transiently in
memory for result parsing and is never printed or persisted by the verifier. The
generated report and committed Phase 6 evidence are scanned for secrets. Keep only
sanitized summaries in evidence; diagnose failed children through their documented
commands without publishing raw database/browser errors.

Implementation mode does not load root database configuration; it removes database
and server credential variables from child environment. Static secret scanners read
ignored local credential values only to compare against public assets/evidence, with
no network/database requests. Shared builds run once; direct Jest/Vitest invocations
avoid package pretest rebuilds and do not use the browser-running root `pnpm test`.
Existing web test/config boundary findings remain failures; the verifier grants no exemption.

## Coverage and required boundaries

| Criterion                        | Real-boundary coverage prepared/reused                                                                                                                                                                                                                                                                                                     | Permitted supporting coverage                                                                      | Required remaining proof                                                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A11                              | `auth-websocket.integration-spec.ts` viewer raw update denial with unchanged durable state; `boards.integration-spec.ts` member/graph scoping; `invites.integration-spec.ts` owner/nonmember/cross-board controls; `discussion.integration-spec.ts` discussion role/target negatives and P6-11 combined cross-resource stored-state checks | Shared strict schemas, board permission units, P6-05/06/08/09 policies                             | Current-tree DB/session/socket execution; served viewer/owner/editor action matrix                                                                        |
| A19                              | `invites.integration-spec.ts` deterministic two-actor acceptance, retry/exhaustion, expiry/revoke-after-preview, upgrade/no-demotion/owner no-op and rollback; discussion/auth-WebSocket integrations verify committed membership notifications                                                                                            | Actual invite adapters and explicit acceptance state tests                                         | Independent signed-in P6-07 route race and runtime token/referrer/cache/log inspection                                                                    |
| A20                              | `discussion.integration-spec.ts` stored winning body/version after edit/edit, both edit/delete orders, both resolve/reopen orders, current roles and transaction failures                                                                                                                                                                  | Actual moderation coordinator/adapters and retained-draft conflict/review/retry tests              | P6-09 rendered conflict review with independent actors and real persisted winning row                                                                     |
| Atomic creation/caps/idempotency | Discussion integrations: first-message/receipt rollback, 2,000-thread/500-message concurrent caps (markers count), changed-key request rejection, 24-hour receipt expiry, replay reauthorization                                                                                                                                           | Contracts, actual adapter payload/key tests                                                        | PostgreSQL transaction/race execution; uncertain-response rendered recovery                                                                               |
| Anchors and pagination           | Discussion integrations: committed snapshots/update log, trusted fallback, pending/cross-board/tombstoned targets, graph-delete ordering, exact timestamp/UUID cursors; P6-11 measures five actual repository query plans over 301 threads and a 500-message thread                                                                        | Mapping, deleted fallback identity and cursor adapter tests                                        | Runtime node/edge/point UI and mandatory deleted-anchor fixture; query plan/timing observations without a new performance target                          |
| Invalidation/reconnect           | Discussion integrations: commit-before-hint, rollback/no-op/replay silence, role/archive/removal/session fanout ordering, no graph ACK/sequence effects; new reauthenticated socket + REST reads after a missed reply                                                                                                                      | Actual transport/query lifecycle tests, failed recovery and late scope fencing                     | Independent served reader refresh and missed-event reconnect, all pages/filters                                                                           |
| A10/A24                          | Existing auth/permission/socket denial suites plus P6-05/09/10 state preservation/scope tests                                                                                                                                                                                                                                              | Freeze/export/cancel, memory drafts, selected-account/pending-sign-out, actual Y.Doc removal bytes | Combined real IndexedDB queued bytes/export/self-leave/removal/sign-out/account switching across tabs; `/demo` independence                               |
| A25/security                     | REST boundary safe diagnostics; P6-07 actual document no-referrer/no-store, active worker, cache/storage/referrer checks; P6-11 inert message and no preview fetch                                                                                                                                                                         | Static generated cache policy, public/evidence scans, strict response/wire and redirect tests      | Served host policy, CDN/proxy/application telemetry inspection; direct invite/editor routes under real offline/session conditions                         |
| A27/accessibility                | Current archive/role/session integrations and P6-10 rendered offline/downgrade/archive harness; P6-11 share keyboard open/Escape/focus and immutable-owner/nonowner UI                                                                                                                                                                     | Auth/editor lifecycle Node suites                                                                  | Keyboard traversal/labels/live announcements in every form; spoken screen-reader spot check and narrow-screen flow. This does not close release-wide A28. |

All database-backed rows remain **UNRUN (deferred by user — until Version 1
implementation is complete)**. All rendered/browser rows remain **UNRUN (deferred
by user)**. Historical P6-01–P6-04 observations remain at their recorded trees and
do not replace current-tree verification. Units, syntax and source/cache policy do
not prove PostgreSQL races, rendered REST refresh or actual browser privacy.

## Later database setup

After M00–M08 implementation, supply ignored root `.env`/`.env.local` with paired
pooled/direct URLs, API configuration and auth secret. The verifier maps
`DATABASE_URL_UNPOOLED` to `DATABASE_DIRECT_URL` when present. Confirm the intended
target independently before executing. The integration suite owns uniquely named
isolated schemas and their migration/cleanup lifecycle; configured migration inspection
is read-only and separate. Prefer an isolated local test database where compatible.
Never use a shared production target for fixture tests.

The database children use API `jest.integration.config.cjs` (no `--passWithNoTests`),
`scripts/check-auth-schema.mjs`, and TypeORM `migration:show` against the built
configured data source. No DB child runs in implementation mode.

## Later served browser setup

Supply real served production web/API origins and independent synthetic states
outside the repository. The full build uses `P6_API_ORIGIN` for HTTP/WebSocket origins;
serve the resulting build at `P6_WEB_ORIGIN`. These browser scripts do not start a
preview/API or provision state files for you. The host must enforce invite no-store,
no-referrer and SPA rewrite rules; Vite preview alone is not production-host proof.

All five harnesses require `P6_WEB_ORIGIN`, `P6_API_ORIGIN`, `P6_BOARD_ID` and
`P6_OWNER_STATE`. Additional inputs:

| Harness                   | Required additional fixtures                                                                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P6-07 invite acceptance   | `P6_RECIPIENT_ONE_STATE`, `P6_RECIPIENT_TWO_STATE` (two distinct initially unjoined recipients)                                                                                              |
| P6-08 discussion          | `P6_VIEWER_STATE`, committed `P6_NODE_ID`, `P6_EDGE_ID`; provide `P6_DELETED_THREAD_ID` for required deleted-target proof (its optional script branch alone cannot establish that criterion) |
| P6-09 conflict/moderation | `P6_EDITOR_STATE`, `P6_OTHER_EDITOR_STATE`, `P6_VIEWER_STATE`                                                                                                                                |
| P6-10 lifecycle           | `P6_EDITOR_STATE`                                                                                                                                                                            |
| P6-11 sharing/security    | `P6_EDITOR_STATE`, `P6_VIEWER_STATE`                                                                                                                                                         |

Use a disposable active board with owner/editor/other-editor/viewer and two distinct
recipient actors. Harnesses create synthetic rows and retain them; P6-10 restores
temporary role/archive mutations. Fixed stage diagnostics omit tokens/cookies/content.
P6-07 checks actual no-referrer/no-store headers, a controlling worker, Cache Storage,
local/session storage, console/referrers and third-party requests. P6-11 checks
immutable ownership, nonowner negatives, keyboard dialog focus, one-time invite result,
revocation and inert text. Clipboard permissions/failure, full screen-reader behavior,
proxy logs and combined account/pending graph flows require supplementary observations.

Record environment/browser/build hashes, independent actors, exact outcomes and observed
cache/IndexedDB surfaces before considering acceptance. Required missing observations
remain OPEN; there is no skip-human, allow-failure or baseline-waiver option.

## Inherited findings

[Phase 3](phase-3-identity-boards.md) retains historical PASS.
[Phase 2](phase-2-editor.md), [Phase 4](phase-4-collaboration.md) and
[Phase 5](phase-5-offline.md) remain OPEN. Their historical pan/visibility measurements,
process/lock fault proof, presence fanout failure, pending configured retention migration
and combined offline/account/browser gaps are not remeasured or closed here. Current
boundary failures propagate through every verifier mode. The recorded retention
migration requires final configured-state proof; isolated migrations cannot close it.
Phase 6 implementation may continue with those gates OPEN; no release readiness follows.
