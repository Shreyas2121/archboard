# Archboard Phase 7 — Commit-by-Commit Implementation Guide

Version: 1.0<br>
Date: 1 October 2026<br>
Status: Implementation guide<br>
Governing documents: `plan.md` version 1.1 and `phase7.md` version 1.0<br>
Branch policy: one long-lived Phase 7 branch for the entire milestone

## 1. Purpose

This guide turns Phase 7 presentation and portability into twelve small, reviewable commits.
It specifies branch workflow, owned paths, implementation boundaries, checks, evidence, and
handoffs. The outcome is named architecture walkthroughs, optional live following, immutable
committed checkpoints, safe JSON/SVG/PNG portability, and three complete bundled templates.

Authority order is the user's latest written instruction, `plan.md`, `phase7.md`, then this
guide. Record an exact conflict and evidence before changing a contract. Routine names follow
the current tree; Yjs field semantics, durable sequencing, server authorization, immutable
checkpoints, fresh-ID creation, inert exports, and account isolation must remain intact.
Writing this guide does not implement features, create a branch, commit changes, or authorize
deployment, configured migrations, or service setup.

M07 formally depends on M04 and M05. Reuse Phase 3 identity/board lifecycle and Phase 6 resource
invalidation/discussion exclusions. Read the [Phase 4](docs/phase-4-collaboration.md),
[Phase 5](docs/phase-5-offline.md), and [Phase 6](docs/phase-6-discussion-sharing.md) audits;
their OPEN gates do not become passed when Phase 7 implementation lands. Historical Phase 3
proof remains attached to its original build. The Phase 2 editor audit stays independent.

## 2. Fixed implementation decisions

### 2.1 One branch and one planned commit per task

Use one branch named:

```text
phase-7-presentation-portability
```

Create it once from the approved integration baseline containing Phase 4/5 implementations and
the consumed Phase 3/6 services, after `phase7.md` and this guide are committed or included in an
approved planning commit. Record the base hash and inherited audit statuses in P7-01 evidence.
P7-01 through P7-12 land in order on this branch. Inspect an existing branch and preserve unknown
user changes; never force-create, reset, or overwrite work to match the suggested history.

This workflow does not authorize remote push, merge, rebase, deployment, production migration,
OAuth changes, or user-data deletion. Follow later explicit instructions. If contributors take
turns, only one edits/commits to the shared branch at a time and leaves a committed evidence
handoff. Per-task branches, worktrees, and cherry-pick assembly are not part of this guide.

### 2.2 Sources of truth and package boundaries

```text
Y.Doc / outbox   -> authored steps and existing graph edits; durable local/server protocol
PostgreSQL       -> committed graph snapshots/logs, immutable checkpoints, creation receipts
Room memory     -> connection-bound presenter lease and active broadcast step
Local UI state  -> presentation mode, viewport, selected step, follow preference
TanStack Query  -> account/board-scoped checkpoint and board REST views
Export package  -> pure projection-to-JSON/SVG transformations
Web adapter     -> file interaction, controlled SVG rasterization, PNG/download lifecycle
Fixtures        -> version-controlled templates; fresh IDs on every instantiation
Service worker  -> static offline shell/resources; no protected checkpoint REST caching
```

React Flow renders the shared projection; do not add a second editable step/graph array.
`contracts`, `document-model`, and `export` import neither React nor Nest; `sync-client` has no
React dependency. Browser rasterization stays outside the pure renderer. Reuse Better Auth,
the permission service, domain commands, local durability, room ordering, query lifecycle,
component system, and existing remapping/board initialization before adding parallel helpers.

Comments, members, invitations, credentials, presenter state, viewport preferences, and CRDT
history never enter portable graphs or new-board copies. Presentation/follow messages do not
create graph updates, receipts, ACKs, sequence increments, timestamps, or outbox entries.
Checkpoints are server snapshots, not another editable JSON write path. `/demo` stays local-only.

Phase 8 owns release-wide accessibility/performance, backups, deployment, and the full release
gate. Phase 7 still requires usable keyboard flows, bounded work, safe rendering, and evidence
for its own features; it cannot defer those contracts by calling them release hardening.

### 2.3 Permissions, ownership, and archive state

Use the same server permission service for REST and presenter controls. Check current session,
membership, and archive state at the relevant room/transaction boundary. The immutable board
owner is derived from the board row; a new private board does not create an owner membership.

| Operation                               | Owner/editor on active board                              | Viewer                 | Archived source |
| --------------------------------------- | --------------------------------------------------------- | ---------------------- | --------------- |
| Author durable steps                    | Allowed                                                   | Denied                 | Denied          |
| Present locally/read steps              | Allowed                                                   | Allowed                | Allowed         |
| Acquire live presenter lease            | Allowed                                                   | Denied                 | Denied          |
| Follow authorized presenter             | Explicit opt-in                                           | Explicit opt-in        | No active lease |
| Create checkpoint                       | Online, settled local persistence and acknowledged outbox | Denied                 | Denied          |
| Read checkpoint/export readable content | Allowed                                                   | Allowed                | Allowed         |
| Duplicate/restore as new private board  | Online, current reader                                    | Online, current reader | Allowed online  |

Import/template/blank creation requires a signed-in user online and the existing active-owned-
board cap. Removed users lose protected server reads/writes; an old downloaded recovery copy
does not grant continued server access. Scope checkpoint IDs through the path board. Nonmembers
get 404 without existence disclosure; known members lacking a required role get 403. Clients
cannot set owner, creator, server time, sequence, or permission fields.

### 2.4 Steps, concurrency, and local presentation

Keep `steps`/`deletedSteps` and the physical schema unchanged. Titles/notes use Y.Text;
rectangle/reference arrays are atomic fields. Initialize a step fully in one transaction.
Domain commands handle capture, property changes, reorder, and tombstone deletion.

Centralize shared limits: 50 live steps, 4,000-character notes, integer order within ±1,000,000,
at most 500 unique node/edge highlight references in total, finite world coordinates within
±100,000, and positive rectangle dimensions up to 20,000. Reuse existing title/string-counting
rules. Boundaries are not highlight targets; empty highlights are valid.

Capture the visible canvas rectangle in world coordinates and selected live IDs. Every list
and playback view sorts by `(order, id)`. Reordering changes affected order values in one
transaction; concurrent reorder results converge without promising either author's intended
order. Supported local property/reorder undo preserves remote edits. Generic undo excludes
create/delete; deletion appends a tombstone and never clears it or physically deletes a map.

Local presentation hides editing controls, fits the step rectangle, highlights surviving
targets, shows plain-text notes/title/count, and offers named previous/next/exit controls.
Left/right navigates and Escape exits without intercepting native text editing. Restore focus
on exit. Missing highlights are ignored; deleted active steps expose a remaining-step choice or
empty state. Presenting never writes the local viewport to Y.Doc or acquires a lease implicitly.
Cached offline playback and demo playback are supported; offline authoring retains Phase 5
authority, Web Lock, local persistence, and storage-failure rules.

### 2.5 Presenter lease and explicit following

Complete existing `presenter.acquire`, `presenter.step`, `presenter.release`, and server
`presenter` DTOs on the existing socket. The server grants one lease per board bound to the
authenticated connection. Another tab of the same user has no control over that lease.
Serialize acquisition/release/expiry/access changes with room operations. Competing or
nonholder controls receive safe denial and cannot change durable or presenter state.

Only a current active-board owner/editor can acquire. Broadcast step IDs must resolve to live
committed steps; local pending-only steps must synchronize first. Repeated holder acquisition
is harmless. A deleted active step clears the active step without resurrecting it. Join/reconnect
sends current presenter state after authenticated `ready` with correct event ordering.

Lease expires on disconnect or after 30 seconds without holder heartbeat. Reuse existing
ping/pong liveness and track holder activity independently of the 45-second dead-socket timeout.
An unrelated peer cannot renew the lease. Document a targeted protocol amendment before adding
an explicit heartbeat DTO if the pinned transport cannot fulfill the existing contract.
Downgrade, removal, session expiry, archive, shutdown, or restart clears authority/lease and
returns authorized followers to local control. There is no persisted presenter identity.

Receiving presenter state or entering presentation does not opt in. **Follow presenter** is
explicit. Local panning, leaving presentation, or unfollow clears follow immediately; later step
frames preserve the viewport, as A21 requires. Require new opt-in after reconnect, board/account
change, or a new lease. Old-connection frames cannot move a new view. Unknown/unavailable steps
show a waiting/unavailable state until valid under the same currently followed lease.

### 2.6 Immutable committed checkpoints

Reuse the `checkpoints` table/entities and source migrations. A checkpoint stores board-scoped
UUID, name, server creator/time, schema version, immutable Yjs bytes, and decimal `throughSeq`.
Use `(board_id, created_at, id)` list indexing. Add a forward migration only for a real gap;
never enable synchronization or alter an applied migration.

Create with name trimmed to 1–120 characters and decimal-string `expectedSeq`. The UI requires
online current owner/editor, active board, no pending persistence, and an empty acknowledged
outbox. Server authorization/sequence checks cannot prove the client has no undisclosed edits.
Do not equate an empty in-flight socket send with settled local durability.

In the existing board queue, transactionally lock/recheck board authority/archive/sequence,
capture the complete last committed graph, enforce 100 checkpoints per board, and commit
metadata/bytes/idempotency together. Capture cannot use a candidate or inconsistent snapshot/log
pair. `expectedSeq` conflict returns 409 with no checkpoint; refresh and require an explicit new
submission for a changed capture request. Other participants may edit; `throughSeq` defines the
capture. Do not advance graph sequence or manufacture an ACK. Emit `checkpoints` invalidation
only after a new commit, never on rollback/denial/replayed creation.

Inspect read-only via `/boards/:boardId/checkpoints/:checkpointId`. Derive GraphProjection
without mutating snapshot bytes or the source board. Restore-as-new is an online creation for
any current reader, including viewer/archived-source readers. Project/validate/remap into a
fresh document and private board; never replace the live source Y.Doc or clone historical bytes
as the new board's graph history. Old offline clients retain the original ID/namespace.

### 2.7 JSON envelope, validation, and fresh-board creation

Use exactly `format: 'archboard'`, `formatVersion: 1`, `exportedAt`,
`syncStatusAtExport: 'server-saved' | 'local-only'`, board title/description, and
`graph: GraphProjection` with schemaVersion 1. Capture metadata, projection, and sync state
consistently. Use `server-saved` only for the view covered by durable ACK state; pending/offline/
demo/recovery content is conservatively `local-only`. Export never drains or acknowledges an
outbox. Full text survives JSON even when image text is clipped.

Recovery JSON exports the full local projection, including unsynchronized/in-memory content.
Filter deleted references through the projection so valid exports satisfy strict import. Image
scope choices must not silently reduce recovery JSON. Preserve an export above the 5 MiB import
cap and warn that unchanged reimport is unavailable; do not truncate it.

Import validates the entire UTF-8 file within 5 MiB and bounded parsing work. MIME/extension are
hints. Client validation provides feedback; the server independently enforces strict envelope,
graph, metadata, counts, text, IDs, versions, geometry, enums, handles, URLs, and references.
Reject duplicate IDs, self-loops, missing endpoints, dangling/repeated step references, unknown
fields, prototype-related keys, and security/history injection. No execution, fetch, partial
repair, or new record before complete validation. Allow bounded request-envelope overhead.

One all-entity UUID map remaps nodes, edges, boundaries, steps, endpoints, and highlights.
Validate the output and initialize a fresh Y.Doc with empty tombstones and new Yjs identity.
Commit board metadata, initial snapshot, derived ownership, active-board cap, and idempotency
together. Reuse this path for import, template, committed duplicate, and checkpoint restore.
Exclude comments/access/checkpoint history, source receipts/sequences, credentials, and CRDT
history. The caller owns the private result; imported export timestamps/labels grant no authority.

Creation uses actor/operation-scoped UUID `Idempotency-Key`, exact request hash, and a transactional
24-hour response/effect receipt. Exact successful retry returns the original result, including
after source advancement, subject to current authorization. Changed request with the same key
returns 409. Uncertain responses keep the original payload/key; no automatic new-key retry or
post-expiry resubmission before result reconciliation. A definitive expected-sequence conflict
may lead to explicit refreshed capture with a new request/key.

Duplicate uses committed source content. For pending local changes, offer synchronization or
local export/import and explain which content is copied. Imports/templates/restore create new
boards online only; none merges into or clears history in a live document.

### 2.8 Controlled SVG/PNG and templates

Use pure `packages/export` transformations over one frozen projection. Render all card kinds,
labels/protocols, styles/directions, and named boundaries using controlled primitives/tokens,
escaped XML, safe generated marker/clip IDs, and deterministic geometry/wrapping. No scripts,
event attributes, raw markup, external images/fonts/hrefs, arbitrary CSS, `foreignObject`,
DOM screenshots, or URL preview fetches. Document XML-invalid-character handling and wrapping
differences; preserve original full text in JSON. Clip long bodies with an overflow indicator
and bound layout work. Exclude cursors/comments/selection/editor/presentation overlays.

Image controls offer whole graph/current selection, background on/off, and PNG scale 1×/2×.
Selected internal edges require included endpoints; explain omitted edge-only selection. Include
labels/strokes/padding in finite bounds. Check 8,192 pixels per side and 32 megapixels total
before canvas allocation; reduce scope/scale explicitly, never silently crop/shrink. SVG geometry
is bounded too. Preserve transparency, sanitize filenames, and release URLs/canvases/buffers on
success/failure/cancel/unmount. PNG rasterizes the controlled SVG in the browser; decoding,
downloads, CSP, and offline behavior require deferred browser evidence.

Templates are fixed GraphProjection fixtures with stable fixture IDs and fresh instantiation IDs:

| Template           | Required content                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `web-application`  | Browser, API, database, cache; HTTPS/SQL/cache edges; backend boundary; request payload code card; four steps       |
| `event-processing` | Producer, queue, worker, database, external notification service; event/persistence labels; retry note; three steps |
| `service-boundary` | Gateway, identity service, application service, database; two boundaries; schema card; ownership note; three steps  |

Validate/remap through the shared creation path and select from a fixed server registry.
Place objects legibly at fit-to-content. Blank creation has no objects or steps; templates
populate new boards only. `/demo` uses web-application with isolated local presentation/export
and no fake server presenter/checkpoint/creation status.

### 2.9 Coding, lifecycle, and verification policy

**Version 1 verification pause (user direction, October 1, 2026):** Defer all database checks/tests
until the entire M00–M08 implementation is complete. Include database-backed HTTP/auth/session/
socket tests, schema/migration inspections, diagnostics used for verification, and aggregates with
database children. Individual task/Phase 7 completion does not resume them. Prepare meaningful
tests now without executing them; record **UNRUN (deferred by user — until Version 1 implementation
is complete)**. The shared [verification policy](docs/verification-policy.md) governs every task.

Browser checks remain independently paused: no native browser suites, Playwright, served preview
flows, `pnpm test`, `pnpm test:browser`, `pnpm phase4:quick`, or full browser-running verifiers.
Prepare needed harnesses and record **UNRUN (deferred by user)**. Run database-free/non-browser
formatting, lint, types, builds, boundaries, scans, and focused unit/Node checks. These pauses
override execution/completion requirements below. Implementation may continue with OPEN gates;
unit/build substitutes prove neither PostgreSQL semantics nor real browser behavior. Final
database verification follows all Version 1 implementation; browsers still need user resumption.

Read `apps/web/AGENTS.md` before frontend work and `apps/api/AGENTS.md` before API work.
Use current Tailwind/shadcn/components, shared DTOs, feature boundaries, and nearest tests.
No new UI kit/router/auth/store or paid dependency. Justify necessary dependencies with exact
compatible pins and lockfile changes. Provide names, focus, keyboard alternatives, and useful
error announcements; keep all user/import text inert.

Queries, files awaiting import, exports in preparation, and creation results remain account/board
scoped. Cancel/ignore old-account operations; late results cannot navigate another account or
populate its queries. Reconnect rechecks authority and refetches checkpoint REST views even after
missed hints. No authenticated API response is added to a broad service-worker cache. Recovery
preserves exact old-account graph bytes without clearing the outbox or moving it to a new account.

Use synthetic accounts/content in evidence. Record exact commands, counts/timings/build/runtime
versions and boundaries proved. Never commit `.env`, cookies, tokens/hashes, database URLs,
private graph/checkpoint bytes, snippets, browser profiles, or generated builds. Mock state tests
cannot prove a real transaction, authorization race, PNG download, or cross-client follow behavior.

## 3. Single-branch execution contract

Before P7-01:

1. Read `plan.md` sections 4.7–4.9, 5–14, 15–20 and M07; `phase7.md`; this guide; root
   `AGENTS.md`; application guides for affected work; verification policy; and Phase 2–6 audits.
2. Inspect approved branch/base, HEAD/status, manifests, step commands/projection/undo/remap,
   presenter protocol/transport, checkpoint entities/migrations, board initialization, templates,
   export surfaces, query/cache lifecycle, and existing tests. Preserve unexplained user work.
3. Record baseline hashes and inherited OPEN findings. Review migrations/configuration by source
   and historical evidence only; defer configured migration/database inspection. Separate
   binding Phase 7 defects from unrelated historical audit gaps.
4. Ensure planning documents are committed or included in an approved planning commit, then
   create/switch safely to `phase-7-presentation-portability` under implementation authorization.
5. Run lightweight allowed baseline checks and record pre-existing failures without claiming
   acceptance from substitutes or running hidden database/browser children.

Before each task, confirm the previous planned/fix commit is HEAD, inspect unexplained changes,
read dependency evidence and nearest source/tests, and state non-goals. Stay within owned paths
except justified integration files. Reuse an existing helper before adding one. No separate task
prompt files are required unless the user requests them.

Before each commit:

1. Review the full diff and stage only intended task changes, preserving unrelated work.
2. Run focused allowed checks plus formatting, lint, strict types, and changed app/package builds
   as appropriate. Record blocking baseline failures. Do not hide them inside aggregate success.
3. Rerun affected database-free regressions for graph/schema/permission/room/lifecycle/manifest
   changes. Prepare corresponding real database/socket/browser regressions without execution.
4. Write `docs/evidence/phase7/P7-xx.md` with commands/results, implementation versus acceptance,
   deferred case/command inventory, environment, gaps, and next dependency.
5. Commit with the exact planned subject below and report commit/parent hashes. Do not amend
   merely to insert a self-hash into evidence; the final index maps hashes.

Never reset unknown work, clear shared data, weaken assertions, fabricate sessions, or relabel
an inherited gate passed without its required proof. P7-12 is audit/documentation only;
functional corrections land before it. A binding failure keeps its dependent criterion OPEN
even when implementation proceeds under the verification pauses.

## 4. Branch and commit policy

The planned history is linear:

```text
approved integration baseline with Phase 4/5 and consumed Phase 3/6 implementations
  -> P7-01 -> P7-02 -> P7-03 -> P7-04 -> P7-05 -> P7-06
  -> P7-07 -> P7-08 -> P7-09 -> P7-10 -> P7-11
  -> focused fixes, if any -> P7-12
```

One P7 task is one planned commit. DTOs/limits begin in P7-01; Swagger accompanies the implementing
API task. A genuine initialization schema gap belongs to P7-06 and a checkpoint schema gap to
P7-07. Pure export foundations may be introduced in P7-06 and SVG rendering completed in P7-09;
do not add a duplicate package. Tests/evidence accompany behavior, not only the final verifier.

Fix a defect found before landing within the task. A later discovery gets a focused
`fix(<scope>): ...` commit before its dependent task. Do not squash/amend/rebase/rewrite or merge
intermediate baseline changes without user direction. Record changed baseline and affected
evidence. A committed implementation handoff is distinct from full phase acceptance.

## 5. Canonical repository commands

Inspect actual scripts/configuration before selecting commands. Add `phase7:verify` with full,
`--non-browser`, and `--implementation` modes by P7-11. Implementation mode excludes all database
and browser children; non-browser mode retains real database coverage for final verification.
Full mode includes served-browser acceptance. New names are planned interfaces until added.

| Command                                                                   | Use during implementation                                             |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                          | Dependency setup when required                                        |
| `pnpm format:check`                                                       | Formatting; use focused document checks for documentation-only work   |
| `pnpm lint` / `pnpm typecheck`                                            | Code and strict TypeScript checks                                     |
| `pnpm --filter @archboard/api test -- <suite>`                            | Select actual database-free Node suites                               |
| Focused Node-only contracts/model/export/fixtures/state suites            | Inspect runner project/config; record actual suite names              |
| `pnpm --filter @archboard/web build`                                      | Frontend production build                                             |
| `pnpm --filter @archboard/api build` / `pnpm build`                       | API/workspace builds                                                  |
| `pnpm boundary:check`                                                     | Package/application ownership rules                                   |
| `pnpm phase7:verify --implementation`                                     | Future database-free/browser-free aggregate; add in P7-11             |
| `pnpm test:integration` / `pnpm --filter @archboard/api test:integration` | DB suites; deferred until all Version 1 implementation                |
| `pnpm auth:schema:check` / `pnpm db:migration:show`                       | DB checks; deferred until all Version 1 implementation                |
| `pnpm phase5:verify --non-browser` / `pnpm phase6:verify --non-browser`   | DB aggregates; deferred until final Version 1 verification            |
| `pnpm phase7:verify --non-browser`                                        | Future DB/session/socket aggregate; deferred until final verification |
| `pnpm test` / `pnpm test:browser`                                         | Browser-running; **UNRUN (deferred by user)**                         |
| `pnpm --filter @archboard/sync-client test`                               | Browser-running suite; **UNRUN (deferred by user)**                   |
| Full `pnpm phase1:verify` through `pnpm phase7:verify`                    | Browser-running aggregates; **UNRUN (deferred by user)**              |
| `pnpm phase4:quick` / `pnpm phase4:verify:legacy`                         | Browser-running; **UNRUN (deferred by user)**                         |

The `<suite>` placeholder requires a discovered concrete database-free selection, not literal
execution. A package `test` command may contain browser projects. Do not use `pnpm test` or
`--non-browser` as a shortcut around the pauses. Direct Node/Jest wrappers performing database-
backed HTTP/auth/socket or migration work remain deferred too.

Prepare deterministic model/lease/geometry/export checks, real PostgreSQL capture/creation/
cap/idempotency races, and independent served presentation/file/checkpoint/cache/keyboard flows.
Document executable names and deferred fixtures. At final Version 1 database verification, use
isolated migrated schemas/databases and real independent sessions/connections. When browser
verification resumes, use a served production build, independent authenticated contexts, and
active service worker/actual offline mode where required. Clean up helpers and synthetic state.

Configured migration state is separate from test-schema migrations. Apply forward migrations
only to a verified intended target under existing authorization; writing this guide does not
approve database changes. Record each deferred database boundary with the exact label
**UNRUN (deferred by user — until Version 1 implementation is complete)** and browsers with
**UNRUN (deferred by user)**. Aggregate success in a partial mode does not mean full phase PASS.

## 6. Commit plan

### P7-01 — Inventory the baseline and define portability contracts

Commit subject:

```text
feat(contracts): define presentation and portability contracts
```

Depends on: approved M04/M05 integration baseline and committed Phase 7 planning documents;
consume existing Phase 3/6 services without requiring their deferred gates to pass first.

Read first: `phase7.md` sections 3, 5, 6.1, 7.1, 8–9, 12, 14.1; current contracts/limits,
model/protocol exports, checkpoint migrations/entities, board services, and Phase 2–6 audits.

Owned paths: `packages/contracts/**`, focused contract tests, API schema/inventory documentation,
and `docs/evidence/phase7/P7-01.md`.

Required work:

- Map implemented/partial/missing step, presenter, checkpoint, export/import, remapping,
  initialization, fixture, and UI/query surfaces. Identify source-of-truth owners and binding gaps.
- Add/reuse exact ExportEnvelope, strict import/checkpoint bodies/results/pagination, decimal
  sequence fields, limits, and safe errors. Preserve shared PresentationStep and presenter events.
- Cover unknown/forged fields, IDs, versions, sequence strings, text/count/geometry/URL bounds,
  and strict import references. Do not weaken live-concurrency reference tolerance globally.
- Record any forward migration/index gap by source for its owning later task. No duplicate
  checkpoint table, configured DB inspection, or auth-table regeneration.
- Identify concrete Node-only test commands and the current runtime/lockfile baseline. Map
  contracts to Swagger without claiming an unimplemented route is already available.

Non-goals: no graph command changes, presenter service, checkpoint writes, import execution,
renderer/UI, applied migrations, or new protocol version.

Checks during pause: focused contract negatives, formatting, lint, types, boundary check,
source schema review, and changed-package build where applicable. Database/schema/runtime
authorization checks remain UNRUN; browser acceptance remains independently deferred.

Completion evidence: a source/service map, strict malformed-input proof, actual schema-gap
decision, allowed runner selections, and inherited gates with their original evidence boundaries.

### P7-02 — Complete step commands and deterministic projection

Commit subject:

```text
feat(document-model): complete presentation step commands
```

Depends on: P7-01.

Read first: `phase7.md` sections 5, 6.1, 14.1; existing step/text/batch/deletion commands,
projection/remap, physical validation, local command origins, undo, and seeded convergence tests.

Owned paths: `packages/document-model/**`, focused model fixtures/tests, justified contract
refinements, and P7-02 evidence.

Required work:

- Complete create/property/rectangle/highlight/reorder/delete commands over existing nested maps.
  Initialize atomically; edit Y.Text incrementally and preserve unrelated atomic fields.
- Enforce step/reference/order/rectangle limits and the complete command-validation contract.
  Capture input is world geometry; screen conversion belongs in the later web integration.
- Sort projection by `(order, id)` and filter legitimate deleted/missing highlight targets.
  Reorder affected values in one transaction and stay within the bounded integer domain.
- Append step tombstones without physical map deletion or resurrection. Preserve supported
  local property/reorder undo, remote contributions, and generic create/delete exclusions.
- Add seeded independent replica proof for concurrent notes/title/property/reorder/delete,
  duplicate/reordered delivery convergence, reference filtering, and limit boundaries.

Non-goals: no UI, shared viewport, presenter state in Y.Doc, schema renaming, checkpoint/import
service, or generic create/delete undo expansion.

Checks during pause: discovered Node-only model/schema/commands/projection/undo/convergence
suites, formatting, lint, types, model build, and boundaries. Native browser tests remain UNRUN.

Completion evidence: independent replicas converge with intact field/undo/delete semantics,
strict bounds, and deterministic order. Pure tests do not establish offline browser durability.

### P7-03 — Add step authoring and local presentation

Commit subject:

```text
feat(web): add step authoring and local presentation
```

Depends on: P7-02.

Read first: `phase7.md` sections 6, 11, 14.4; frontend instructions, editor/inspector selectors,
canvas world conversion, text bindings, command shortcuts, local durability, and demo namespace.

Owned paths: web presentation feature/editor integration, pure viewport/state helpers,
prepared UI/offline harnesses, focused Node checks, and P7-03 evidence.

Required work:

- Add named step list/create/edit/delete controls, title/notes Y.Text bindings, viewport and
  highlight capture, drag reorder, and keyboard earlier/later alternatives through commands.
- Convert the actual visible viewport to bounded world rectangle; capture live selected node/
  edge IDs without boundary targets or React Flow internals in the document.
- Gate authoring by role/archive/local writer/storage state. Cached offline edits use existing
  persistence; viewers/archived readers can present but cannot author.
- Add local mode with previous/next/title/count/notes/exit, left/right/Escape policy, visible
  focus/return focus, and fit/highlight behavior that never writes the viewport into Y.Doc.
- Handle empty/deleted steps and highlights truthfully. Keep demo/offline playback independent
  of server lease/capture operations; do not imply local UI state survived an untested reload.

Non-goals: no presenter acquire/follow UX, checkpoint/import/export controls, second step store,
full release accessibility claim, or forced collaborator viewport changes.

Checks during pause: Node-only state/world-geometry/shortcut mappings, formatting, lint, types,
web build, and boundaries. Prepare actual served keyboard/role/offline/reload/delete-target
proof but leave browser execution **UNRUN (deferred by user)**.

Completion evidence: commands and pure geometry/state cover the new authoring/playback flow;
record actual browser interaction and IndexedDB/reload acceptance as deferred, not build-proven.

### P7-04 — Enforce the presenter lease and transport lifecycle

Commit subject:

```text
feat(collaboration): enforce presenter leases
```

Depends on: P7-01 and P7-02; P7-03 precedes it in this linear guide.

Read first: `phase7.md` sections 7.1, 12, 14.3; production adapter, room queue, session/role
checks, liveness, access/archive handling, client transport lifecycle, and shared presenter DTOs.

Owned paths: API collaboration lease/control/fanout integration, sync-client transport event
surface without React dependencies, focused Node/API units, prepared real session/socket tests,
and P7-04 evidence.

Required work:

- Grant one connection-bound lease through serialized acquire/release/expiry/access operations.
  Exact holder reacquire is harmless; simultaneous or same-user-other-tab controls cannot steal it.
- Enforce current owner/editor/session/active board and live committed step IDs. Reject viewer,
  nonholder, malformed, deleted, and pending-only controls without changing lease/graph state.
- Enforce 30-second heartbeat expiry independently of the socket's 45-second disconnect bound,
  reusing liveness without unauthorized protocol expansion or renewal by other peers.
- Clear on disconnect/session/access/archive/shutdown; process restart has no stored lease.
  Deleted active step clears its step state. Deliver authenticated current state after ready.
- Keep presenter traffic strictly transient with existing rate/size safeguards, protected
  fanout, ordered state, and no graph sequence/receipt/ACK/outbox/timestamp effects.

Non-goals: no multi-presenter mode, forced following, persisted lease, new socket/heartbeat
contract without amendment, or real DB/socket execution during the pause.

Checks during pause: controlled-clock lease/state and database-free API/transport units,
API build, formatting, lint, types, boundaries. Prepare independent session/socket contention,
30-second liveness, join, role/archive/revoke, and no-durable-effect cases; execution stays UNRUN
until all Version 1 implementation. Browser follow proof remains separately deferred.

Completion evidence: state logic and sources enforce identity/lifecycle boundaries; distinguish
these results from unrun transport timing, PostgreSQL access order, and authenticated fanout.

### P7-05 — Add explicit following and preserve local viewport control

Commit subject:

```text
feat(web): add opt-in presenter following
```

Depends on: P7-03 and P7-04.

Read first: `phase7.md` sections 7.2, 11–12, 14.2–14.4; presentation mode, transport subscriptions,
pan gestures, connection generations, account/access lifecycle, and viewport state.

Owned paths: web presentation/follow/editor integration, focused Node state checks,
prepared independent-browser A21 harnesses, and P7-05 evidence.

Required work:

- Add availability/acquire/release controls for eligible live editors and explicit Follow
  presenter/unfollow for readers. Local mode entry or a frame alone never opts in.
- Apply available valid step rect/highlights only for the current opted-in lease. Explain
  waiting/unavailable steps rather than selecting arbitrary or old-board content.
- Local pan, explicit unfollow, and presentation exit immediately stop following; later step
  messages leave viewport unchanged. Preserve keyboard access to the same choices.
- Lease loss clears follow and returns local navigation. Reconnect/new holder/account/board
  changes need new explicit opt-in; do not reacquire automatically.
- Ignore stale connection/namespace frames, clean subscriptions, and keep graph/outbox untouched.
  Offline/archived/demo/local-only states show no invented active live presenter.

Non-goals: no auto-follow preference, shared persisted viewport, implicit lease transfer,
presentation recording, or mocked multi-component proof of live collaboration.

Checks during pause: follow state/generation/pan/expiry units, web build, formatting, lint,
types, boundaries. Prepare independent authenticated A21, disconnect/reconnect, account switch,
and viewer controls under served production build; browser execution stays UNRUN.

Completion evidence: unit state transitions preserve explicit control and stale-frame isolation;
A21's actual two-user viewport/lease proof remains an explicitly deferred acceptance boundary.

### P7-06 — Validate JSON portability and share fresh-board initialization

Commit subject:

```text
feat(portability): validate and remap portable boards
```

Depends on: P7-01 and P7-02; P7-03–P7-05 precede it in this linear guide.

Read first: `phase7.md` sections 9, 12.1, 14; export envelope, strict versus live graph validation,
existing remap/hydration, board create/duplicate, TypeORM/idempotency helpers, and package layout.

Owned paths: pure JSON export module/package, document-model projection/remap/initialization,
API import/board-copy transaction/controllers, migration only for a proven initialization gap,
Swagger, focused units/prepared DB tests, and P7-06 evidence.

Required work:

- Export one coherent full local projection/metadata/sync envelope with no security/history.
  Preserve complete text and filtered live references; never mutate/acknowledge the source.
- Implement all-or-nothing 5 MiB UTF-8 import validation with safe field feedback, unknown-field/
  version/prototype/URL/ID/reference/count negatives, and bounded request-envelope overhead.
- Use one complete fresh UUID map and remap edges/highlights with all nodes/edges/boundaries/steps.
  Validate the result and hydrate fresh history-free Y.Doc, preserving semantic content/geometry.
- Reuse a single transactional initialization path for private metadata/snapshot/derived owner,
  board cap, and 24-hour idempotency. Expose it to later restore/template tasks.
- Complete import and committed-source duplicate route/Swagger behavior. Exact retry returns
  original result; changed key payload conflicts; rollback leaves no orphan board/snapshot.
- Prepare A17 semantic normalization and fresh-ID tests covering every kind and step/reference;
  prepare real DB creation/cap/retry/rollback and current-reader source denial cases.

Non-goals: no live-board replacement/merge, source history clone, partial import repair,
checkpoint service, image rendering, template registry/UI, or configured DB migration execution.

Checks during pause: pure JSON/schema/remap/hydration/all-kind tests, database-free API units,
API/package builds, formatting, lint, types, boundaries. Prepared real import/duplicate transaction
and HTTP/auth checks remain UNRUN until all Version 1 implementation; file UI remains deferred.

Completion evidence: semantic content survives complete disjoint ID mapping and malformed files
fail before effects in unit logic. Real atomic persistence/ownership/idempotency still needs
PostgreSQL proof; units must not substitute for it.

### P7-07 — Add immutable committed checkpoints

Commit subject:

```text
feat(api): add immutable committed checkpoints
```

Depends on: P7-06.

Read first: `phase7.md` sections 8, 12.1, 14.3; checkpoint entities/migrations, committed graph
reader, board queue/row locks, caps/idempotency, invalidation, and the P7-06 creation path.

Owned paths: API checkpoints module/entities/repositories/controllers, minimal room capture/
notification integration, forward migration only for an actual gap, Swagger, units/prepared
real DB/session/socket tests, and P7-07 evidence.

Required work:

- Implement stable paginated metadata list, detail projection, create, and restore-as-new routes
  with path-board scoping, safe envelopes, server creator/time, and decimal sequences.
- Capture complete last committed state through the same queue/transaction as writes/access/
  archive. Lock/recheck expectedSeq/role/archive, enforce 100 cap, and commit bytes/receipt atomically.
- Return 409 with no effect if sequence advanced. Do not copy a candidate, increase latestSeq,
  or ACK graph work. Emit checkpoints invalidation only after new committed creation.
- Keep bytes/metadata immutable after later source edits/compaction. Detail reads validate/project
  without altering source/checkpoint; no edit/delete endpoint.
- Restore via P7-06 fresh initialization for any current reader, including viewer/archived source,
  with fresh references/private ownership and no history/access/discussion copy.
- Prepare A16 and real capture/update/archive/revoke ordering, idempotency response-loss/replay,
  rollback/cap, cross-board denial, source advancement, and source/new-board independence.

Non-goals: no live rollback, checkpoint delete/edit/history clone, local-client-defined capture,
browser checkpoint UI, new graph-save endpoint, or applying configured migrations.

Checks during pause: database-free API/capture/request/notification units, API build, formatting,
lint, types, source migration review, boundaries. Real DB/socket/auth/schema/cap/race/A16 checks
remain UNRUN until all Version 1 implementation; browser inspection/restore proof stays deferred.

Completion evidence: API/source logic honors immutable committed capture and shared initialization;
stored bytes, real queue/DB race order, rollback, and server permission acceptance remain unrun.

### P7-08 — Build checkpoint and JSON portability flows

Commit subject:

```text
feat(web): add checkpoints and JSON portability
```

Depends on: P7-06 and P7-07.

Read first: `phase7.md` sections 8–9, 11–12, 14.4; frontend instructions, query keys/invalidation,
route shell, durability/outbox selectors, downloads/files, recovery, and uncertain creation handling.

Owned paths: web portability/checkpoint routes/editor/dashboard hooks, account-scoped query/
recovery integration, Node state checks/prepared UI harnesses, and P7-08 evidence.

Required work:

- Add checkpoint list/create with name/sequence/cap/error states. Enable capture only when local
  persistence is settled and the outbox acknowledged, online, active, and currently owner/editor.
- Build the read-only checkpoint route and restore-as-new title/action. Never attach writable
  source-board commands; navigate only after confirmed authorized new-board success.
- On expectedSeq 409 refetch committed state and require explicit new capture submission/key.
  Preserve exact request/key on uncertainty; do not auto-resubmit with a changed sequence.
- Add full local JSON download and strict import preview/errors/online creation. Preserve full
  recovery text, honest sync label, file/input after errors, and warning above import cap.
- Make committed duplicate's pending-edit source choice explicit. Refresh checkpoints after
  post-commit hints/reconnect; actor refresh cannot rely solely on a connected socket.
- Isolate files/queries/in-flight creation/export by account/board; ignore late results, preserve
  old graph recovery, and keep protected APIs out of service-worker caches. Offline uncached
  checkpoint data is unavailable; optional cached reads show age and scope.

Non-goals: no SVG/PNG adapter, template picker, offline server creation, automatic uncertainty
retry, checkpoint mutation, source-document replacement, or authenticated API runtime caching.

Checks during pause: capture eligibility/sync label/uncertain-request/account generation units,
web build, formatting, lint, types, boundaries. Prepare served A16/A17 file/route/download,
pending-work/storage-failure/account/offline/cache/keyboard proof; browser execution stays UNRUN.

Completion evidence: pure state logic correctly distinguishes local export from committed
capture/copy. Actual download, read-only routing, active worker caches, account transitions,
and independent original/restored board behavior require deferred browser acceptance.

### P7-09 — Render controlled SVG and rasterize bounded PNG

Commit subject:

```text
feat(export): add controlled SVG and PNG export
```

Depends on: P7-06; P7-07/P7-08 precede it in this linear guide.

Read first: `phase7.md` section 10 and 12/14; pure export foundations, graph geometry/text/
theme tokens, CSP/offline resources, selection semantics, browser file lifecycle, and frontend guide.

Owned paths: `packages/export/**`, focused synthetic renderer/security/geometry fixtures,
web image controls/PNG adapter, prepared served export harnesses, and P7-09 evidence.

Required work:

- Render all four kinds, labels/protocols, line direction/style, boundaries, safe markers/clips,
  and deterministic layer/wrapping geometry from a frozen projection; no editor DOM capture.
- Escape XML and prohibit scripts/events/foreignObject/raw markup/remote resources/arbitrary CSS.
  Bound clipped body layout, show overflow, document invalid-XML character policy, retain JSON text.
- Add whole/current-selection and background controls with coherent endpoints/internal edges,
  empty-scope feedback, label/stroke/padding bounds, and sanitized names.
- Validate finite 1×/2× PNG dimensions against both 8,192-per-side and 32-megapixel bounds before
  allocation. Bound SVG geometry too; request scope/scale reduction without silent crop/shrink.
- Rasterize only controlled SVG in-browser, preserve transparency, expose preparing/failure/
  download states, and release object URLs/canvases/buffers on all exit paths.
- Prepare A18 malicious XML/text/URL cases, exact geometry/area boundaries, no-fetch resource
  tests, real output decoding/dimensions/transparency, and offline resource/CSP/download checks.

Non-goals: no PDF, foreignObject, external fonts/images, image uploads, executable links/snippets,
second graph store, pixel-identical editor claim, or server-side/browser-substitute PNG proof.

Checks during pause: pure renderer/XML/geometry/scope/limits units, package/web builds, formatting,
lint, types, static output/bundle secret scans, boundaries. Actual browser PNG rasterization,
downloads/cleanup, CSP, transparency, and offline no-fetch proof remain UNRUN.

Completion evidence: controlled SVG output and bounded dimensions are proved at pure boundaries;
PNG/file/runtime assertions are explicitly separate and deferred. Source graph/outbox is unchanged.

### P7-10 — Complete templates and creation/demo integration

Commit subject:

```text
feat(templates): complete bundled architecture examples
```

Depends on: P7-03, P7-06, and P7-08; P7-09 precedes it in this linear guide.

Read first: `phase7.md` section 11 and 9.3/14; existing fixtures/template registry, board creation
and cap/idempotency, dashboard flows, local demo initialization, presentation, and import UI.

Owned paths: `packages/fixtures/**`, API fixed template registry/creation integration,
web dashboard/template picker/demo hooks, units/prepared DB/UI tests, and P7-10 evidence.

Required work:

- Finish the exact web-application four-step, event-processing three-step, and service-boundary
  three-step fixtures and all required technical cards/notes/boundaries/labeled edges.
- Validate templates strictly and instantiate through P7-06 fresh-ID mapping/private-board
  transaction. Multiple instantiations are mutually disjoint with valid internal references.
- Resolve only fixed known template IDs server-side. Unknown IDs fail safely with no board;
  no module-path loading or template insertion into existing documents.
- Add blank/template/import dashboard choices and online/pending/cap/error/retry states.
  Blank creation has zero entities/steps; no fallback silently changes the user's selection.
- Arrange legible fit-to-content geometry and use web-application for isolated local `/demo`.
  Support local presentation/export without fake server leases/checkpoints/creation saves.
- Prepare transactional create/retry/cap/rollback tests, rendered fit/steps/blank/demo/keyboard
  flows, and later online creation from explicit demo export/import only.

Non-goals: no external template service, paid resources, arbitrary path registry, inserting a
template into a live board, offline server creation, or claiming fixture validation proves legibility.

Checks during pause: template/schema/remapping/content/count units, database-free API registry
checks, fixtures/API/web builds, formatting, lint, types, boundaries. Real creation transactions
remain UNRUN until all Version 1 implementation; rendered/demo/offline flows remain deferred.

Completion evidence: exact required contents, empty blank graph, fixed registry, and fresh-reference
units pass. Actual visual legibility, file UX, and real database creation are separate open proofs.

### P7-11 — Assemble integrated acceptance and verifier modes

Commit subject:

```text
test(phase7): verify presentation and portability gates
```

Depends on: P7-05 and P7-08–P7-10, with P7-01–P7-07 evidence included.

Read first: `phase7.md` sections 12–17; all P7 evidence, inherited audits, root verifier patterns,
real DB/socket helpers, served production routing/CSP/cache policy, and verification policy.

Owned paths: focused model/API/transaction/security tests and prepared browser harnesses,
`scripts/phase7-verify.mjs` or established equivalent, root registration, run/verification docs,
small direct fixes found before landing, and P7-11 evidence.

Required work:

- Map A16/A17/A18/A21 to pure, real DB/session/socket, and later independent-browser boundaries;
  include fresh-ID proofs for duplicate/import/restore/templates without duplicating setup.
- Prepare real capture/update/archive/revoke races, caps, rollback, exact retry after source
  advancement, immutable checkpoint bytes, lease contention/expiry/denial, and scoped reads.
- Prepare served production A21 with two authenticated users, file import/download, SVG/PNG
  no-execution/no-fetch/output limits, local/offline presentation, cache/direct route, and keyboard
  proof. Include relevant A10/A11/A13/A22/A24/A25/A27 regressions and focused A28 paths.
- Add fail-propagating full/non-browser/implementation modes. Implementation runs only allowed
  Node/static/build/API-unit children and reports deferred database/browser proof as UNRUN/OPEN.
  Non-browser retains real DB/socket tests for final verification and never starts a browser;
  full adds wired served acceptance after both resumption conditions hold.
- Required missing/unwired cases prevent full PASS; explicit partial modes may report their own
  successful checks while preserving an OPEN full gate. Record every child count/result/timing.
- Scan public bundles/evidence for secrets, preserve original inherited evidence, and fix binding
  defects in their owner layer. Do not call source CSP/cache policy runtime evidence.

Non-goals: no deployment, global budget revision, Phase 8 release certification, mock-backed
transaction/browser substitution, hidden skip-as-PASS, or execution of paused harnesses.

Checks during pause: `pnpm phase7:verify --implementation` once added, relevant database-free
regressions/builds/scans, frozen install if setup requires it. Non-browser DB mode and full/browser
mode remain UNRUN. Report baseline failures rather than weakening boundaries to pass aggregates.

Completion evidence: each acceptance row names proof/deferred commands and failures; implementation
mode results are separate from OPEN full acceptance. All final DB/browser cases are recoverable.

### P7-12 — Audit and hand off Phase 7

Commit subject:

```text
docs(phase7): record presentation and portability exit status
```

Depends on: P7-01 through P7-11 and every focused Phase 7 fix.

Read first: `phase7.md` sections 16–18; task/fix evidence and history; Phase 2–6 audits; README,
manifests/lockfile, actual Swagger/routes, verifier modes, and historical migration evidence.
Review migration source only during the pause; do not inspect configured DB state.

Owned paths: `docs/phase-7-presentation-portability.md`, `docs/evidence/phase7/README.md`,
P7-12 evidence, run/API/verification guidance, truthful evidence metadata corrections, README
status guidance, and approved documentation amendments only.

Required work:

- Map base/planned/fix hashes, schema/API/dependency changes, exact commands/counts/timings,
  runtimes/builds/modes, and historical/current evidence boundaries.
- Link each deliverable/exit criterion to pure/build/source proof, real DB/socket proof, browser
  acceptance, or explicit deferred/failing boundary. Report A16–A18/A21 individually.
- Record wrapping/XML policy, image scope/size/cleanup limitations, import cap/full recovery
  behavior, uncertain-request rules, checkpoint sequence/cap/immutability, lease/follow lifecycle,
  direct-route/offline/cache requirements, and template contents.
- Preserve inherited audit statuses and distinguish test-schema migrations from configured
  migration state. Source review does not refresh a historical database observation.
- Verify setup/run/API docs reflect actual script/routes. Mark full phase PASS only with all
  required proof; during pauses report OPEN with exact deferred labels and executable inventory.
- Hand off to M08 with typical/limit/security fixtures, unresolved inherited findings and the
  consolidated DB/socket/schema/browser verification checklist. Discussion/access stays excluded
  from graph/export/copy/template/restore. Do not claim release/deployment readiness.

Non-goals: no functional fixes, migrations, dependency upgrades, test weakening, remote push,
merge, deployment, or database/browser resumption. Functional corrections land before this audit.

Checks during pause: document formatting, link/history/status validation, API/source consistency,
and `git status --short`. Reuse P7-11 exact-tree checks; rerun broader allowed checks only for
material changes/failures. Database/socket/schema and browser modes remain UNRUN; M08 may proceed
with OPEN gates and does not require substitute acceptance.

Completion evidence: audit/index/history agree and clearly separate delivered implementation,
current fast checks, historical proof, missing integrated acceptance, and the next milestone.

## 7. Sequential execution order

| Order | Commit | Why it is next                                                                |
| ----- | ------ | ----------------------------------------------------------------------------- |
| 1     | P7-01  | Inventory and strict contracts establish the consumed baseline                |
| 2     | P7-02  | Step semantics/projection precede authoring and committed step control        |
| 3     | P7-03  | Local authoring/playback makes presentation independently usable              |
| 4     | P7-04  | Server lease and transport authority precede follow controls                  |
| 5     | P7-05  | Explicit follow/panning/lifecycle completes live presentation behavior        |
| 6     | P7-06  | JSON validation/remapping and private initialization support all copies       |
| 7     | P7-07  | Immutable committed capture/restore uses the shared creation foundation       |
| 8     | P7-08  | Checkpoint/file/recovery UX consumes finished server contracts                |
| 9     | P7-09  | Controlled image rendering and PNG controls finish export options             |
| 10    | P7-10  | Complete examples use presentation and validated new-board creation           |
| 11    | P7-11  | Integrated coverage and explicit verifier modes map every acceptance boundary |
| 12    | P7-12  | Final audit records evidence/status and hands off consolidated gaps to M08    |

There are no parallel commit waves. `phase7.md` defines feature dependencies; this guide chooses
a compatible linear order. After a fix, rerun affected allowed checks and prepare dependent
database/browser regressions without execution. Implementation can land while acceptance stays
OPEN; completing this sequence does not resume either pause or satisfy the release gate.

## 8. Required evidence format

Each planned commit adds `docs/evidence/phase7/P7-xx.md`:

```text
# P7-xx — <title>

Planned commit subject: <exact subject from this guide>
Commit: <mapped in final evidence index; do not amend solely for self-hash>
Parent: <actual parent hash before implementation>
Branch: phase-7-presentation-portability
Environment: <OS, Node.js, pnpm, PostgreSQL, browser/build hash or UNRUN>

## Behavior proved
<observable behavior; implemented versus verified acceptance>

## Contracts used
<steps/order/undo, lease/follow, sequences, envelope, UUID map, scope/limits, recovery>

## Changed scope
<owned modules and justified integration files>

## Schema and API impact
<reused/new routes, source migration/index/Swagger changes, or none>

## Commands and results
- `<exact command>` — PASS/FAIL/UNRUN, duration, counts, fixture size, verifier mode

## Document and export evidence
<seeded replicas, semantic ID normalization, strict negatives, XML safety, dimensions>

## Database, session, and socket evidence
<real capture/creation/race/stored bytes/lease/denial; independent actors/connections or deferred>

## Browser and UI evidence
<served build, independent contexts, viewport/follow/file/offline/cache result or deferred>

## Security and account evidence
<scoped reads, no execution/fetch, secret exclusion, late-result/cache isolation>

## Recovery and graph preservation evidence
<sync label, pending persistence/outbox, uncertainty/key context, retained original namespace>

## Deferred verification inventory
<exact database/browser UNRUN labels, case names, fixture/setup, executable commands>

## Known gaps and inherited gates
<missing Phase 7 proof, earlier audit statuses, binding versus unrelated findings>

## Next commit unlocked
<next sequential P7 task or required exit proof>
```

The final `docs/evidence/phase7/README.md` maps planned tasks/focused fixes to hashes. Use sanitized
synthetic observations: counts, safe identifiers, sequences, dimensions, and status. Do not
include raw cookies/auth secrets/tokens, database URLs, private graph/checkpoint payloads,
source snippets, browser profiles, or environment dumps. Synthetic exported fixtures may support
proof; downloaded files with private content must not be committed. Screenshots corroborate UI
but cannot replace transaction, cross-client, active-worker, or actual file-output assertions.

## 9. Fix commit policy

If a defect is found after its planned commit, add a focused fix on the same branch before the
next dependent task:

```text
fix(<scope>): <specific violated invariant>
```

Record the introducing/exposing commit, failure observation, smallest correction, targeted/
downstream checks, and effect on prior evidence. Examples:

```text
fix(presentation): keep panned followers unfollowed
fix(collaboration): expire presenter lease at heartbeat deadline
fix(checkpoints): capture bytes at the checked committed sequence
fix(portability): remap step highlights with graph identifiers
fix(export): reject raster dimensions before canvas allocation
fix(web): ignore restore results after account switch
```

Do not amend/squash completed tasks or weaken assertions to pass. A contract conflict needs
evidence and a targeted `plan.md`/`phase7.md` amendment before substitution. Link inherited-layer
corrections to their owning audit without claiming its unrelated gate has closed. Database and
browser reruns remain deferred under their respective conditions; record prepared regressions.

## 10. Phase 7 final gate

Full Phase 7 acceptance requires:

- P7-01–P7-12/fixes form recorded linear history matching evidence; shared schema/API/runtime
  behavior, package boundaries, builds, allowed checks, final DB/browser checks, and verifier agree.
- Concurrent step text/property/reorder/delete and local undo preserve the document contract;
  real offline authoring/reload and keyboard local presentation work without shared view writes.
- One real authorized presenter lease obeys connection identity, holder-only control, 30-second
  heartbeat expiry, access/archive release, ordered readiness, and no durable graph side effects.
- A21 proves independent opt-in followed by local pan and subsequent presenter changes without
  viewport takeover; disconnect/reconnect/new lease requires explicit new following.
- A16 proves exact committed capture, immutable bytes/metadata, read-only inspection, and fresh
  restore isolation from original/new boards and original offline clients.
- A17 proves all-kind semantic portability and complete fresh-ID/reference mapping across import,
  duplicate, template, and checkpoint restore with private ownership and no copied history/access.
- Real PostgreSQL expected-sequence/cap/idempotency/rollback/access/archive races enforce all-or-
  nothing effects and original successful replay; hints occur only after new committed effects.
- A18 proves strict unsafe-file rejection and inert text/XML with no execution/fetch; real SVG/
  PNG scope/background/scale/transparency/dimension/download/offline/CSP boundaries are verified.
- Account/session/storage/uncertainty/direct-route/cache paths preserve pending graph work,
  honest sync labels, current authority, safe namespace isolation, and useful recovery exports.
- All three templates have exact required content and legible rendered walkthroughs; blank
  creation is empty and demo has no fabricated server state.
- Binding prerequisite defects are resolved, earlier independent OPEN gates remain visible,
  and no Phase 8/release/deployment claim follows from Phase 7 acceptance alone.

During either pause, report **OPEN**, completed implementation/fast checks, and each missing
database/socket/schema or browser requirement under its exact UNRUN label. A SVG string is not
PNG output, a lease unit is not a real heartbeat, and a checkpoint mock is not committed capture.
P7-12 exposes those limits. M08 implementation may continue; after all M00–M08 deliverables,
perform consolidated database verification. Browser verification still requires user resumption.
Release acceptance remains the unchanged `plan.md` section 20 gate.

## 11. Agent handoff response

After a planned or focused commit, report:

```text
Task: <P7-xx — title, or focused fix>
Branch: phase-7-presentation-portability
Hash: <commit hash>
Parent: <parent hash>
Changed: <files/modules>
Proved: <observable behavior and actual boundary>
Checks: <exact commands with PASS/FAIL/UNRUN; verifier mode>
Schema/API: <source migration, routes, Swagger, or none>
Document/export: <convergence/remap/semantic fixture/XML/dimensions or not applicable>
Database/socket: <capture/race/lease/denial; real/mocked or exact database deferral>
Browser/UI: <independent sessions/build/viewport/file/offline or UNRUN (deferred by user)>
Security/account/recovery: <scoping, no fetch/execution, sync truth, pending graph preserved>
Evidence: <path and deferred command inventory>
Risks: <known gaps, inherited statuses, binding blockers>
Next: <next sequential P7 task or full exit proof still needed>
```

The response describes committed state. The next contributor checks the named hash is HEAD
before continuing. A completed handoff does not authorize push/merge/deployment/migrations or
resume browser/database verification. This planning request itself produces only this guide;
no task commits, branches, evidence artifacts, or implementation changes are made by writing it.

## 12. Technical references

- [plan.md](plan.md), sections 4.7–4.9, 5–14, 15–20 and M07 — governing product/data/security/gate contracts.
- [phase7.md](phase7.md) — Phase 7 scope, twelve task dependencies, acceptance, and handoff.
- [guide5.md](guide5.md) — reference single-branch, commit-by-commit format for Phase 6.
- [Verification policy](docs/verification-policy.md) — database timing, independent browser pause,
  evidence labels, and consolidated final verification.
- [Phase 3 audit](docs/phase-3-identity-boards.md) — identity, permissions, lifecycle, and creation foundation.
- [Phase 4 audit](docs/phase-4-collaboration.md) — room/durability/access foundations and OPEN findings.
- [Phase 5 audit](docs/phase-5-offline.md) — account/offline/recovery lifecycle and OPEN evidence.
- [Phase 6 audit](docs/phase-6-discussion-sharing.md) — invalidation/query integration and discussion/access exclusions.
- [Phase 2 audit](docs/phase-2-editor.md) — independent editor/performance acceptance.
- [Root instructions](AGENTS.md), [frontend instructions](apps/web/AGENTS.md), and
  [API instructions](apps/api/AGENTS.md) — workspace and application conventions.
- Current source/manifests/lockfile — actual modules, script names, exact dependency pins,
  source migration definitions, and nearest tests.

Library references in `plan.md` describe available mechanisms. Archboard's committed capture,
authorization, lease/follow semantics, strict portability, account recovery, and evidence gate
come from the governing project documents. Reuse those contracts without inventing weaker
substitutes or treating library capabilities as proof of integrated product behavior.
