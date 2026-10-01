# Archboard Phase 6 — Commit-by-Commit Implementation Guide

Version: 1.0<br>
Date: 30 September 2026<br>
Status: Implementation guide<br>
Governing documents: `plan.md` version 1.1 and `phase6.md` version 1.0<br>
Branch policy: one long-lived Phase 6 branch for the entire milestone

## 1. Purpose

This guide turns Phase 6 discussion and sharing UX into twelve small, reviewable commits. It
specifies the branch workflow, owned paths, implementation boundaries, checks, evidence, and
handoffs for an implementing agent. The outcome is integrated board sharing, authenticated
invitation acceptance, permission-correct anchored discussion, and committed REST resource
refresh across connected clients.

Authority order is the user's latest written instruction, `plan.md`, `phase6.md`, then this
guide. If these disagree, record the exact conflict and evidence before changing a contract.
Routine names may follow the current tree; server ownership, invite secrecy, authorization,
idempotency, version conflicts, graph durability, and account isolation must stay intact.
Writing this guide does not perform implementation, create a branch, or authorize deployment.

The [Phase 3 audit](docs/phase-3-identity-boards.md) records **PASS** for its historical identity,
member, and invite implementation. Reuse those services and verify their current behavior rather
than treating the finished sharing UI as already proven. The [Phase 4 audit](docs/phase-4-collaboration.md)
and [Phase 5 audit](docs/phase-5-offline.md) remain **OPEN**; the independent Phase 2 editor audit
is also OPEN. Phase 6 can build on their implementations without claiming those gates passed.

## 2. Fixed implementation decisions

### 2.1 One branch and one planned commit per task

Use one branch named:

```text
phase-6-discussion-sharing
```

Create it once from the approved integration baseline containing Phase 3/4 and the available
Phase 5 lifecycle implementation, after `phase6.md` and this guide are committed or included in
an approved planning commit. Record the base hash and current audit statuses in P6-01 evidence.
P6-01 through P6-12 land in order on this branch. If the branch already exists or user changes
are present, inspect and preserve them; do not force-create, reset, or overwrite unknown work.

This guide does not authorize remote push, merge, rebase, deployment, production migration,
OAuth configuration, or deletion of user data. Follow later explicit user instructions. If
contributors take turns, only one edits or commits to the shared branch at a time. Leave a
committed, reviewable state and evidence handoff. No per-task branches, worktrees, or cherry-pick
assembly are part of this workflow.

### 2.2 Sources of truth and feature boundaries

```text
PostgreSQL       -> members, invites, threads, messages, versions, authorship
TanStack Query   -> account/board-scoped fetched REST views
Local UI state   -> selection, viewport, clearly unsent drafts
Y.Doc / outbox   -> existing graph edits and their durability protocol
Room events      -> post-commit invalidation hints and access enforcement
Service worker   -> versioned static shell; no protected REST/token cache
```

Comments and access data never enter Y.Doc, graph exports, or the graph outbox. REST discussion
operations do not save graph snapshots, change `latestSeq`, manufacture ACKs, or affect pending
graph counts. React Flow remains a projection of the one graph document. Reuse Better Auth,
the shared permission service, existing invite/member APIs, room serialization, query client,
recovery flows, and editor component system.

M06 formally depends on M03 and M04. Phase 5 supplies offline/account integration behavior; its
OPEN audit is not permission to weaken that behavior or a reason to rebuild the offline product.
Phase 7 owns presentation, checkpoints, full portability, and templates. Phase 8 owns broader
release accessibility, performance, backups, and deployment. `/demo` remains local-only without
server discussion or invitations.

### 2.3 Permissions, ownership, and archive state

Every REST request and persistent WS update uses the same server permission service. Check
current membership/session/archive state at the transactional write boundary, not just when a
dialog opened. The board owner is immutable and derived from the board record; no owner member
row, demotion, removal, self-leave, or transfer is introduced.

On an active board, all readers can see members and discussion. Owners manage invitations and
other members. Nonowners can leave themselves. Owners/editors create/reply/resolve; editors can
edit/delete only their own messages; owners can moderate any message. Viewers are read-only,
including former authors downgraded to viewer. Removed users lose server reads and writes.
Archived boards retain authorized reads but block Phase 6 mutations until restored.

Scope each subordinate member/invite/thread/comment lookup through the path board. Nonmembers
receive 404 without existence disclosure; known members lacking a role receive 403. Server
sessions supply actor/author IDs and timestamps. Clients cannot forge creator, author, version,
moderation, or security fields. Better Auth user IDs retain their mapped type rather than being
assumed to be UUIDs.

### 2.4 Discussion records, anchors, and limits

Inspect existing `comment_threads`, `comments`, and `api_idempotency` tables/entities first.
Reuse the foundation; add a forward TypeORM migration only for an actual missing constraint,
column, or index. Do not enable schema synchronization, modify applied migrations, or regenerate
auth tables. Required indexes cover thread `(board_id, created_at, id)` and message
`(thread_id, created_at, id)` pagination.

Thread anchors use the strict shared node/edge/point union in `phase6.md` section 7.2. Validate
finite bounded world coordinates and application IDs. For node/edge creation, read a consistent
projection of the last committed graph through the owning service/room ordering and derive
trustworthy fallback context. An edge fallback is the midpoint between accepted endpoint node
centers. Tombstoned/missing targets and cross-board IDs are invalid. Boundaries are not targets.

A local unacknowledged target must commit before a thread can attach to it; preserve and label
the unsent draft. Do not require every graph outbox to be empty for an existing committed target
or point thread. Later anchor deletion leaves the discussion intact with “Original object
deleted” and fallback label/position. Never resurrect a node or remap an existing thread to a
fresh graph ID.

Centralize the limits: 2,000 threads per board, 500 messages per thread, 4,000 characters per
message. Reject blank input and preserve nonblank formatting as plain text. Deleted marker
rows still count. Thread lists sort by `(createdAt, id)` descending; messages sort ascending.
Pagination defaults to 30, maximum 100, with matching stable cursors. Summaries include count
and latest-message author/time/deletion state; a deleted latest message reveals no old body.

### 2.5 Atomic creation, versions, and conflict recovery

Thread creation inserts the thread and first message in one transaction. Reply creation and
cap enforcement are transaction-safe under concurrent requests. A failed transaction leaves no
partial rows or invalidation. Reuse actor/operation/target-scoped UUID `Idempotency-Key` records
with the exact request hash and response/effect in the same transaction for 24 hours. Identical
retries reuse the original result; changed content with the key returns 409. Recheck permissions
before returning a stored result to a user who may have lost access.

Message edit/delete and thread resolve/reopen use `expectedVersion` compare-and-set. Successful
state changes increment the affected version. Stale requests return 409 `VERSION_CONFLICT` and
preserve the newer row. Edits set `editedAt`; deletion replaces the body with a marker and sets
`deletedAt` while preserving author/creation metadata. A marker cannot be edited back into a
live message. Owner moderation never replaces the original author.

The client keeps unsent text on conflicts, fetches current server content, and requires an
explicit review/cancel/retry. No automatic overwrite or Y.Text merging of comment bodies.
Uncertain creates retain their exact submitted payload/key; reconcile before changing the
logical request. After key expiry, inspect visible results before resubmission. Offline
reconnection never sends an unsent comment automatically.

### 2.6 Invitation secrecy and acceptance

Preserve Phase 3's 32-random-byte base64url bearer tokens, SHA-256 token hashes in invitation
records, seven-day expiry, one-time link exposure, and atomic single-use acceptance. Creation
uses its existing idempotency/disclosure policy. Lists expose metadata, not tokens or hashes.
Keep a newly issued URL available only in the creation result for copy/manual sharing; do not
persist it to query/local caches. Reconcile an uncertain result and offer revoke/new creation
when the original link cannot be recovered under the existing contract.

Preview and acceptance require sign-in. Preview reveals only board title, inviter name, offered
role, and expiry. Acceptance is explicit and rechecks expiry/revocation/consumption. Never demote
an existing editor; an editor invite may upgrade a viewer. Owner acceptance is a no-op without
a membership row. The recorded accepting user can retry successfully; another user sees
exhausted. Two different users racing a single-use invite produce one new accepting user.

`/invite/:token` has signed-out, loading, valid, expired/revoked, exhausted, already-member,
accepting/accepted, offline, and session-expired states. Use the safe existing same-app auth
continuation, with no open redirect. Apply `Referrer-Policy: no-referrer` to invite documents;
exclude token-bearing navigation/responses from service-worker caching and all logs/telemetry.
Do not load third-party resources that can receive the token URL. Redact token URLs in evidence.

### 2.7 Commit notification and REST refresh

After a committed discussion mutation, send the existing `invalidate` resource `comments` to
currently authorized board readers. Membership changes invalidate `members` and affected
`metadata`; ordinary metadata changes use `metadata`. Invite mutations refresh owner invite
queries from local mutation/re-fetch and existing resource mapping. Do not add an unsupported
`invites` enum to the protocol. Future `checkpoints` compatibility remains unchanged.

Rollback, denied writes, and duplicate idempotency replay are not new mutations. Invalidation
carries no bodies/tokens and is not an ACK. Membership/archive changes commit first, notify or
disconnect affected sockets before further protected fanout, and use `access.changed` plus
session checks for enforcement. A best-effort hint cannot substitute for server revocation.

Centralize account/board/resource query keys and invalidate all affected thread pages/filters.
The acting client also reconciles its own views without relying on a connected socket. After
authenticated readiness/reconnect, online recovery, and invite acceptance, refetch relational
views even if no event was received. Only a successful fetch establishes current REST data;
graph sequence numbers do not prove comment freshness. Cancel/ignore old-account requests.

### 2.8 Offline, drafts, and local graph preservation

Sharing and discussion mutations require connectivity and current role/archive authority.
Offline cached reads show fetch time and a stale label; never-fetched data is unavailable,
not an invented empty list. Durable read-only discussion caching is optional and account-scoped;
memory-only views do not claim to survive reload. No authenticated API response enters a broad
service-worker cache.

Drafts stay outside Y.Doc/outbox and remain visibly unsent. The minimum implementation may use
memory-only drafts with an explicit reload limitation. If existing/new draft persistence is
retained, bound and namespace it by deployment/account/board/thread or new-anchor identity,
and include it in account-switch/sign-out preservation decisions. Late old-account responses
cannot replace a current draft or populate another account's queries.

Before self-leave makes pending graph work inaccessible, reuse Phase 5's preservation/export/
cancel flow, then send the authorized online request. Removal, downgrade, archive, sign-out,
or session failure freezes appropriate writes/reads and preserves exact graph bytes under the
old namespace. Never clear an outbox, transfer it to another account, or claim it reached the
server because a relational mutation succeeded.

### 2.9 Coding, dependencies, and verification policy

**Version 1 verification pause (user direction, October 1, 2026):** Defer all database
checks/tests until the entire Version 1 implementation (M00–M08) is complete. Include
database-backed HTTP/auth/session/socket tests, schema/migration inspections, and aggregates
with database children, including `pnpm phase5:verify --non-browser`. Individual task or
Phase 6 completion does not resume them. Prepare needed tests and fixtures without executing
them; record **UNRUN (deferred by user — until Version 1 implementation is complete)**.
The shared [verification policy](docs/verification-policy.md) governs every task below.

The independent browser pause remains: do not run native browser package tests,
Playwright, served-preview/browser scripts, or aggregate commands that launch them. This
includes `pnpm test`, `pnpm test:browser`, `pnpm phase4:quick`, and full phase verifiers.
Implement owned browser harnesses where needed, but leave execution **UNRUN (deferred by user)**.
Run focused database-free, non-browser format, lint, types, builds, boundaries, static scans,
and API unit/Node checks. These pauses override database/browser execution and completion
instructions below. Tasks and later phases may proceed with OPEN acceptance gates; no
unit/build substitute establishes database or browser acceptance. Final database verification
follows all Version 1 implementation; browser verification still requires user resumption.

Read and follow `apps/web/AGENTS.md` before frontend work and `apps/api/AGENTS.md` before API
work. Use the current Tailwind/shadcn/component system, existing feature boundaries, shared
schemas/envelopes, and nearest tests. Render messages and anchor labels as inert plain text,
provide named keyboard controls/focus/error announcements, and avoid raw HTML or URL preview
fetching. Do not add a new UI kit, router, notification server, graph store, or auth library.
Justify any necessary dependency with an exact compatible pin and lockfile update.

Use synthetic accounts and data. Evidence records commands, counts, build hash, versions,
independent sessions/connections, and actual transaction/UI boundaries. Never commit `.env`,
cookies, OAuth codes, raw invite tokens/hashes, database URLs, message bodies, private graph
payloads, browser profiles, or generated builds. A mock repository or rendered component cannot
prove a PostgreSQL race, server permission, real referrer policy, or cross-client refresh.

## 3. Single-branch execution contract

Before P6-01:

1. Read `plan.md` sections 4.6, 5–8, 11–13, 15–20 and M06; `phase6.md`; this guide; root
   `AGENTS.md`; both application guides; and the Phase 2–5 audits.
2. Inspect the approved branch/base, HEAD/status, manifests, migrations, existing discussion/
   share/invite routes, permission services, query keys, sync events, and account lifecycle.
   Preserve unexplained user changes and record inherited failures before editing.
3. Record Phase 3's historical PASS and Phase 2/4/5's OPEN findings. Review migration source,
   prior recorded configured state, and package boundaries without contacting a database.
   Defer current migration inspection until final Version 1 verification. Distinguish stale
   observations from current checks and binding Phase 6 blockers from unrelated open gates.
4. Ensure planning documents are committed or included in an approved planning commit, then
   create/switch safely to `phase-6-discussion-sharing` under implementation authorization.
5. Run lightweight non-browser baseline checks and record pre-existing failures.

Before each task, verify the previous planned/fix commit is HEAD, inspect unexplained changes,
read dependency evidence and nearest source/tests, and state non-goals. Stay within owned paths
except justified integration files. Choose the existing service or helper before adding a new
one. Do not create separate task prompt files unless the user requests them.

Before each commit:

1. Review the full diff and stage only the task's intended changes, preserving unrelated work.
2. Run focused checks plus formatting, `pnpm lint`, and `pnpm typecheck`; build changed apps.
   Record blocking baseline failures. Keep database checks deferred until all Version 1
   implementation is complete, even if a downstream task changes the same code.
   Do not hide a required failure in a successful aggregate.
3. Rerun affected database-free, non-browser regressions after permission/auth/room-order/
   query-lifecycle/migration/manifest changes. Prepare applicable database/socket/browser
   regressions but do not execute them during their respective pauses.
4. Write `docs/evidence/phase6/P6-xx.md` with exact commands, PASS/FAIL/UNRUN, environment,
   transaction/API/socket results, deferred UI proof, gaps, and next dependency.
5. Commit with the exact planned subject below and report commit/parent hashes. Do not amend
   solely to insert a self-hash into the evidence; the final index maps hashes.

Never reset unknown work, clear a shared database, weaken permission/version tests, fabricate
real sessions, or mark an inherited audit passed without its required proof. P6-12 is audit/
documentation only; functional fixes land before it. An unresolved binding failure prevents
the dependent criterion from passing even when implementation commits continue.

## 4. Branch and commit policy

The planned history is linear:

```text
approved integration baseline with Phase 3/4 and available Phase 5 implementation
  -> P6-01 -> P6-02 -> P6-03 -> P6-04 -> P6-05 -> P6-06
  -> P6-07 -> P6-08 -> P6-09 -> P6-10 -> P6-11
  -> focused fixes, if any -> P6-12
```

One P6 task is one planned commit. An actual schema-gap migration belongs to P6-02; final DTOs
begin in P6-01 and Swagger/route integration accompanies the implementing API task. Evidence
belongs with behavior. A defect found before landing the task is fixed within that task; a
later discovery gets a focused `fix(<scope>): ...` commit before its next dependent task.

Do not rewrite, squash, amend, rebase, or merge intermediate `main` changes without user
direction. Record a changed integration baseline and rerun affected checks. Do not treat the
separate sharing/discussion dependency paths as parallel commit waves; this guide keeps one
reviewable sequential history.

## 5. Canonical repository commands

Preserve existing scripts. Add `phase6:verify` with full, `--non-browser`, and
`--implementation` modes by P6-11. Implementation mode must exclude database/browser children
and report required deferred proof as UNRUN with the full gate OPEN. The other modes retain
their eventual real-boundary coverage and stay deferred when they include paused children.
Those Phase 6 interfaces are planned, not existing commands at guide-writing time. On Windows,
use `pnpm.cmd` when needed and record the exact command actually executed.

| Command                                                | Purpose/status during the browser pause                           |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                       | Reproduce pinned dependencies                                     |
| `pnpm format:check`                                    | Formatting                                                        |
| `pnpm lint` / `pnpm typecheck`                         | Code and strict TypeScript checks                                 |
| `pnpm --filter @archboard/api test`                    | Focused Node API units; select relevant suites as appropriate     |
| `pnpm test:integration`                                | DB tests; UNRUN until all Version 1 implementation is complete    |
| `pnpm --filter @archboard/api test:integration`        | DB tests; UNRUN until all Version 1 implementation is complete    |
| `pnpm auth:schema:check` / `pnpm db:migration:show`    | DB checks; UNRUN until all Version 1 implementation is complete   |
| `pnpm --filter @archboard/web build`                   | Frontend types/production build                                   |
| `pnpm --filter @archboard/api build` / `pnpm build`    | API/workspace builds                                              |
| `pnpm boundary:check`                                  | Package/application ownership rules                               |
| `pnpm phase5:verify --non-browser`                     | Contains DB children; deferred until final Version 1 verification |
| `pnpm phase6:verify --non-browser`                     | Future DB aggregate; deferred until final Version 1 verification  |
| `pnpm phase6:verify --implementation`                  | Future database-free, browser-free checks; add in P6-11           |
| `pnpm test` / `pnpm test:browser`                      | Browser-running; **UNRUN (deferred by user)**                     |
| `pnpm --filter @archboard/sync-client test`            | Native browser suite; **UNRUN (deferred by user)**                |
| Full `pnpm phase1:verify` through `pnpm phase6:verify` | Browser-running aggregates; **UNRUN (deferred by user)**          |
| `pnpm phase4:quick` / `pnpm phase4:verify:legacy`      | Browser-running; **UNRUN (deferred by user)**                     |

Choose existing focused Node contract/state checks after inspecting their scripts/configuration;
do not use `pnpm test` as a shortcut. Non-browser verifiers must never start browser/preview
children. The later full verifier must run the owned real-session/DB/socket and independent
served-browser sharing/discussion harnesses, propagate failures, and expose required UNRUN
proofs instead of treating an unwired harness as success.

Prepare focused harnesses for role matrix, invite races/states, anchor deletion, A20 conflicts,
invalidation/reconnect, query isolation, cache/referrer inspection, and keyboard paths. Document
actual names and defer database/browser execution under their respective pauses. At final
Version 1 database verification, use real Better Auth sessions, independent database
connections, and isolated migrated schemas for server proof; use independent authenticated
browser contexts and a served production build when browser verification resumes. Active-worker
and true-offline tests are required for cache/offline assertions. Stop test helpers reliably.

Configured database migration state is separate from a test-schema migration. Apply any forward
migration only to a verified intended target under implementation authorization. This guide
does not itself perform or approve production database changes.

## 6. Commit plan

### P6-01 — Inventory the baseline and define discussion contracts

Commit subject:

```text
feat(contracts): define discussion and anchor contracts
```

Depends on: approved Phase 3/4 integration baseline and committed Phase 6 planning documents.

Read first: `phase6.md` sections 3, 5, 7–9, 14.1; current contracts/limits, migrations/entities,
OpenAPI setup, member/invite services, permission service, and Phase 3–5 audits.

Owned paths: `packages/contracts/**`, focused contract tests, API schema mapping/inventory
documentation, and `docs/evidence/phase6/P6-01.md`.

Required work:

- Inventory actual routes/tables/query keys/events and distinguish implemented, partial, and
  missing behavior. Identify the committed graph reader and existing transaction/permission
  integration point; record binding versus unrelated inherited findings.
- Add/reuse strict anchor union, thread/message DTOs, summaries, mutation/version bodies,
  resolved filter, cursors, common errors, and 4,000/2,000/500 limits. Keep mapped auth user IDs.
- Reject unknown/forged actor/time fields, blank/oversized bodies, malformed UUIDs/coordinates,
  and invalid version/page/filter forms. Define character counting once; preserve formatting.
- Record whether the current relational schema/indexes satisfy the phase. Specify only an
  actual forward migration gap for P6-02; do not duplicate foundation tables.
- Keep existing member/invite and WS envelope contracts unchanged; map the planned API DTOs
  to Swagger without claiming routes are implemented before their owning task.

Non-goals: no comment service mutations, sharing UI, invite redesign, applied migration, or
new notification protocol.

Checks during pause: focused non-browser contract negatives, formatting, lint, types,
`pnpm boundary:check`, migration source review, and changed-package build if applicable.
Auth/schema/configured migration checks remain UNRUN until all Version 1 implementation.

Completion evidence: a baseline/service map and shared schemas cover Phase 6 with malformed-
input proof and a concrete migration decision. Historical audit findings retain their status.

### P6-02 — Persist anchored threads and replies transactionally

Commit subject:

```text
feat(api): persist anchored discussion threads
```

Depends on: P6-01.

Read first: `phase6.md` sections 5, 7, 8.3, 9, 14.1; existing TypeORM transactions, idempotency,
board locks, committed graph reader/room ordering, permission services, and integration helpers.

Owned paths: API comments module/entities/repositories/controllers, minimal committed-state
reader integration, a forward migration only if needed, OpenAPI, focused Node/real DB tests,
and P6-02 evidence.

Required work:

- Implement thread/message GET pagination and thread/reply POSTs with board-scoped permission
  checks and shared DTOs. Return summaries/counts/latest marker state with documented ordering.
- Insert a thread and its first message atomically. Serialize cap checks to enforce 2,000
  threads/board and 500 messages/thread under concurrent creates; rollback leaves no partial rows.
- Derive node/edge fallback labels/positions from consistent committed graph state. Reject
  pending-only, tombstoned, missing-endpoint, and cross-board targets; validate point bounds.
- Keep anchor records after subsequent graph deletion. Do not write relational discussion
  into Y.Doc or create a second graph store to resolve anchors.
- Use the existing transactional 24-hour keyed request/effect/response mechanism. Test exact
  retries, changed-body/key conflict, independent actors/targets, and lost-response replay.
- Reuse existing tables/indexes or add the actual P6-01 forward migration; register exact
  routes/Swagger and test against isolated migrated PostgreSQL schemas.

Non-goals: no edit/delete/resolve UI, message version lifecycle beyond creation, browser flows,
or notification fanout before P6-04.

Checks during pause: focused database-free API units, API build, formatting, lint, types,
and boundaries. Prepare real DB creation/rollback/cap/idempotency/anchor races, pagination,
cross-board, and migration checks; execution remains UNRUN until all Version 1 implementation.

Completion evidence: stored rows, counts, request keys, and trustworthy fallback context prove
atomic bounded creation and denial. Record actual transaction ordering; no mock DB substitutes.

### P6-03 — Add versioned editing, moderation, and resolution

Commit subject:

```text
feat(api): version comment moderation and resolution
```

Depends on: P6-02.

Read first: `phase6.md` sections 8–9, 12, 14; centralized permission policy, message/thread
entities, current version helpers, and real session/database test setup.

Owned paths: API comments mutation/permission integration, controllers/shared schema refinements
only where justified, Swagger, focused Node/DB tests, and P6-03 evidence.

Required work:

- Implement message PATCH/DELETE and thread resolved PATCH using resource-specific
  `expectedVersion` compare-and-set. Increment only the successfully changed resource version.
- Enforce own-message editor actions, owner moderation, viewer denial including former authors,
  removed-user denial, and archived-board write blocking through raw requests.
- Set server `editedAt`/`deletedAt` and resolution metadata. Deletion retains a marker row,
  author/creation context, caps, and timestamp integrity; prevent deleted-body resurrection.
- Prove A20 from stored body/version/metadata, not just a 409. Exercise edit/edit, edit/delete,
  and resolve/reopen races with independent requests/connections.
- Reject forged authorship/time/creation-version fields and cross-board IDs. Preserve safe
  error envelopes and document DELETE version bodies/statuses in Swagger.

Non-goals: no full previous-body history, hard deletion, extra commenter role, message CRDT,
or owner identity replacement.

Checks during pause: database-free API units, API build, formatting, lint, types, and boundaries.
Real DB A20/role/version-race and auth/session regressions remain UNRUN until all Version 1
implementation. Rendered conflict/moderation proof remains deferred under the browser pause.

Completion evidence: newer content survives stale writes, deletion remains a marker, and every
role/archive/ownership case is enforced independently of hidden UI actions.

### P6-04 — Refresh REST resources after committed changes

Commit subject:

```text
feat(collaboration): invalidate committed REST resources
```

Depends on: P6-02 and P6-03.

Read first: `phase6.md` sections 5, 11, 14.3; room queue/fanout, transaction completion,
`invalidate`/`access.changed`, sync-client event consumption, and existing query integration.

Owned paths: API post-commit notification/room integration, sync-client event/lifecycle surfaces
without React dependencies, web scoped query invalidation adapter, real socket/DB and focused
Node tests, and P6-04 evidence.

Required work:

- Publish `comments` invalidation only after real commits; map member/metadata changes to
  existing resources. Do not publish a new mutation on rollback, denial, or exact replay.
- Refresh local actor queries and affected summaries/message pages/filters. Establish scoped
  query key/event hooks consumed by later sharing/discussion UI.
- Keep invite updates within the existing resource mapping plus local query refresh; do not
  expand the WS enum for a convenience `invites` event.
- Reuse board write serialization and access notifications: commit membership/archive first,
  notify/disconnect affected sockets before protected fanout, and reevaluate sessions.
- Define authenticated-ready/reconnect refresh of relational views after missed hints. Neither
  a hint nor a graph sequence establishes current comments; successful REST fetch does.
- Verify no graph document, `latestSeq`, ACK, pending count, or outbox changes due to REST hints.

Non-goals: no durable notification log, standalone event server, presenter/checkpoint UI, or
invalidation used as the authorization mechanism.

Checks during pause: database-free Node event/query-key tests, API units, API/web builds,
formatting, lint, types, and boundaries. Prepare real socket/session/DB commit/rollback/revocation
checks; execution remains UNRUN until all Version 1 implementation. Independent-reader
rendered refresh and offline browser reconnect are **UNRUN (deferred by user)**.

Completion evidence: authorized connections receive only post-commit hints and access changes
stop unauthorized fanout. Separate emitted-frame/REST proof from deferred reader-UI proof.

### P6-05 — Build the share dialog and member controls

Commit subject:

```text
feat(web): add board sharing and member controls
```

Depends on: P6-01 and P6-04; P6-02/P6-03 precede it in this linear guide.

Read first: `phase6.md` sections 6.1, 8.1, 10–11; editor shell, existing board/member queries,
dialogs, role selectors, account recovery, and frontend instructions.

Owned paths: web sharing feature/editor top-bar integration, existing member query/mutation
hooks, preservation-flow composition, focused non-browser state checks, prepared UI harnesses,
and P6-05 evidence. API changes are limited to a proven existing-contract defect.

Required work:

- Add a named share dialog with owner/member list, role labels, loading/error/retry/pending
  states, focus trapping, return focus, keyboard controls, and status announcements.
- All authorized readers can inspect members. Only the owner manages nonowner roles/removal;
  nonowners can leave themselves. Keep owner actions immutable and refresh current authority.
- Disable management writes offline/archived with a clear reason. Re-fetch members/metadata
  after committed operations rather than treating submitted input as new permission authority.
- Explain removal/leave consequences. Before self-leave with pending graph bytes, reuse the
  preservation/export/cancel flow; cancel sends nothing, export failure keeps data.
- Respect real `access.changed`, session/removal failures, and account scope. Do not clear a
  graph namespace or outbox as a side effect of closing the board.

Non-goals: no invite creation/list/copy, owner transfer, email sharing, comment panel, or
redesign of existing permission services.

Checks during pause: database-free member/owner/self-leave API units, focused Node state checks
where meaningful, web build, formatting, lint, types. Real API/DB regressions remain UNRUN
until all Version 1 implementation. Prepare rendered keyboard/role/pending-work
cases and mark them **UNRUN (deferred by user)**.

Completion evidence: raw API authority and implemented controls agree; later served-browser
proof covers focus, role actions, and preservation. A build alone does not satisfy that UI gate.

### P6-06 — Add owner invitation management

Commit subject:

```text
feat(web): add board invitation management
```

Depends on: P6-05.

Read first: `phase6.md` sections 6.2, 9, 12, 14.3; existing invitation creation/idempotency/
redaction service, safe list DTOs, query hooks, and share dialog.

Owned paths: web share/invite creation/copy/list/revoke controls and hooks, minimal corrections
to existing invite contracts/services if evidenced, focused API tests/prepared UI harnesses,
and P6-06 evidence.

Required work:

- Offer owner-only editor/viewer invite creation with the existing `Idempotency-Key` policy,
  then show the fresh result URL with explicit copy and manual-sharing controls.
- List paginated safe metadata and expiry/revoked/consumed state, without reconstructing a
  previous bearer URL or exposing token hashes. Revoke uses honest pending/error/success states.
- Keep raw links out of durable query/local caches, logs, telemetry, graph state, and evidence.
  Clipboard failure preserves the current fresh result for manual copy.
- Reconcile uncertain creation under the existing one-time-disclosure design. If unrecoverable,
  offer metadata review and revoke/new creation instead of silent duplicate issuance.
- Disable mutations for nonowners/offline/archive; reconcile owner queries after success without
  an unsupported protocol resource. Preserve existing sign-in/permission/expiry policy.

Non-goals: no email service, public anonymous access, token re-display from lists, acceptance
route, or redesign of Phase 3 token storage.

Checks during pause: database-free invite API units, focused Node state checks, web build,
formatting, lint, types. Real API invite retry/redaction/revoke/role/archive cases remain UNRUN
until all Version 1 implementation. Copy/list/revoke rendered flows and actual
browser cache/log inspection are **UNRUN (deferred by user)**.

Completion evidence: API and source/build checks preserve token secrecy; later UI proof covers
one-time display, clipboard failure, expiry/consumption states, and owner-only management.

### P6-07 — Finish authenticated invitation review and acceptance

Commit subject:

```text
feat(web): add authenticated invitation acceptance
```

Depends on: P6-06.

Read first: `phase6.md` sections 6.3, 9, 12, 14.2–14.3; auth continuation/session flow,
existing preview/accept services, invite route registration, hosting headers, and SW exclusions.

Owned paths: web invite route/auth integration/query hooks, targeted hosting/referrer/cache
configuration, existing invite-service regressions/fixes if necessary, API race tests,
prepared independent-context browser harnesses, and P6-07 evidence.

Required work:

- Add all signed-out, preview, valid, expired/revoked, exhausted, already-member, accepting/
  accepted, offline/unavailable, and session-expired states. Do not expose board metadata before
  sign-in or auto-accept on page load.
- Preview only the allowed metadata; explicit acceptance navigates to returned board ID and
  refetches effective role/list state. Distinguish network failure from a definitive token error.
- Retain safe same-app OAuth continuation and apply no-referrer to invite documents. Exclude
  bearer paths/responses from SW caching and redact access/error/continuation diagnostics.
- Prove A19 with two different authenticated users and independent DB connections; add/reuse
  cases for expiry/revoke after preview, repeated recorded-user success, different-user
  exhaustion, no demotion, viewer upgrade, and owner no-op with no membership row.
- Prepare two-context route/session flows, direct-route production refresh, and actual referrer/
  Cache Storage inspection; do not execute them during the pause.

Non-goals: no anonymous preview, open redirect, email notification, persistent raw-token cache,
or alternative invite-consumption rules.

Checks during pause: database-free units/Node checks, header/cache-policy source/build
inspection, web/API builds as changed, format, lint, types. Real API/DB A19, token/member-state,
and auth/session regressions remain UNRUN until all Version 1 implementation.
Rendered invite route/redirect/referrer/cache proof is **UNRUN (deferred by user)**.

Completion evidence: one atomic accepting user and safe repeat/upgrade/no-op rules are stored
correctly; UI/referrer proof remains separately required after browser verification resumes.

### P6-08 — Add the discussion panel and graph anchors

Commit subject:

```text
feat(web): add anchored board discussion
```

Depends on: P6-03 and P6-04; P6-05–P6-07 precede it in this linear guide.

Read first: `phase6.md` sections 7, 9–11; editor selection/viewport/inspector, discussion DTOs,
query invalidation adapter, world-coordinate helpers, and component instructions.

Owned paths: web discussion feature, focused editor anchor/inspector composition, scoped query
hooks, non-browser mapping/state checks, prepared UI harnesses, and P6-08 evidence.

Required work:

- Add one primary discussion inspector tab with unresolved/resolved filtering, paginated
  summaries/messages, loading/empty/unavailable/error/retry states, authors/times, and markers.
- Start threads from selected nodes/edges and a chosen world point with keyboard alternatives.
  No boundary anchors; marker controls must not interfere with dragging, connecting, or typing.
- Compose create/reply forms with shared limits, clear sending/unsent states, and one logical
  keyed payload per creation. Wait for committed response before showing a message as sent.
- Show a pending-target explanation for locally uncommitted nodes/edges without blocking valid
  point or committed-target comments solely because unrelated graph edits are pending.
- Preserve deleted-anchor discussion with fallback context. Focus an available anchor only in
  the local viewport/selection; do not move collaborators or modify graph history.
- Consume P6-04 invalidation to reconcile list/detail/filter pages and give viewers read-only
  discussion. Reuse account keys and initial offline/archive guards rather than postponing them.

Non-goals: no moderation/conflict review flows beyond basic failure preservation, presentation
tab, rich HTML/Markdown, uploads, thread deletion, or durable offline mutation queue.

Checks during pause: database-free shared mapping/state and API unit checks where useful,
web build, formatting, lint, types, boundaries. Real API anchor/pagination regressions remain
UNRUN until all Version 1 implementation. All rendered anchor kinds, deleted-
anchor navigation, viewer reads, keyboard actions, and live reader refresh are deferred.

Completion evidence: the panel projects server-owned discussion and local anchor context;
independent served-reader and keyboard proof remain **UNRUN (deferred by user)** during the pause.

### P6-09 — Preserve drafts and expose conflict/moderation actions

Commit subject:

```text
feat(web): handle discussion conflicts and moderation
```

Depends on: P6-08.

Read first: `phase6.md` sections 8, 10, 12, 14.2; version mutation DTOs, draft/form state,
existing confirmations, server marker behavior, and P6-03 evidence.

Owned paths: web discussion message/resolve forms, draft/uncertain-request state, focused
non-browser state tests, prepared A20/moderation UI harnesses, and P6-09 evidence.

Required work:

- Add own-message editor and owner moderation actions plus resolve/reopen, using the current
  resource version. Viewers/former-author viewers never receive write authority from authorship.
- Show edited/deleted/resolved state; explain deletion leaves a marker. Owner moderation keeps
  original authorship and does not offer a deleted-marker resurrection action.
- On 409 retain unsent text, fetch current content, and require explicit review/cancel/retry.
  Do not auto-merge bodies, retry with a silently replaced version, or show failed resolution.
- Retain exact payload/key on uncertain create and reconcile before edited/new-key submission.
  After expiry inspect visible results before deliberate resubmission. Prevent duplicate clicks.
- Keep memory drafts clearly unsent with reload limits; if persistent drafts are used, bound
  and namespace them and wire their preservation into P6-10. Never attach them to graph outbox.
- Retain drafts on recoverable network/server failures while respecting revoked-account privacy.
  Prepare rendered A20 and own/other/owner/viewer edit/delete/resolve matrix checks.

Non-goals: no previous-body history, automatic conflict overwrite, offline sends, reactions,
or cross-account draft transfer.

Checks during pause: database-free Node draft/conflict/uncertainty state tests, API units,
web build, formatting, lint, types. Real API A20/role regressions remain UNRUN until all
Version 1 implementation. Rendered conflict/moderation and
retry flows are **UNRUN (deferred by user)**.

Completion evidence: non-browser state/DB proof demonstrates safe transitions; later UI proof
shows the newer content survives and unsent user text stays available for explicit recovery.

### P6-10 — Integrate account, offline, and access-change lifecycle

Commit subject:

```text
feat(web): isolate sharing and discussion lifecycle
```

Depends on: P6-05, P6-07, and P6-09.

Read first: `phase6.md` sections 5, 10–12, 14.3–14.4; Phase 5 sign-out/account/recovery,
query cancellation, access/session events, cached-role state, and prior P6 UI evidence.

Owned paths: web account/board query lifecycle and draft cleanup/preservation composition,
share/discussion offline/archive states, minimal existing sync/auth integration corrections,
focused Node/API tests/prepared browser harnesses, and P6-10 evidence.

Required work:

- Cancel/ignore stale account/board requests, clear protected active query state on sign-out/
  removal, and prevent late read/mutation results from populating a new scope or replacing drafts.
- Re-fetch relevant REST views after authenticated ready/reconnect, online recovery/focus, and
  acceptance. Missed hints do not leave a forever-stale panel; failed fetches stay explicitly stale.
- Disable all Phase 6 writes offline/archived/current-viewer as appropriate. Cached reads show
  fetch time; uncached data shows unavailable. Do not add blanket API caching or offline sends.
- Apply 401/403/404/session/access changes truthfully. Stop protected reads and unauthorized
  fanout/uploads without describing retained downloaded recovery content as current access.
- Verify self-leave/removal/downgrade preserves pending graph bytes and cancellation/export
  behavior. Account switching isolates graph/query/draft state and leaves `/demo` independent.
- Reuse Phase 5 pending sign-out intent and preservation decisions. Do not silently let a valid
  cookie reactivate the supposedly signed-out user through a sharing query or invite continuation.

Non-goals: no second account store, new sign-out protocol, mandatory durable offline comment
cache, graph outbox reset, or automatic draft resubmission.

Checks during pause: database-free Node lifecycle/query-scope tests and API units,
web/API builds as changed, format, lint, types, boundaries. Real session/access/archive/API
regressions remain UNRUN until all Version 1 implementation. Combined
A10/A24/A25 browser flows, cross-tab and true-offline/cache proof are deferred.

Completion evidence: late responses and role/lifecycle events cannot cross accounts or discard
graph work. Browser/account/offline proof remains separately **UNRUN (deferred by user)**.

### P6-11 — Verify integrated sharing and discussion boundaries

Commit subject:

```text
test(phase6): verify sharing and discussion gates
```

Depends on: P6-04 through P6-10, with P6-01–P6-03 evidence included.

Read first: `phase6.md` sections 12–17; all P6 evidence, inherited audits, root verification
scripts, real DB/socket helpers, production preview configuration, and header/cache policy.

Owned paths: focused server/concurrency/security and prepared browser harnesses,
`scripts/phase6-verify.mjs` or the established equivalent, root script registration, run docs,
small direct fixes found before landing, and P6-11 evidence.

Required work:

- Assemble A11/A19/A20 by real session/HTTP/socket/DB and later UI boundary. Reuse existing
  cases without duplicating shared setup/checks, but add actual discussion/member/invite negatives.
- Cover rollback/caps/idempotency/version races, trusted/deleted anchors, current-role
  moderation, post-commit invalidation, reconnect after missed events, and cross-board scoping.
- Prepare independent authenticated browser sharing/discussion harnesses, keyboard/spot screen-
  reader checks, token/referrer/cache inspection, and relevant A10/A24/A25/A27 regressions.
  Do not execute browser children while the pause applies.
- Add full, `--non-browser`, and `--implementation` modes. Implementation mode runs only
  database-free Node/static/build/API-unit children and reports paused DB/socket/schema/browser
  requirements as UNRUN with an OPEN full gate. Non-browser mode retains real DB/socket
  coverage for final Version 1 verification; full mode also includes wired browser proof
  after browser resumption. Required missing proof cannot yield full PASS; failures propagate.
- Review inherited findings at their owner layer. Resolve binding defects with focused proof;
  list unrelated Phase 2/4/5 OPEN findings without claiming they were remeasured or closed.
- Scan evidence/public bundles/safe logs for secrets. Mark actual browser cache/log/referrer
  inspection deferred when it has not occurred; source policy is not runtime proof.

Non-goals: no Phase 7/8 features, global performance-budget revision, deployment, mock-backed
gate substitution, or hiding unrun browser acceptance behind aggregate success.

Checks during pause: frozen install and `pnpm phase6:verify --implementation` once added,
relevant database-free Node/unit regressions and builds. Non-browser DB mode, all database
checks, and full/browser modes remain UNRUN under their respective pauses. Record actual
child counts/durations and failed baseline checks; do not execute new integration harnesses.

Completion evidence: each matrix row identifies the exact boundary proved, missing, or failing;
non-browser success is reported separately while the full Phase 6 gate stays OPEN.

### P6-12 — Audit and hand off Phase 6

Commit subject:

```text
docs(phase6): record discussion and sharing exit status
```

Depends on: P6-01 through P6-11 and every focused Phase 6 fix.

Read first: `phase6.md` sections 16–18; all P6 evidence and branch history; Phase 2–5 audits;
README, manifests/lockfile, Swagger, verifier modes, and configured migration state.

Owned paths: `docs/phase-6-discussion-sharing.md`, `docs/evidence/phase6/README.md`, P6-12
evidence, truthful evidence metadata corrections, README run/status guidance, and approved
documentation amendments only.

Required work:

- Record base/planned/fix hashes, owned API/schema/dependency changes, environment versions,
  builds, exact commands/counts/timings, and verification mode. Separate configured migration
  results from isolated migrated test-schema results.
- Link every deliverable/exit criterion to contract/build, real DB/session/socket, later
  browser/UI, cache/referrer, security/accessibility proof, or an explicit blocker.
- Report A11/A19/A20 independently; distinguish partial API/socket PASS from missing rendered
  reader refresh, conflict review, invitation route, and account/offline/keyboard proof.
- State Phase 3's recorded baseline and Phase 2/4/5 audit statuses, linking targeted follow-ups
  without relabeling unrelated failures or historical measurements.
- Verify API documentation and setup/run guidance agree with actual routes/script names.
  Include uncertainty/retry, draft reload limits, local preservation, and secret-handling guidance.
- Mark full Phase 6 PASS only when all required and binding prerequisite proofs pass. During the
  pauses use OPEN with database/socket/schema and browser UNRUN requirements under their
  respective deferrals and reproducible final-verification steps.
- Hand off to Phase 7 with discussion/access records outside Y.Doc and excluded from graph
  export/import/copy/templates/checkpoint restore. Do not claim Phase 7/8 or release readiness.

Non-goals: no functional changes, migrations, dependency upgrades, test weakening, merge,
remote push, or deployment. Functional fixes land before this audit commit.

Checks during pause: validate links/history/status and focused documentation formatting.
Reference P6-11's exact-tree checks; rerun the implementation aggregate only if code/config
changes or unresolved results justify it. Record `git status --short`. Database/socket/schema
and full/browser verifiers remain UNRUN under their respective pauses; do not rerun unrelated
suites for documentation-only edits. Phase 7/8 implementation may proceed with the gate OPEN.

Completion evidence: audit/index/history agree, expose current blockers, and separate completed
implementation/non-browser work from unrun integrated acceptance.

## 7. Sequential execution order

| Order | Commit | Why it is next                                                             |
| ----- | ------ | -------------------------------------------------------------------------- |
| 1     | P6-01  | Inventories foundations and establishes strict shared discussion contracts |
| 2     | P6-02  | Persists bounded, idempotent creation with committed anchor context        |
| 3     | P6-03  | Adds current-role moderation and atomic version conflicts                  |
| 4     | P6-04  | Publishes post-commit hints and defines scoped relational refresh          |
| 5     | P6-05  | Exposes owner/member authority with preservation-aware sharing controls    |
| 6     | P6-06  | Adds owner invitation creation, copy, safe lists, and revocation           |
| 7     | P6-07  | Completes authenticated recipient review and atomic acceptance             |
| 8     | P6-08  | Renders anchored discussion over the completed API/event foundation        |
| 9     | P6-09  | Adds moderation actions and draft/conflict/uncertain-request recovery      |
| 10    | P6-10  | Verifies account, offline, reconnect, and access lifecycle integration     |
| 11    | P6-11  | Consolidates real-boundary tests and full/non-browser verifier modes       |
| 12    | P6-12  | Audits current evidence and reports PASS or OPEN with the Phase 7 handoff  |

There are no parallel commit waves. `phase6.md` records feature dependencies; this guide chooses
a linear execution order compatible with them. After a focused fix, rerun the targeted and
downstream non-browser checks that observe its contract and mark affected browser checks UNRUN
during the pause. A task can land implementation while its browser acceptance remains open;
the evidence must distinguish the two.

## 8. Required evidence format

Each planned commit adds `docs/evidence/phase6/P6-xx.md`:

```text
# P6-xx — <title>

Planned commit subject: <exact subject from this guide>
Commit: <mapped in final evidence index; do not amend solely for self-hash>
Parent: <actual parent hash before implementation>
Branch: phase-6-discussion-sharing
Environment: <OS, Node.js, pnpm, PostgreSQL, browser/build hash or UNRUN>

## Behavior proved
<observable behavior; implementation versus acceptance status>

## Contracts used
<role, anchors, versions, idempotency, tokens, REST envelopes, invalidation, offline rules>

## Changed scope
<owned modules and justified integration files>

## Schema and API impact
<tables/routes reused, forward migration/index/Swagger changes, or none>

## Commands and results
- `<exact command>` — PASS/FAIL/UNRUN, duration, counts, fixture size, verifier mode

## Database, session, and socket evidence
<real transaction/race/stored-state/version/event/denial; independent actors/connections>

## Browser and UI evidence
<served build, redacted URL, independent contexts, role/action/result; or deferred by user>

## Security and account evidence
<board scoping, token/referrer/cache checks, actor validation, late-response/account isolation>

## Draft and graph preservation evidence
<unsent/conflict/offline/retry result; exact pending graph work preserved or not applicable>

## Known gaps and inherited gates
<missing Phase 6 proof, current Phase 2/3/4/5 audit statuses, binding versus unrelated findings>

## Next commit unlocked
<next sequential P6 task or full-gate blocker>
```

The final `docs/evidence/phase6/README.md` maps tasks and focused fixes to hashes. Use synthetic
users/content and sanitized observations; do not include raw cookies, auth secrets, OAuth codes,
invitation tokens/hashes/URLs, database URLs, message bodies, private graph data, profiles, or
full environment dumps. Record state/row counts and safe identifiers instead of secret values.
Screenshots may corroborate UX but cannot replace server transaction or cross-client proof.

## 9. Fix commit policy

If a defect is found after its planned commit, add a focused fix on the same branch before the
next dependent task:

```text
fix(<scope>): <specific violated invariant>
```

Record the introducing/exposing commit, failing observation, smallest correction, targeted and
downstream checks, and impact on earlier evidence. Examples:

```text
fix(api): scope comment lookup to its board
fix(comments): reject stale deletion versions atomically
fix(collaboration): notify readers only after comment commit
fix(web): ignore discussion responses after account switch
fix(invites): redact token paths from request logs
```

Do not amend/squash completed tasks or weaken assertions to pass a gate. A contract conflict
needs failed evidence and a targeted `plan.md`/`phase6.md` amendment before substitution.
Inherited Phase 3/4/5 defects resolved here need linked follow-up evidence in their owning audit.
New browser proof remains deferred until the user resumes it.

## 10. Phase 6 final gate

The branch is ready to close only when:

- P6-01 through P6-12 and focused fixes form recorded linear history matching the evidence index.
- Frozen install, formatting, lint, strict types, appropriate units/integration/browser tests,
  auth schema, intended migration state, builds, boundaries, and the full Phase 6 verifier pass
  on the recorded tree.
- Real owner/member sharing controls enforce immutable ownership; raw REST/WS and UI agree
  on current owner/editor/viewer permissions, archived-board rules, and cross-board scoping.
- A19 proves one atomic accepting user and correct retry/expiry/revoke/upgrade/no-demotion/
  owner-no-op semantics, with independently authenticated invitation route/session UX.
- Anchors resolve only accepted graph/world state; deleted targets retain readable fallback
  discussion. Creation/idempotency/caps/rollback are proved against real PostgreSQL.
- A20 preserves stored newer content after stale edit/delete/resolve races and the rendered UI
  retains unsent text with explicit review/retry. Authors, timestamps, and markers stay correct.
- Post-commit hints trigger real reader REST refresh, reconnect repairs missed events, access
  changes stop unauthorized fanout, and relational operations never alter graph ACK/sequence.
- Account/sign-out/offline/session/archive/self-leave/removal flows preserve pending graph
  work, isolate queries/drafts, and never automatically send offline comments.
- Invite token redaction, no-referrer/cache exclusion, inert text, role negatives, keyboard/
  focus/announcements, and relevant A10/A24/A25/A27 regressions have actual boundary evidence.
- Binding prerequisite findings are resolved; separate Phase 2/4/5 OPEN audits remain visible
  unless closed under their own gates. No Phase 7/8 or version 1 readiness claim is made.

While either verification pause applies, report **OPEN** and list the database/socket/schema
and browser requirements as UNRUN under their respective deferrals, even if implementation
and fast checks are complete. An emitted socket frame is not a reader
UI re-fetch; an API conflict is not rendered draft recovery; source policy is not runtime
referrer/cache proof. P6-12 reports these limits instead of changing the governing acceptance.

## 11. Agent handoff response

After a planned or focused commit, report:

```text
Task: <P6-xx — title, or focused fix>
Branch: phase-6-discussion-sharing
Hash: <commit hash>
Parent: <parent hash>
Changed: <files/modules>
Proved: <observable behavior and boundary>
Checks: <exact commands with PASS/FAIL/UNRUN; verifier mode>
Schema/API: <reused/changed migration, route, or Swagger scope>
Database/socket: <real transaction, race, version, invalidation, or not applicable>
Browser/UI: <independent sessions, build, role/action; or UNRUN (deferred by user)>
Security/account/drafts: <scoping, token redaction, conflict and graph preservation result>
Evidence: <path>
Risks: <known gaps, inherited statuses, binding blockers>
Next: <next sequential P6 task or exit proof still needed>
```

The response describes committed state. The next contributor verifies the named hash is HEAD
before continuing on the shared branch. Do not infer permission for a remote push, merge,
deployment, or browser-verification resumption from a completed handoff.

## 12. Technical references

- `plan.md` sections 4.6, 5–8, 11–13, 15–20 and M06 — product, discussion, sharing, and gate contracts.
- `phase6.md` — Phase 6 scope, task dependencies, API/role matrix, acceptance, and exit gate.
- `guide4.md` — reference single-branch, commit-by-commit guide format for Phase 5.
- `docs/phase-3-identity-boards.md` — historical identity/member/invite baseline and evidence.
- `docs/phase-4-collaboration.md` — authenticated room/access foundation and OPEN findings.
- `docs/phase-5-offline.md` — offline/account/recovery integration and OPEN evidence.
- `docs/phase-2-editor.md` — independent editor/performance audit.
- Root `AGENTS.md`, `apps/web/AGENTS.md`, and `apps/api/AGENTS.md` — workspace/browser pause
  and application coding instructions.
- Current source, package manifests, and lockfile — actual modules, scripts, and exact pins.

Library documentation referenced by `plan.md` explains available mechanisms. Archboard's
server ownership, invite secrecy, role/version/idempotency rules, commit order, and evidence
gate come from the governing project documents.
