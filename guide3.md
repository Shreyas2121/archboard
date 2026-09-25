# Archboard Phase 4 — Commit-by-Commit Implementation Guide

Version: 1.0<br>
Date: 25 September 2026<br>
Status: Implementation guide<br>
Governing documents: `plan.md` version 1.1 and `phase4.md` version 1.0<br>
Branch policy: one long-lived Phase 4 branch for the entire milestone

## 1. Purpose

This guide turns Phase 4 into small, reviewable commits on one branch. It gives an implementing
agent an order, file ownership, concrete checks, and evidence requirements for the production
collaboration room and synchronized authenticated editor.

Authority order is the user's latest written instruction, `plan.md`, `phase4.md`, then this guide.
Document a conflict rather than quietly changing a graph, protocol, authorization, durability,
or recovery contract. The exact internal filenames may evolve with the repository, but the task
boundaries and observable outcomes must remain.

Phase 3 passed for its scoped identity and board work. The Phase 2 audit remains open on pan
performance and unrun browser/human evidence. Passing a Phase 4 regression script does not close
that separate audit. Do not claim production offline navigation or release readiness in Phase 4.

## 2. Fixed implementation decisions

### 2.1 One branch and one planned commit per task

Use one branch named:

```text
phase-4-durable-collaboration
```

Create it once from the approved Phase 3 integration baseline after `phase4.md` and this guide are
committed or included in an approved planning commit. Record the base hash in P4-01 evidence. P4-01
through P4-13 land in order on the same branch. A contributor may prepare notes early, but later
task code does not land in an earlier commit. If the branch already exists or the working tree
contains user changes, inspect and preserve them; never force-create or reset.

This guide does not authorize a remote push, merge, rebase, deployment, provider account change, or
production database operation. Follow any later explicit user authorization. If several agents
contribute, only one edits or commits to the shared branch at a time; hand off a committed,
reviewable state. No per-task branches, worktrees, or cherry-pick assembly are part of this guide.

### 2.2 One graph and three durability boundaries

```text
React Flow intent -> document-model command -> browser Y.Doc
                                         |
                                         v
                             IndexedDB log + outbox commit
                                         |
                                         v
                              authenticated WS update
                                         |
                                         v
                        isolated validation + PostgreSQL commit
                                         |
                                         v
                              ACK and peer broadcast
```

React Flow renders a projection; it is never another editable graph store. Y.Doc holds the graph,
PostgreSQL holds committed Yjs state and relational access/metadata, and IndexedDB holds the local
log and exact unsent bytes. Local device save, socket send, and server commit are different events.
Only the database commit produces a server receipt. Never relabel a local write or socket send as
“Saved to server.”

Hydration, remote application, and local commands must have separate origins. A received update
cannot create a fresh outbound entry. A full `ready` merges into the local document and preserves
the existing outbox. No JSON projection roundtrip may reset a live document.

### 2.3 Protocol and trust boundary

- Use same-origin `/ws/boards/:boardId` through Nest `WsAdapter`/`@nestjs/platform-ws` with `ws`.
  Keep the Phase 1 native listener only as a compatibility harness.
- Use strict `{ event, data }` JSON unions in `packages/contracts`, protocol/schema version 1,
  canonical base64, stable Yjs V1 updates, and decimal-string server sequences.
- Authenticate a real Better Auth cookie and validate Origin before any graph disclosure. Require
  `hello` within five seconds. The actor and presence identity come from the session, not a frame.
- `ready` contains complete committed state at sequence S. Registration and buffering prevent a
  gap between capturing S and sending later updates.
- One in-flight client update per connection. Preserve `updateId` and exact bytes across retries.
  A matching actor/hash receipt returns the original sequence; a mismatch is `UPDATE_ID_REUSED`.
- Unsupported version, malformed frame, inaccessible board, and oversized data fail safely. A
  nonmember cannot distinguish an inaccessible board from a missing board through graph data.
- Implement Phase 4 messages from `phase4.md` section 6. Presenter and invalidation messages are
  reserved for later phases without changing current message meanings.

### 2.4 Room, permission, and transaction ownership

The server has one registry and one queue per board. The queue serializes room join/reconstruction,
update candidate acceptance, room snapshot work, and lifecycle integration. The board row lock in
PostgreSQL is the ultimate ordering authority for update, archive, and access changes; an
in-process queue alone cannot prove A10/A27.

Use the Phase 3 board permission service for socket reads and graph writes. Check authority before
receipt lookup and repeat it after locking the board row in the write transaction. A viewer,
removed editor, or archived board cannot write even if a connection was opened earlier. REST
archive/membership effects notify or disconnect affected sockets after commit, while a racing
socket update still follows transaction commit order.

Promotion of the Phase 1 durable-update harness into production must preserve: unique
`(boardId, updateId)` receipts, actor and exact-byte hash matching, `latest_seq` allocation,
single-transaction update/receipt/content timestamp, and commit-before-ACK/broadcast. Use
transaction-scoped repositories through one `QueryRunner.manager`, release runners in `finally`,
and retain direct-connection integration proofs.

### 2.5 Validation, limits, and process topology

Never apply an untrusted update to the accepted room first. Apply it to an isolated candidate,
validate the physical Yjs roots and immutable/tombstone invariants against accepted state, require
causal completeness, then validate the graph projection and every stored value, including
tombstoned text. A visible no-op still needs size, causal, and work-budget checks.

Only the existing `assertCausallyComplete` compatibility wrapper may touch version-sensitive Yjs
pending-structure/delete-set fields. Keep pinned-version fixtures for both shapes and fail closed
if an upgrade changes them. Bound validation to two seconds in at most two workers per process with
bounded admission. Central limits are 1 MiB decoded update, 16 MiB frame, 10 MiB encoded board,
500 nodes, 1,000 edges, 50 boundaries, 50 steps, 10 connections/board, and 20 rooms/process.

Exactly one collaboration-capable Nest process runs for version 1. Hold a dedicated PostgreSQL
advisory lock for its lifetime; failure prevents readiness and loss stops writes and terminates
the process. Compact every 200 accepted updates or 60 seconds for a dirty room, retaining receipts
and independent checkpoints. Evict only idle, fully durable rooms after five minutes.

### 2.6 Client local storage and recovery

Reuse the Phase 2 namespace keyed by deployment origin, authenticated user, board, and schema;
`/demo` remains separate. A local command writes its update into `localUpdates` and its exact bytes
and ID into `outbox` in one IndexedDB transaction before transport can send. On ACK, persist the
receipt/sequence and remove or mark that outbox entry atomically. On a crash before local ACK
persistence, resend the same bytes and ID. Remote updates enter the log without entering the
outbox. Local compaction cannot delete unacknowledged entries.

Acquire the Web Lock before enabling writes. A second same-account tab is read-only until lock
transfer. An unavailable Web Locks API retains the documented read-only/export fallback. A local
storage failure pauses editing and offers an in-memory validated export without a reload-safety
claim. Permanent server rejection freezes dependent sends and preserves the local document and
queue. `CAUSAL_GAP` gets one reconnect/full-ready retry, then recovery. “Reload server version”
requires an explicit warning and clears only the exact namespace after user action.

Phase 4 provides this minimal recovery. Phase 5 owns service-worker shell caching, offline direct
routes, account switching, app-version prompts, and the complete sign-out/revocation experience.
Do not claim A06's offline shell portion or A25 in Phase 4.

### 2.7 Frontend composition and phase boundary

Extend the existing routed editor and packages:

```text
packages/contracts/src/protocol/       strict events and limits
packages/sync-client/src/              IndexedDB outbox, WS transport, recovery
apps/api/src/modules/collaboration/    room, gateway, validation, persistence
apps/web/src/features/collaboration/   presence and connection display
apps/web/src/app/routes/              authenticated board route
apps/web/src/features/editor/          existing canvas and commands
```

Use TanStack Query for relational board/session metadata and Zustand for ephemeral editor UI.
Do not put graph copies, outbox data, or permission authority in either. Follow
`apps/web/AGENTS.md` for frontend composition, Tailwind/shadcn reuse, focus, labels, and state
handling, and `apps/api/AGENTS.md` for Nest boundaries, transaction-scoped TypeORM, and safe logs.
Do not add a parallel auth, state, transport, persistence, validation, or UI framework.

Phase 4 excludes the finished share dialog, invitation page, comments, presenter/steps UX,
checkpoints, general import/export, image export, full template flow, backups, and horizontal
scaling. Existing board duplication continues to use committed server content; its UI must not
imply that unsynced local edits were copied.

### 2.8 Migrations, dependencies, and observability

Use existing entities and the pinned package graph. A schema change needs a forward TypeORM
migration with a down path, fresh/upgrade proof, and `synchronize: false`; never rewrite an applied
migration or Better Auth SQL. Add `@nestjs/platform-ws` or another missing selected dependency only
in the first task that uses it, at an exact compatible version with lockfile update. Do not select
an alternate WebSocket server or CRDT provider.

Use focused constants for event names, limits, retry timing, compaction thresholds, and admission.
Report DB write/ACK latency, validation rejects, worker timeouts, reconnects, active rooms/sockets,
snapshot bytes, compaction duration, and access-change rejects through safe structured output.
Never log cookies, auth secrets, raw updates, private board content, token-bearing URLs, or full
connection strings.

## 3. Single-branch execution contract

Before P4-01:

1. Read `plan.md` sections 7–11, 16–19, `phase4.md`, this guide, root `AGENTS.md`, both nested
   application guides, and the Phase 1–3 audits.
2. Inspect branch, HEAD, status, recent history, manifests, migration state, and existing
   contracts, collaboration, sync-client, editor, and route modules.
3. Record the approved Phase 3 base hash and any unresolved Phase 2 audit items. Ensure planning
   documents are committed or in the approved planning commit.
4. Create or switch to `phase-4-durable-collaboration` without overwriting user work. Run
   lightweight baseline checks and record pre-existing failures.
5. Confirm isolated local PostgreSQL configuration is available without printing credentials.

Before each planned commit, confirm the prior planned/fix commit is HEAD, inspect unexplained
working-tree changes, read dependency evidence and relevant existing files, and state that task's
non-goals. While working, keep to owned paths except justified integration files; use real
PostgreSQL for transaction claims, real Better Auth cookies for socket claims, and served-build
independent browsers for product claims.

Before each commit:

1. Review the complete diff and remove unrelated edits.
2. Run the task-specific checks, `pnpm lint`, and `pnpm typecheck`. If a dependency prevents a
   check, record the exact reason and run it at the first possible downstream task.
3. Run broader regressions when contracts, auth mounting, database transactions, editor providers,
   or package manifests change.
4. Write `docs/evidence/phase4/P4-xx.md` with actual PASS/FAIL/UNRUN results, environment, limits,
   and next dependency.
5. Commit with the exact subject below. Report hash and parent without amending solely to place a
   self-hash in evidence.

Never reset or discard unrecognized changes, weaken earlier tests, commit secrets or local browser
profiles, replace required real boundaries with mocks, or mark the milestone passed because its
code compiles. Functional failures found after a planned commit get focused fixes before moving
on. P4-13 is audit/documentation only.

## 4. Branch and commit policy

Planned linear history:

```text
approved Phase 3 baseline
  -> P4-01 -> P4-02 -> P4-03 -> P4-04 -> P4-05
  -> P4-06 -> P4-07 -> P4-08 -> P4-09 -> P4-10
  -> P4-11 -> P4-12 -> focused fixes, if any -> P4-13
```

One P4 task equals one planned commit. A migration, exact dependency pin, script, or generated
artifact belongs in the first task that needs it. Task evidence is committed with the behavior.
Fix defects discovered before a task lands within that task; after it lands, use a focused
`fix(<scope>): ...` commit. Do not squash, amend, rebase, or merge intermediate `main` changes
without user direction. If the baseline changes, record and rerun every affected check.

## 5. Canonical repository commands

Preserve existing scripts. Introduce focused Phase 4 scripts where useful and one aggregate
`phase4:verify` by P4-12. The aggregate must run real checks, propagate failures, and name its
children. Commands below are interfaces to use or add, not claims that every command exists yet.

| Command                                                                     | Purpose                                             |
| --------------------------------------------------------------------------- | --------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                            | Reproduce pinned dependencies                       |
| `pnpm format:check`                                                         | Check formatting                                    |
| `pnpm lint` / `pnpm typecheck`                                              | Check code and strict types                         |
| `pnpm test` / `pnpm test:browser`                                           | Workspace units and browser-backed package tests    |
| `pnpm test:integration`                                                     | Real PostgreSQL/API integration suites              |
| `pnpm auth:schema:check` / `pnpm db:migration:show`                         | Preserve auth and migration state                   |
| `pnpm --filter @archboard/contracts test`                                   | Protocol/limit contracts                            |
| `pnpm --filter @archboard/document-model test`                              | Y.Doc schema and convergence                        |
| `pnpm --filter @archboard/sync-client test`                                 | Native IndexedDB/Web Locks client behavior          |
| `pnpm --filter @archboard/api test`                                         | Room, validator, and gateway units                  |
| `pnpm --filter @archboard/api test:integration`                             | Socket/database/lock/crash integration              |
| `pnpm --filter @archboard/api build` / `pnpm --filter @archboard/web build` | Independent builds                                  |
| `pnpm build` / `pnpm boundary:check`                                        | Workspace build and package boundaries              |
| `pnpm phase1:verify` / `pnpm phase2:verify` / `pnpm phase3:verify`          | Earlier regressions                                 |
| `pnpm phase4:verify`                                                        | Phase 4 aggregate; introduced during this milestone |

Run targeted commands as the task requires. The final gate also records focused crash, socket,
browser, and measurement commands by their actual names. Use isolated schemas, stop preview/server
processes deterministically, and redact environment output.

## 6. Commit plan

### P4-01 — Add collaboration protocol and limit contracts

Commit subject:

```text
feat(contracts): add collaboration protocol schemas
```

Depends on: approved Phase 3 baseline and committed Phase 4 planning documents.

Read first: `phase4.md` sections 5–6, 10–11, 13.1; existing protocol, errors, and limits modules.

Owned paths: `packages/contracts/src/protocol/**`, focused shared errors/limits/exports/tests, and
`docs/evidence/phase4/P4-01.md`.

Required work:

- Define strict C→S and S→C Phase 4 envelopes with version, event, data, and safe error types.
- Define canonical base64 validation, UUID update/tab IDs, decimal-string sequences, fixed handle
  and graph limits only by reference to established shared sources.
- Encode 16 MiB frame, 1 MiB update, 10 MiB state, presence selection/preview, capacity, and rate
  limits as named central constants.
- Reject unknown keys/events, malformed UTF-8/JSON where transport tests cover them, bad base64,
  unsafe numeric sequences, invalid enum values, and oversized fields.
- Reserve future presenter/invalidation events without falsely implementing their behavior.

Non-goals: no Nest gateway, Y.Doc mutation, IndexedDB change, or frontend feature.

Required checks: contract tests/build, `pnpm lint`, `pnpm typecheck`, `pnpm test`.

Completion evidence: one exported schema/type per wire shape; negative boundaries and existing
REST/graph contracts pass; no duplicate values or framework imports enter contracts.

### P4-02 — Add room reconstruction and singleton ownership

Commit subject:

```text
feat(api): add bounded collaboration room registry
```

Depends on: P4-01.

Read first: `phase4.md` sections 5, 7.1, 7.3, 11; snapshot/update entities, Phase 3 committed
graph loader, database readiness, and lock service.

Owned paths: `apps/api/src/modules/collaboration/application/**`, room/loader infrastructure,
focused platform database/readiness wiring, real-DB tests, and P4-02 evidence.

Required work:

- Reconstruct a room from snapshot `through_seq` plus ordered updates through `latest_seq`; check
  continuity, schema, encoded size, and graph validity before room admission.
- Create one per-board queue and bounded registry. Reject excess rooms/connections with safe
  `SERVER_BUSY`/`ROOM_FULL` outcomes.
- Acquire and hold the dedicated PostgreSQL advisory lock before collaboration readiness. A second
  process fails readiness; connection loss stops write admission and terminates the process.
- Keep room initialization single-flight and failed/corrupt rooms unavailable, never partial.
- Expose idle eviction hooks, but defer periodic compaction implementation to P4-07.

Non-goals: no socket join, update acceptance, client transport, or horizontal scaling.

Required checks: focused API unit/integration, migration/auth-schema state, API build, lint, types.

Completion evidence: real-DB restart reconstructs exact graph/sequence; gap/corruption blocks
ready; second process cannot own the singleton lock; capacity is bounded.

### P4-03 — Add authenticated production WebSocket gateway

Commit subject:

```text
feat(api): add authenticated collaboration gateway
```

Depends on: P4-01 and P4-02.

Read first: `phase4.md` sections 6 and 7.1; Phase 1 upgrade service, Better Auth lookup, Nest
bootstrap, board permissions, and transport contracts.

Owned paths: collaboration gateway/WS infrastructure and module wiring, focused bootstrap/config,
socket integration tests, exact dependency/lockfile update if needed, and P4-03 evidence.

Required work:

- Mount the production Nest `WsAdapter`/`@nestjs/platform-ws` gateway at
  `/ws/boards/:boardId`; preserve the existing auth handler order.
- Authenticate real cookies, validate Origin and board read authority, enforce five-second `hello`
  deadline, strict frame parsing, schema/protocol version, and no pre-ready graph disclosure.
- Serialize join under the room queue. Emit complete `ready` at sequence S and buffer later
  committed updates until it has been sent.
- Implement ping/pong liveness and safe close/error mapping without raw exception detail.
- Prove anonymous, expired, forged-origin, nonmember, bad-version, malformed, and capacity cases.

Non-goals: no durable client update, presence, presenter, or app editor route.

Required checks: focused API tests/integration, auth/permission regressions, API build, lint, types.

Completion evidence: a real Better Auth cookie opens an authorized room; denial exposes no graph
bytes; concurrent join/update boundary is gap-free in a deterministic test.

### P4-04 — Validate isolated update candidates

Commit subject:

```text
feat(api): validate collaboration update candidates
```

Depends on: P4-02.

Read first: `phase4.md` sections 5, 7.2, 10–11; document-model schema/validation, Phase 1 worker
pool and `assertCausallyComplete` wrapper.

Owned paths: collaboration validation worker/compatibility modules, focused document-model
validation only if a shared invariant truly belongs there, fixtures/tests, and P4-04 evidence.

Required work:

- Clone accepted state into an isolated candidate and apply only there.
- Enforce roots/types, immutable fields, append-only tombstones, complete prior entity keys,
  bounded text including tombstoned objects, graph projection, geometry, and entity limits.
- Reject pending structures and pending delete sets through the sole compatibility wrapper.
- Bound decoded update and candidate state size, worker time, concurrency, and queue admission.
- Show invalid/timeout candidates leave the accepted room usable for the next valid update.

Non-goals: no database commit, ACK, broadcast, or frontend recovery.

Required checks: document-model and API validator units, pinned Yjs causal fixtures, API build,
lint, types, Phase 1 validation regression.

Completion evidence: A23/A30 malicious fixtures fail before persistence, legitimate later work
succeeds, and valid independent field/text edits pass.

### P4-05 — Commit updates and issue durable receipts

Commit subject:

```text
feat(api): commit validated room updates before ack
```

Depends on: P4-03 and P4-04.

Read first: `phase4.md` sections 7.2, 10, 13.2; Phase 3 permission service, durable-update
harness, transaction helper, and entities.

Owned paths: collaboration acceptance/persistence application and infrastructure, gateway update
handling, real-DB/socket integration tests, and P4-05 evidence.

Required work:

- Enforce current session/role/archive before receipt lookup and candidate validation.
- Hash exact update bytes; return original seq for same board/ID/actor/hash and reject mismatch.
- Under the board-row lock, recheck authority and archive, allocate one sequence, insert update
  and receipt, update `content_updated_at`, and commit atomically.
- Install candidate, ACK sender, and broadcast to peers only after commit; sender normally gets
  ACK rather than a duplicate broadcast.
- Prove rollback, post-commit/pre-ACK crash, duplicate retry, unique receipt, and no peer leak.

Non-goals: no compaction, presence, client outbox, or metadata writes.

Required checks: API durable-update and socket integration, A08/A09/A11, Phase 3 permission
regression, migration state, API build, lint, types.

Completion evidence: database rows, accepted room, ACK, and peer observations agree across both
failure boundaries; a denied viewer write changes none of them.

### P4-06 — Integrate board access and archive changes with rooms

Commit subject:

```text
feat(api): enforce live room access changes
```

Depends on: P4-05.

Read first: `phase4.md` sections 5, 7.1, 10, 13.2; Phase 3 archive, restore, role-change,
removal, and transaction notifications.

Owned paths: focused boards/collaboration integration, `access.changed` handling, permission
integration tests, and P4-06 evidence.

Required work:

- Connect committed archive/restore/member changes to the active room without copying the role
  matrix or holding a database transaction while writing socket frames.
- Update, freeze, or disconnect affected connections after commit. Recheck role/archive in every
  graph-write transaction so missed notifications cannot confer authority.
- Prove both archive/update commit orders and editor-removal/update races with independent
  database connections and deterministic barriers.
- Keep archived boards readable by authorized members while rejecting writes.

Non-goals: no share dialog, invite page, comment invalidation UX, or full offline revocation flow.

Required checks: API board/permission/collaboration integration, A10/A27, API build, lint, types,
Phase 3 regression.

Completion evidence: no post-archive or post-removal unauthorized commit; affected sockets show
correct state; rejected state has no new seq/update/receipt.

### P4-07 — Compact snapshots and evict idle rooms

Commit subject:

```text
feat(api): compact collaboration snapshots safely
```

Depends on: P4-05.

Read first: `phase4.md` sections 7.3, 10–11, 13.2; snapshot/update/receipt schema and P4-02
room loader.

Owned paths: collaboration compaction and registry eviction modules, real-DB failure tests, and
P4-07 evidence.

Required work:

- Compact under the board queue after 200 accepted updates or 60 seconds for a dirty room.
- Atomically advance snapshot bytes/`through_seq` and delete only covered update rows.
- Retain all update receipts for board lifetime and leave checkpoints independent.
- Reconstruct exactly across a process stop before/during/after compaction, then retry a delayed
  duplicate ID to receive its original sequence.
- Evict a room after five idle minutes only with no pending queue work and all accepted writes
  durable. Enforce admission instead of unlimited memory growth.

Non-goals: no JSON reset, receipt expiry, historical time travel, or multi-process fanout.

Required checks: focused API unit/integration, A15 and crash-compaction harness, API build,
lint, types.

Completion evidence: old/new snapshot-log pairs reconstruct identically; delayed ACK works after
update-row deletion; bounded registry is observed.

### P4-08 — Add atomic browser outbox and inbound log

Commit subject:

```text
feat(sync-client): persist collaboration outbox atomically
```

Depends on: P4-01.

Read first: `phase4.md` sections 6.2, 8.1, 10; existing IndexedDB adapter, namespace, local
snapshot/log, Web Lock, and browser tests.

Owned paths: `packages/sync-client/src/persistence/**`, focused client types/exports/tests, and
P4-08 evidence.

Required work:

- Store local update bytes in the log and the exact same bytes/ID/hash in the outbox in one
  IndexedDB transaction, ordered by local sequence.
- Log remote updates without an outbound entry; separate hydration, remote, and local origins.
- Persist ACK receipt/received sequence and remove or mark only the matching entry atomically.
- Preserve pending entries through local compaction, reload, quota/transaction failure, and
  duplicate ACK handling.
- Keep origin/user/board/schema namespace isolation and one-writer Web Lock behavior.

Non-goals: no live socket, React route, service worker, or second `y-indexeddb` writer.

Required checks: sync-client native browser tests, document-model tests, A12/A22 regressions,
sync-client build, lint, types.

Completion evidence: failure before local commit emits nothing and no save claim; crash after
commit leaves exact resumable bytes; remote changes never echo into outbox.

### P4-09 — Add ordered WebSocket synchronization client

Commit subject:

```text
feat(sync-client): synchronize authenticated boards
```

Depends on: P4-03 and P4-08.

Read first: `phase4.md` sections 6.2 and 8; shared WS contracts, local persistence, and web
public-origin configuration.

Owned paths: `packages/sync-client/src/transport/**` and synchronization orchestration modules,
browser-backed tests, focused public WebSocket-origin config if needed, and P4-09 evidence.

Required work:

- Connect with credentials through browser cookie behavior, send `hello`, validate all incoming
  envelopes, merge/persist full `ready`, then drain outbox in local order one ACK at a time.
- Apply broadcasts in seq order; advance sender sequence on ACK; ignore old duplicates and
  reconnect/full-ready on a gap without replacing local pending work.
- Retry same bytes/ID after disconnect with one-to-30-second exponential backoff plus jitter.
- Implement connection/save-state derivation from local commit, handshake, outbox, receipt, and
  recovery state; network `online` is only a retry hint.
- On `CAUSAL_GAP`, reconnect once and retry the same queued entry; repeated failure pauses the
  queue. Other permanent errors freeze dependent sends and preserve bytes.

Non-goals: no UI route, service-worker offline route, presenter, or comment invalidation.

Required checks: sync-client browser tests, protocol contracts, A06/A07/A08 replay fixtures,
sync-client build, lint, types.

Completion evidence: full-ready merge, lost ACK, gap, reconnect, and permanent rejection preserve
data and never produce a false server-save state.

### P4-10 — Open authenticated boards in the live editor

Commit subject:

```text
feat(web): connect authenticated board editor
```

Depends on: P4-06 and P4-09.

Read first: `phase4.md` sections 2, 8, 13.3; `apps/web/AGENTS.md`, board route, auth/query
provider, editor session/canvas, and `/demo`.

Owned paths: `apps/web/src/app/routes/**`, authenticated editor composition, focused
`apps/web/src/features/editor/**` and collaboration status UI, served-browser evidence, and
P4-10 evidence.

Required work:

- Make `/boards/:boardId` use the account-scoped local session plus synchronization client while
  keeping React Flow a projection of one Y.Doc.
- Show loading local, connecting, live, offline cached, viewer, archived, and recovery states.
- Disable graph-writing controls for viewer/archived/read-only second tab; never rely on UI alone
  for authority.
- Show save labels only at the specified local or server boundary; preserve visible pending count
  and connection uncertainty.
- Keep `/demo` entirely local, separately namespaced, and free of collaboration sockets.
- Preserve keyboard focus, accessible status messages, narrow-screen behavior, and existing
  product component/styling conventions.

Non-goals: no finished sharing UI, PWA route caching, templates, or general export controls.

Required checks: web build, sync-client browser tests, board/permission integration, lint, types,
served production-build independent-browser flow.

Completion evidence: owner/editor concurrent edit converges, viewer cannot edit, role/archive
states are truthful, and demo remains local-only.

### P4-11 — Add ephemeral presence and drag previews

Commit subject:

```text
feat(collaboration): add transient presence
```

Depends on: P4-03 and P4-10.

Read first: `phase4.md` sections 6.1, 9, 11; editor selection/drag state, user summary, and
socket liveness.

Owned paths: collaboration gateway presence handling, sync-client presence transport,
`apps/web/src/features/collaboration/**`, focused editor preview integration, tests, and P4-11
evidence.

Required work:

- Accept bounded cursor, 100 selected IDs, and one preview with at most 100 positions. Larger
  selections emit a count; sanitize values before broadcasting.
- Attach session-derived user identity and connection ID; never trust identity in a client frame.
- Rate-limit presence separately to 15/second, expire after 30 seconds, and remove it on
  disconnect/liveness timeout.
- Publish preview during drag and commit durable geometry once at drag end. A mid-drag crash
  reveals the last committed position.
- Keep presence out of Y.Doc, outbox, update/receipt tables, undo, and `content_updated_at`.

Non-goals: no presenter lease, comments, video, or durable cursor history.

Required checks: API/socket presence tests, sync-client browser tests, web build, lint, types,
served-browser expiry/preview observation.

Completion evidence: peers see attributable live presence that expires; seq and durable tables
remain unchanged during transient messages.

### P4-12 — Complete recovery, operations, and verification gate

Commit subject:

```text
test(collaboration): verify recovery and durability gates
```

Depends on: P4-07, P4-09, P4-10, and P4-11.

Read first: `phase4.md` sections 10–16 and all prior P4 evidence; existing recovery download,
API readiness/logging, and root verify scripts.

Owned paths: focused recovery UI/client and operational wiring, Phase 4 fault/measurement
harnesses, root `phase4:verify` script, run/config documentation, and P4-12 evidence.

Required work:

- Freeze editing/outbox on permanent rejection or local storage failure; preserve bytes, offer
  validated local export, and warn before explicit exact-namespace server reload.
- Surface singleton/readiness failure, bounded room/worker/rate admission, safe logs and metrics.
- Prove A02–A05, Phase 4 portions of A06–A11, A15, A23, A27, A30, plus touched A01/A12–A14/A22
  regressions at their required real boundaries.
- Use independent PostgreSQL connections and deterministic failure barriers for transaction
  races; real Better Auth cookies and forged socket negatives; independent served-build browser
  profiles for product behavior.
- Measure five-user, 100 ms RTT p95 durable visibility, typical/limit validation, cached opening,
  and record Phase 2 pan gap separately.
- Add `phase4:verify` that runs format, lint, types, unit/browser tests, real integration,
  migration/auth schema, builds, boundaries, scans, and relevant prior regressions. Propagate
  every failure; list meaningful children and exact results.

Non-goals: no Phase 5 service worker, account-switch completion, Phase 6/7 product features,
deployment, or relaxation of failed budgets.

Required checks: clean frozen install, `pnpm phase4:verify`, all earlier phase verify scripts,
focused crash/socket/browser/measurement commands, API/web/workspace builds.

Completion evidence: full acceptance matrix links to actual database/socket/browser outcomes;
failed or unrun mandatory proof remains an open gate; no secrets or private content appear in
evidence or bundles.

### P4-13 — Audit and hand off Phase 4

Commit subject:

```text
docs(phase4): record collaboration evidence and exit status
```

Depends on: P4-01 through P4-12 and every focused Phase 4 fix.

Read first: `phase4.md` sections 15–17, all P4 evidence, current audits, README, manifests,
migrations, lockfile, scripts, and branch history.

Owned paths: `docs/phase-4-collaboration.md`, `docs/evidence/phase4/README.md`, evidence metadata
corrections, README status/commands, and approved documentation amendments only.

Required work:

- Record base, linear planned/fix history, dependency/migration changes, runtime/browser/database
  matrix, commands, counts, timings, limits, and PASS/FAIL/UNRUN.
- Link every deliverable and exit criterion to exact unit, real database, socket, served-browser,
  failure, security, or measurement evidence.
- Check no raw cookies, credentials, tokens, update content, private data, or database URLs entered
  logs/evidence/bundles.
- Distinguish Phase 4 synchronized editing from Phase 5 offline shell, Phase 6 sharing/discussion,
  Phase 7 presentation/portability, Phase 8 release, and the still-open Phase 2 audit.
- Mark PASS only if every mandatory proof and budget is satisfied; otherwise mark OPEN with
  reproducible blockers and next work.

Non-goals: no functional code, test weakening, dependency upgrade, remote push, merge, or release
claim. Functional fixes land before this audit commit.

Required checks: frozen install, `pnpm phase4:verify`, earlier regression gates,
`pnpm auth:schema:check`, `pnpm db:migration:show`, builds, and `git status --short`.

Completion evidence: final audit and evidence index agree with repository history, results, and
open gaps; no required check is presented as passed solely through a mock or stale run.

## 7. Sequential execution order

| Order | Commit | Dependency reason                                              |
| ----- | ------ | -------------------------------------------------------------- |
| 1     | P4-01  | One protocol/limit source for server and client                |
| 2     | P4-02  | Accepted room loading and singleton before transport admission |
| 3     | P4-03  | Real authenticated join and ready ordering                     |
| 4     | P4-04  | Isolated validation before update persistence                  |
| 5     | P4-05  | Durable commit, receipt, ACK, and peer broadcast               |
| 6     | P4-06  | Access/archive transitions on the working room path            |
| 7     | P4-07  | Safe compaction of accepted writes                             |
| 8     | P4-08  | Atomic browser outbox on established wire contracts            |
| 9     | P4-09  | Reconnect/drain client on local persistence and gateway        |
| 10    | P4-10  | Product editor on the stable server/client boundary            |
| 11    | P4-11  | Ephemeral presence through the live product path               |
| 12    | P4-12  | End-to-end failure, performance, and aggregate gates           |
| 13    | P4-13  | Audit already-verified work and report pass or open            |

There are no parallel commit waves. Dependencies in `phase4.md` allow independent modules to be
prepared, but this guide keeps one linear history. A focused fix is inserted when found and its
downstream checks are rerun.

## 8. Required evidence format

Every planned commit adds `docs/evidence/phase4/P4-xx.md`:

```text
# P4-xx — <title>

Planned commit subject: <exact subject from this guide>
Commit: <filled in the final evidence index; do not amend solely for self-hash>
Parent: <actual parent hash before implementation>
Branch: phase-4-durable-collaboration
Environment: <OS, Node.js, pnpm, PostgreSQL, browser/build/network when relevant>

## Behavior proved
<observable result>

## Contracts used
<events, roles, sequences, locks, limits, persistence and recovery invariants>

## Changed scope
<owned paths and justified integration files>

## Commands and results
- `<exact command>` — PASS/FAIL/UNRUN, duration, counts, fixture size

## Database and socket evidence
<real cookie/Origin, connections, transaction/barrier, crash, ACK/broadcast, or not applicable>

## Browser evidence
<independent profiles, served build, origin, actions, result, or not applicable>

## Security and recovery evidence
<denial, non-disclosure, preserved bytes/export, log redaction, or not applicable>

## Performance evidence
<hardware, browser, RTT, samples, p95, worker/room limits, or not applicable>

## Known gaps
<remaining issue, consequence, owner, or none>

## Next commit unlocked
<P4 ID or phase exit>
```

The final `docs/evidence/phase4/README.md` maps planned IDs and focused fixes to hashes. Use
synthetic boards/users. Never include cookies, OAuth codes, secrets, invitation URLs or hashes,
database URLs, raw update bytes containing private content, private names, browser profiles, or
full environment dumps. Sanitized screenshots are optional corroboration.

## 9. Fix commit policy

After a planned commit, a newly found defect gets a focused commit on the same branch before
dependent tasks continue:

```text
fix(<scope>): <specific violated invariant>
```

Its evidence records the introducing/exposing commit, failing test or reproduction, smallest
correction, targeted/downstream reruns, and effect on earlier evidence. Examples:

```text
fix(collaboration): preserve update receipt after compaction
fix(sync-client): retry original update id after lost ack
fix(api): reject archived board write after row lock
fix(web): clear server saved status on sequence gap
```

Do not use a vague subject, amend/squash completed planned commits, or change approved
architecture to make a failing test disappear. An actual contract conflict needs failed evidence
and a targeted amendment to `plan.md`/`phase4.md` before substitution.

## 10. Phase 4 final gate

The branch is ready for Phase 4 closure only when:

- P4-01 through P4-13 and focused fixes form recorded linear history.
- Clean install, format, lint, types, unit/browser/integration, auth schema, migrations,
  boundaries, builds, and `phase4:verify` pass at the recorded tree.
- Authenticated, Origin-checked sockets disclose no graph to anonymous/nonmembers; raw viewer
  updates cannot change accepted state.
- Independent browsers converge on supported simultaneous edits and local changes survive
  reload/reconnect without full-ready replacement or remote echo.
- No server ACK or peer broadcast precedes the database commit. Duplicate retries retain original
  receipt/sequence through restart and compaction.
- Invalid, causally incomplete, oversized, or timed-out updates cannot poison a healthy room.
- Archive and removal races follow board-row order and revoke stale socket write authority.
- Singleton ownership, room admission, liveness, compaction, and eviction are bounded and proven.
- Save labels and minimal recovery match real local/server facts; rejected bytes remain exportable.
- Five-user collaboration, validation, and opening budgets are measured against `phase4.md`;
  deviations are corrected or keep the gate open pending an approved amendment.
- Earlier phase regressions remain intact and the Phase 2 audit gaps remain explicitly visible.
- Final documentation distinguishes this milestone from offline shell completion and release.

A required real database, cookie/socket, browser, crash, or performance proof that is missing,
mocked, or failing leaves Phase 4 OPEN. P4-13 documents it; it does not redefine the gate.

## 11. Agent handoff response

After each planned or focused commit, report:

```text
Task: <P4-xx — title, or focused fix>
Branch: phase-4-durable-collaboration
Hash: <commit hash>
Parent: <parent hash>
Changed: <files/modules>
Proved: <observable behavior>
Checks: <exact commands with PASS/FAIL/UNRUN>
Database/socket evidence: <connections, cookies, transaction/failure, or not applicable>
Browser/performance evidence: <build, profiles, RTT, measurement, or not applicable>
Evidence: <path>
Risks: <known gaps or none>
Next: <next sequential P4 task>
```

The response describes committed state. The next contributor verifies that hash is HEAD before
continuing on the same branch.

## 12. Technical references

- `plan.md` sections 7–11, 16–19 and milestone M04 — product, storage, protocol, budgets, tests.
- `phase4.md` — Phase 4 scope, task map, required proofs, and exit gate.
- `guide2.md` — prior single-branch, one-commit-per-task handoff pattern.
- `docs/phase-1-compatibility.md` — pinned Yjs/WS/database compatibility evidence.
- `docs/phase-2-editor.md` — local editor and separate open audit items.
- `docs/phase-3-identity-boards.md` — session, permission, board lifecycle, and DB baseline.
- `apps/api/AGENTS.md` and `apps/web/AGENTS.md` — binding application coding rules.
- Existing source and lockfile — actual package versions, scripts, and module names.

Library references in `plan.md` establish capabilities. Archboard's exact room order, receipt,
outbox, recovery, permission, and evidence rules come from the governing project documents.
