# Archboard Phase 8 — Commit-by-Commit Implementation Guide

Version: 1.0<br>
Date: 2 October 2026<br>
Status: Closed for amended personal/portfolio scope; original production release OPEN<br>
Governing documents: `plan.md` version 1.1 and `phase8.md` version 1.0<br>
Branch policy: one long-lived Phase 8 branch for the entire milestone

## 1. Purpose

The user's later instruction supersedes the remaining sequential execution for this
phase: finish the personal/portfolio scope, record a scoped P8-13 closure and merge
locally to main. [The closure amendment](docs/phase-8-closure.md) records the task
dispositions. P8-08 and P8-10–P8-12 remain deferred, and the original production
release audit/acceptance below is not claimed passed. No verification pause resumes.

This guide turns Phase 8 release hardening into thirteen bounded, reviewable tasks and planned
commits. It specifies branch workflow, owned paths, implementation boundaries, checks, evidence,
and handoffs. The outcome is an accessible, measured, bounded product with reproducible operating
and backup procedures, consolidated A01–A30 proof, and an honest Version 1 release decision.

Authority order is the user's latest written instruction, `plan.md`, `phase8.md`, then this
guide. Record the exact conflict and evidence before changing a contract. Routine file/helper
names follow the current tree; domain commands, field-level merging, local durability, committed
ACKs, current authorization, lifetime receipts, singleton fencing, inert exports, and account
isolation remain intact.

Writing this guide does not implement features, create a branch, commit changes, start services,
run acceptance, apply configured migrations, deploy, or publish. Actual implementation and
operational actions require their existing or subsequent authorization. Do not infer those
permissions from the illustrative workflow or commands in this document.

M08 consumes the M05–M07 implementations and M00–M04 foundations. Read the current Phase 2–7
audits and Phase 6/7 verification inventories. Historical PASS remains scoped to its recorded
build; inherited OPEN gates and failures do not close when hardening code lands. Phase 8 owns
their release-wide reconciliation. Mandatory Version 1 work cannot move to an unnamed later
milestone to make the release gate pass.

## 2. Fixed implementation decisions

### 2.1 One branch and one planned commit per task

Use one branch named:

```text
phase-8-release-hardening
```

Create it once from the approved integration baseline containing M05–M07 and their consumed
foundations, after `phase8.md` and this guide are committed or included in an approved planning
commit. Record the base hash, planning-document versions, runtime/lockfile baseline, and
inherited audit statuses in P8-01 evidence. Inspect an existing branch before switching;
preserve unknown user changes and never force-create/reset a branch to match this guide.

P8-01–P8-10 are implementation tasks. P8-11 is consolidated database/fault/restore verification
after the implementation-complete trigger. P8-12 is browser/manual/performance verification
after explicit browser resumption. P8-13 is the release audit. Planned commits normally land in
that order, with focused fixes before their dependents. Do not create an empty acceptance commit
or claim verification merely to maintain the diagrammed sequence.

Use one planned commit per task plus justified focused fixes. Only one contributor edits/commits
the shared branch at a time and leaves a committed handoff. There are no parallel commit waves,
per-task worktrees, or cherry-pick assembly in this workflow. Remote push, merge, rebase, deployment,
production migrations, OAuth-account changes, and user-data deletion require separate instruction.

### 2.2 Sources of truth and package boundaries

```text
Y.Doc / domain commands -> authored graph/steps and supported local undo
IndexedDB / outbox      -> atomic local updates and durable pending upload queue
PostgreSQL              -> committed graph, metadata/access/comments/checkpoints, receipts
Room queue / workers    -> isolated validation, serialized commit, bounded transient work
Dedicated DB lock       -> one collaboration-capable Nest process for the deployment
Room memory             -> presence, drag previews, presenter lease; no durable graph writes
Local UI / Query        -> participant viewport/preferences and scoped REST views
Export / fixtures       -> pure portability and seeded workloads/templates
Service worker          -> versioned static shell; approved account caching remains separate
Compose / Caddy         -> same-origin production package, one Nest process, PostgreSQL
Evidence inventory      -> implemented scope, current proof, historical proof, open requirements
```

React Flow renders the shared projection; do not introduce a second editable graph/step store.
`contracts`, `document-model`, and `export` import neither React nor Nest; `sync-client` has no
React dependency. Reuse feature/platform providers, permission services, initialization/remapping,
local durability, queue/worker interfaces, UI primitives, and test helpers before adding another
path. Repair inherited imports at their owner layer without relaxing the boundary checker.

Metadata, author/session/access records remain outside the CRDT. Selection, camera, following,
and presenter traffic do not create graph updates, receipts, timestamps, sequences, or outbox
entries. JSON/checkpoint projections are derived read/copy formats, never whole-board live saves.
`/demo` stays isolated and local-only with truthful labels.

### 2.3 Implementation completion and the two verification conditions

The [verification policy](docs/verification-policy.md) applies to every task, including baseline
checks and diagnostics. Before all M00–M08 implementation is complete, do not run PostgreSQL/Neon
integration, database-backed HTTP/auth/session/socket tests, schema/migration inspections,
verification readiness probes, DB performance, restore drills, or aggregates with DB children.
Prepare the tests and tools, then record **UNRUN (deferred by user — until Version 1 implementation
is complete)**. A Node runner or `--non-browser` name does not remove that restriction.

Browser checks remain independently paused until the user explicitly resumes them. Do not run
Playwright, native browser suites, served previews, browser performance/accessibility sessions,
`pnpm test`, `pnpm test:browser`, `pnpm phase4:quick`, or browser-running phase verifiers. Prepare
their harnesses/procedures and record **UNRUN (deferred by user)**. Combined DB/browser cases wait
for both conditions. Finishing P8-10 or passing database checks does not resume browsers.

During implementation, run database-free/non-browser formatting, lint, types, builds, boundary
checks, public/evidence scans, and focused unit/Node suites. Inspect their children by source
before execution. Tests using in-memory adapters support application rules but do not prove
transactions, committed ACKs, socket authority, process crashes, or browser persistence.

P8-10 records a complete M00–M08 implementation inventory: required capabilities, source changes,
tests/harnesses, fixture setup, packaging, backup mechanisms/runbooks, documentation, verifier
modes, and initial OPEN audit must exist. Missing mandatory implementation blocks the trigger.
Unexecuted acceptance alone does not: P8-11/P8-12 are verification stages, not product work that
must run before the database pause can end. Correct any uncovered implementation gap first.

Once that inventory establishes all implementation deliverables, proceed to consolidated
database verification under existing task authorization. Verify isolated targets and migration
permissions separately. No intermediate P8 completion unlocks it. Preserve OPEN browser/manual/
performance rows until their own conditions are met, and report implementation completion
separately from Version 1 release acceptance.

### 2.4 Inherited findings and evidence freshness

P8-01 must recover the actual current deferred inventories and original build boundaries, including:

- Phase 7's historical 24 PASS / 1 FAIL / 14 UNRUN implementation report, 628 passing tests,
  and 32 inherited boundary findings. These are audit observations, not a fresh guide check.
- Phase 2's recorded pan p95 83.3 ms versus 32 ms and missing spoken screen-reader proof;
  Phase 4's recorded visibility p95 4,876 ms versus 500 ms. Node timing cannot replace them.
- Current configured retention-migration uncertainty; source alignment and isolated migrations
  are separate from configured state, which is inspected only after implementation completion.
- Literal kill, writer-lock-loss, worker timeout/causal gap, protected presence fanout, pending
  edit preservation, account/worker/cache, and current real role/session regressions.
- Phase 7's A16–A18/A21 gaps and three required reviewed evidence rows: combined A10/A22/A24
  recovery, A18 host/image limits and cleanup, and A28/template keyboard/legibility/spoken checks.

Do not rewrite historical results or treat a focused follow-up as blanket closure of its parent
audit. Tie each repair to its owner, violation, and current regression proof. Binding authority,
ordering, preservation, schema, isolation, and capacity failures block dependent acceptance.
Broader performance/manual gaps remain visible even while implementation proceeds.

### 2.5 Keyboard, focus, themes, and canvas access

Reuse the frontend's established Tailwind/shadcn/theme primitives and read its nested instructions.
Provide named, reachable controls, visible focus, associated labels/errors, useful focus return,
modal focus handling, and status text that does not rely on color. Coalesce announcements instead
of speaking every cursor frame, remote keystroke, or ACK. Honor reduced motion for nonessential
transitions and presenter movement.

A28 needs a keyboard route through board creation, palette/canvas selection, card editing,
connection, presentation, and related dialogs. Add an alternate connection form selecting source/
target nodes and fixed handles through existing commands; no mandatory pointer drag. Support
keyboard geometry/selection paths and step reorder alternatives without bypassing graph validation.
Shortcuts do not intercept native typing; presentation left/right/Escape obeys the documented scope.

Cover owner/editor/viewer, archived, offline, demo, empty, pending, and recovery states. Check
light/dark/system contrast, text zoom, panel collapse, and narrow-screen read/present behavior
with a desktop editing message. Mobile authoring stays deferred. Actual keyboard/focus/contrast/
spoken screen-reader observations await browser resumption; source labels alone are not A28 PASS.

### 2.6 Central limits, admission, and performance budgets

Use shared constants and governing field limits; the checklist below must not become a separate
locally maintained validation policy.

| Area                    | Required budget                                                            |
| ----------------------- | -------------------------------------------------------------------------- |
| Live graph              | 500 nodes, 1,000 edges, 50 boundaries, 50 steps                            |
| Accepted encoded state  | 10 MiB/board including hidden/tombstoned history                           |
| One client update       | 1 MiB decoded; reject before document decoding/apply                       |
| Encoded WS frame        | 16 MiB maximum; full ready state remains bounded                           |
| Connections/rooms       | 10 connections/board; 20 active rooms/process; `ROOM_FULL`/`SERVER_BUSY`   |
| Content/presence rate   | Content 20/sec/connection sustained, burst 40; separate presence 15/sec    |
| Worker validation       | 2 seconds/update, at most 2 concurrent workers/process, bounded queue      |
| Comment/checkpoint caps | 2,000 threads/board, 500 messages/thread, 100 checkpoints/board            |
| Owned boards            | 100 active boards/user; archived storage remains budgeted                  |
| JSON import             | 5 MiB UTF-8, strict whole-file validation                                  |
| PNG output              | 8,192 pixels/side and 32 megapixels maximum; 1×/2× choices                 |
| Typical pan/drag        | 200 nodes/400 edges on recorded reference laptop; p95 frame time ≤32 ms    |
| Cached board opening    | Cached 200-node board interactive within 2 seconds on reference hardware   |
| Durable collaboration   | Same-region staging, 5 users, 100 ms simulated RTT; p95 visibility ≤500 ms |

Enforce encoded/decoded/request budgets before expensive work and the entire accepted candidate
after isolated application. Hidden content counts. Bound worker backlog, room admission, fanout,
import parsing/depth, and image allocation; refuse excess safely while legitimate/unrelated work
progresses. Use authoritative rate timing and compatible session/board abuse controls without
silently changing the published per-connection budgets. Transactional resource caps need race
proof. Temporary rate/admission failures preserve IDs/bytes and causal backoff order.

Reuse seeded typical, limit, history, all-kind, template, and hostile fixtures. Typical is 200
nodes/400 edges; graph limit is 500/1,000/50/50. Test text/count/history budgets independently;
all field maxima combined need not fit within 10 MiB. Record seed, fixture hash, counts, text and
encoded sizes, warm-up, sample count, timestamp definitions, percentile calculation, hardware,
versions, region/origins/network shaping, and build hash.

Frame/opening measurements require real rendered interaction; durable visibility ends at peer
application after commit, not local optimism or socket receipt. Record local persistence, queue,
worker, commit, ACK, delivery and render stages where available with sanitized IDs/timing only.
Profile from historical evidence and allowed CPU checks during the pauses; actual browser/DB
workloads await their conditions. Never shrink fixtures, skip validation, fake save labels, or
reset history to meet budgets. Missing same-region staging is UNRUN, not localhost PASS. A budget
change requires an evidenced explicit amendment to the governing specification.

### 2.7 Security, privacy, cache, and preservation

Serve frontend/auth/REST/WS under one HTTPS origin with trusted-origin checks, production secure
HttpOnly cookies, auth-library CSRF protections, and WS upgrade Origin validation. Current sessions,
roles and archive state govern reads/writes/fanout. Nonmembers get scoped 404; known insufficient
roles get 403. Retain 30-second session reevaluation/local revocation and presenter lease rules.
Do not grant authority from cache, imported metadata, or a hidden/disabled control.

Keep all card/comment/import text inert. No eval/raw HTML/SQL execution/remote preview fetch;
preserve strict keys/versions/IDs/references and controlled SVG escaping/primitives with no
scripts, remote resources or `foreignObject`. PNG bounds precede allocation and all export
resources release on success/failure/cancel/unmount. Full recovery JSON includes pending and
in-memory content; above-import-cap exports remain complete with an explicit reimport warning.

Secrets remain backend-only. Public bundles/workers/maps where shipped, exports, logs, backups,
and evidence cannot expose cookies, OAuth data, database/session/GitHub secrets, token hashes,
invitation tokens/URLs, emails, snippets, or comment bodies. Sanitize application and Caddy logs,
not just controller output. Use synthetic scan fixtures and do not persist raw sensitive test
failures. Invitation pages use `Referrer-Policy: no-referrer`.

CSP must fit bundled workers/editor/assets/export URLs through documented scoped allowances.
Do not disable policy or add external runtime dependencies to make the shell work. Authenticated
REST/auth/checkpoint responses stay outside generic HTTP/service-worker caches. Approved local
metadata/threads/graph are account-scoped and labeled; late results cannot cross namespaces.
SPA fallback handles app routes, not API/auth/WS/health/static errors.

Network loss, quota/storage errors, revocation/archive, sign-out/account switch, tabs, eviction,
worker updates, and request uncertainty preserve pending bytes and original namespace. Never
delete a rejected update and send its dependents or clear caches to make a test pass. Existing
destructive reset/reload flows retain explicit preservation choices and warnings.

### 2.8 Operational package, writer ownership, and shutdown

Use Docker Compose/Caddy, exactly one Nest process, and PostgreSQL as selected in `plan.md`.
Package the production Vite build, pinned runtime/lockfile, same-origin routes/WS upgrades,
database volume, protected configuration, and documented OAuth callbacks. No public PostgreSQL
port by default, multiple collaboration workers/replicas, implicit paid provider, Redis, or
horizontal ownership substitution. Examples contain placeholders; frontend build variables
never carry backend secrets.

Source/build/configuration validation is allowed; starting the stack for DB/readiness/load/
shutdown/backup verification waits for complete M00–M08 implementation. Actual remote deployment
is separate. Migrations remain explicit target-verified operations, never schema synchronization
or automatic destructive repair.

`/health/live` is process health; `/health/ready` requires database connectivity, compatible
schema, singleton ownership and write admission. A competing writer cannot become ready. Losing
the dedicated advisory-lock connection immediately stops writes and terminates the process.
Serialize access/archive/checkpoint/snapshot and graph operations with established DB lock order.

Shutdown becomes unready, stops admission, finishes/aborts queued transactions within a documented
finite interval, closes sockets for reconnect, terminates workers, and releases the writer lock
after admission stops. No uncommitted ACK or aborted-candidate broadcast. Literal process kill,
lock loss, termination, restart and retry need real final DB/process proof.

Provide safe structured logs/minimal metrics for writes/ACKs, rejects, reconnects, rooms/sockets,
workers/backlog/timeouts, snapshot/compaction, denied post-access writes, readiness and backups.
Avoid content and unbounded object metric labels. Document upgrade/schema compatibility and
rollback limits; reverting an image does not revert DB schema or authorize clearing local state.

### 2.9 Daily backups and isolated restoration

Implement a repeatable PostgreSQL-consistent backup mechanism and runbook. Cover auth/access,
metadata/discussion/invites, snapshot plus post-snapshot updates, board-lifetime receipts, and
immutable checkpoints. Compaction retains receipts and checkpoints; backups must preserve their
relationships. Browser caches and exported diagrams are not server backups.

Hosted releases require a daily schedule. Document ownership, retention/storage budget, protected
destination/access, encryption where applicable, checksums, completion/failure signals, commands,
recovery-point coverage, and measured restore duration without invented uptime/RPO/RTO guarantees.
Do not copy a live database volume as logical consistency proof, publish backup data, or introduce
S3/paid storage as an implicit requirement.

Prepare A29 synthetic relationships/hashes/sequences. After implementation completion, verify a
disposable destination, back up and restore consistently, restart under isolated singleton
ownership, and check reconstructed graph, latest/through sequence, access, comments, immutable
checkpoint and original receipt retry. Browser reopening waits for browser resumption. Document
older-backup state/receipt/session rollback and newer local pending edits honestly. Cleanup only
verified disposable resources; never overwrite the source or remove production volumes.

Local release proof includes the mechanism and isolated drill. Hosted operation additionally
needs the running daily schedule; an unexecuted schedule remains UNRUN at that boundary. Writing
the runbook does not prove either restoration or production backup execution.

## 3. Single-branch execution contract

Before P8-01:

1. Read governing documents, the full verification policy, root instructions, current Phase 2–7
   audits/verification inventories, and applicable web/API instructions.
2. Inspect `git status`, current branch/HEAD, integration ancestry, manifests/lockfile, contracts,
   limits, package boundaries, nearest feature tests, worker/queue/lock services, host/cache and
   operational surfaces. Preserve unexplained user work.
3. Record baseline hash and inherited findings. Review migrations/configuration by source;
   do not query configured state, readiness or activity during the database pause.
4. Ensure planning documents are committed/included in an approved planning commit and create
   or safely reuse the Phase 8 branch only under implementation authorization.
5. Select allowed baseline checks by source and record inherited failures. Never launch paused
   children to establish a baseline or turn a unit/build pass into release acceptance.

Before each task, confirm the previous planned/fix commit is HEAD, inspect unexplained changes,
read dependencies and nearest source/tests, state owned paths/non-goals, and check the applicable
verification stage. Stay in scope except justified integration files. No task prompt files are
needed unless requested. File paths below describe ownership; discover current equivalents
before creating proposed `ops` or test directories.

Before each commit:

1. Review the complete diff and stage only intended task changes; preserve unrelated work.
2. Run relevant allowed formatting/lint/types/builds, focused units/scans and changed-contract/
   lifecycle regressions. Record baseline failures without weakening tests or checkers.
3. Prepare real DB/socket/browser regressions during implementation; execute them only when
   their conditions hold. After fixes, rerun affected permitted checks rather than unrelated
   full aggregates.
4. Write `docs/evidence/phase8/P8-xx.md` with actual commands/results, source/build boundary,
   implementation versus acceptance, exact deferred inventory, gaps and next dependency.
5. Commit the planned subject and report actual commit/parent hashes. Evidence does not contain
   its own unknowable final hash; the index maps it later. Never amend solely for self-hash.

P8-13 is audit/documentation only; functional corrections land in their task or a focused fix
before updating the audit. A task handoff can be complete while integrated acceptance stays OPEN.
Never reset unknown work, clear shared/user data, fabricate sessions/results, or skip failures.

## 4. Branch and commit policy

The normal linear history is:

```text
approved M05–M07 integration baseline with M00–M04 foundations and planning documents
  -> P8-01 -> P8-02 -> P8-03 -> P8-04 -> P8-05
  -> P8-06 -> P8-07 -> P8-08 -> P8-09 -> P8-10
  -> implementation-complete inventory and verified isolated DB target
  -> P8-11 -> explicit browser resumption -> P8-12
  -> final focused fixes/reproof, if any -> P8-13
```

P8-10 includes an initial OPEN audit/status inventory so documentation does not become a circular
prerequisite to final verification. If browsers remain paused after P8-11, stop before P8-12 and
handoff its recoverable inventory. Do not manufacture a P8-12 commit, continue to browser checks,
or call the release PASS.

`phase8.md` permits P8-13 to publish an OPEN audit before verification is available. Prefer the
P8-10 initial audit and focused documentation updates until the normal final P8-13. If an explicit
interim P8-13 handoff is requested, record its early position/reason, leave P8-11/P8-12 pending,
and later add evidence/audit update commits on the same branch. Preserve task IDs and original
history; no fake acceptance commits, renumbering, cherry-pick assembly, or rewritten reports.

Tests/evidence accompany each behavior, not only P8-10. Genuine shared/schema gaps belong to
P8-02 with their implementing owner; rate/security/ops gaps stay in P8-05–P8-08. Swagger/config
examples accompany relevant runtime changes. No applied migration is edited to repair history.

A defect found before landing is corrected within the task or a separately documented focused
fix where useful. A later discovery gets `fix(<scope>): ...` before dependent acceptance. Do not
squash/amend/rebase/rewrite or merge a new baseline without user direction. Record its effect on
prior proof. P8-11/P8-12 verification evidence must reflect final repaired sources and artifacts.

## 5. Canonical repository commands

Inspect scripts/configuration before selecting commands. By P8-10 add `phase8:verify` with
implementation, non-browser, and full modes using established verifier patterns. These names
are planned until implemented. Shared checks should run once within an aggregate, and earlier
case reuse must retain coverage without repeatedly executing equivalent suites.

| Command or check                                                                              | Execution condition and meaning                                                         |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                              | Dependency setup only when required                                                     |
| `pnpm format:check`                                                                           | Formatting; use focused formatting for documentation-only tasks                         |
| `pnpm lint` / `pnpm typecheck`                                                                | Code/strict TypeScript checks without DB/browser children                               |
| `pnpm --filter @archboard/api test -- <suite>`                                                | Discovered concrete database-free Node suite only                                       |
| Explicit Node-only contracts/model/export/fixtures/web policy suites                          | Inspect project/config and actual children; record concrete commands                    |
| `pnpm --filter @archboard/web build`                                                          | Production frontend build, no served browser acceptance                                 |
| `pnpm --filter @archboard/api build` / `pnpm build`                                           | Changed API/workspace production builds                                                 |
| `pnpm boundary:check`                                                                         | Package ownership plus negative fixtures; fix imports without weakening it              |
| Public/evidence/cache scans and safe config/script checks                                     | Supporting static proof, no readiness or database probes                                |
| `pnpm phase8:verify --implementation`                                                         | By P8-10; database-free/browser-free, deferred rows UNRUN, release OPEN                 |
| `pnpm test:integration` / `pnpm --filter @archboard/api test:integration`                     | Only after all M00–M08 implementation, using verified isolated targets                  |
| `pnpm auth:schema:check` / `pnpm db:migration:show`                                           | Final database pass; configured target checks distinct from isolated migrations         |
| `pnpm phase5:verify --non-browser` through `pnpm phase7:verify --non-browser`                 | DB children; final pass only; inspect actual modes/coverage before reuse                |
| `pnpm phase8:verify --non-browser`                                                            | After complete inventory; real DB/session/socket/fault/restore, no browser children     |
| Direct DB/process/load/backup/restore wrappers                                                | Same DB completion condition; no bypass through Node/Docker/read-only labels            |
| `pnpm test` / `pnpm test:browser`                                                             | Browser pause: **UNRUN (deferred by user)**                                             |
| `pnpm --filter @archboard/sync-client test`                                                   | Browser suite; same pause                                                               |
| Full `pnpm phase1:verify` through `pnpm phase8:verify`                                        | Inspect children; browser-running modes need resumption and DB children need completion |
| `pnpm phase4:quick` / `pnpm phase4:verify:legacy`                                             | Browser-running; same pause                                                             |
| `pnpm phase2:measure`, served previews, manual/screen-reader and browser performance sessions | Inspect measurement children; browser work waits for explicit resumption                |

Use `pnpm.cmd` where the Windows shell requires it; evidence records the exact invoked command.
The `<suite>` placeholder must be replaced with an inspected database-free selection. `test`,
`--non-browser`, Node/Jest wrappers, Docker commands, and running health checks can contain paused
work. Do not run them merely to discover their effects. Existing `phase7:verify --implementation`
can support inherited checks after inspecting its children; it cannot certify M08.

Verifier modes must:

- Implementation: avoid loading DB secret files, connecting/probing DBs, or starting browsers;
  report child PASS/FAIL and deferred UNRUN with full acceptance OPEN.
- Non-browser: retain required real DB/auth/session/socket/transaction/fault/restore proof after
  implementation completion; never start browsers or imply manual/frame/opening PASS.
- Full: include all required integrated/browser/host/performance/manual evidence after both
  conditions; fail closed on a required FAIL/UNRUN, missing/unwired case, stale/wrong build,
  absent reviewed artifact, unmet budget, or invalid reviewer input.

All modes propagate child failures and print their actual scope. Sanitized machine-readable
results record exact command/cwd, mode, runtime/hash, counts/duration, fixture/target conditions,
and evidence inputs. Full PASS cannot follow a free-form manual PASS string. No forbidden child
executes just to produce a deferral row. Missing environmental/manual proof uses its actual UNRUN
reason, not the user-deferral label; a failed check is FAIL.

During implementation record database boundaries as **UNRUN (deferred by user — until Version 1
implementation is complete)**. Record browser boundaries as **UNRUN (deferred by user)** until
resumption. Once a check runs, new evidence records its result while retaining older reports.
This planning request needs only document formatting/consistency, no runtime acceptance.

## 6. Commit plan

### P8-01 — Inventory the release baseline and inherited gaps

Commit subject:

```text
docs(phase8): inventory release contracts and inherited gates
```

Depends on: approved M05–M07 integration baseline with M00–M04 foundations and committed/included
Phase 8 planning documents. Earlier deferred acceptance need not pass before implementation.

Read first: `phase8.md` sections 1–5, 13–18; `plan.md` P01–P14, sections 15–20; current Phase 2–7
audits, verification inventories, evidence indexes, manifests/lockfile, limits and actual scripts.

Owned paths: release/source inventory documentation, focused manifest/script/contract review,
`docs/evidence/phase8/P8-01.md`, and evidence index scaffolding; no runtime behavior replacement.

Required work:

- Record actual base/HEAD/branch and environment; distinguish historical observations from
  current source. Map each P01–P14 capability and every A01–A30 to source, test/procedure,
  proof boundary, inherited gaps and owner.
- Inventory accessible canvas/connection/focus paths, fixtures/performance hooks, rate/size/
  cap/admission/worker controls, origin/CSP/cache/log policy, packaging/health/lock/shutdown,
  backup/restore and setup docs. Identify partial/placeholder surfaces explicitly.
- Recover the 32 historical boundary findings, performance misses, migration uncertainty,
  fault/fanout/preservation gaps and missing reviewed Phase 7 rows from original evidence.
- Map shared schemas/limits to UI/API/WS/export, source migrations/entities and Swagger. Record
  gaps without configured migration/auth-schema inspection, readiness probes or DB diagnostics.
- Discover concrete allowed unit/Node commands and exact deferred integration/browser/process/
  manual/performance/restore cases with required fixture/setup. Define the completion inventory.

Non-goals: no behavior fixes, new limits, dependency upgrades, live target queries, served
baseline, test execution against DB, branch rewrite, deployment, or fabricated acceptance.

Checks during implementation: focused document formatting/link/command/source consistency and
inspected allowed baseline checks where meaningful. Record inherited failures; no DB/browser runs.

Completion evidence: usable release/owner/case map, actual script selections, baseline hashes,
separate historical/current states and recoverable deferred commands. Unlocks P8-02.

### P8-02 — Repair dependency boundaries and source contracts

Commit subject:

```text
refactor(architecture): repair release boundaries and contract alignment
```

Depends on: P8-01.

Read first: `phase8.md` sections 3, 5, 7.1, 14.1; boundary checker/negative fixtures, offending
imports, feature module exports, contracts, relevant API/web instructions and source migrations.

Owned paths: offending shared/web/API owner modules and tests, justified contracts/OpenAPI/
forward migration source, boundary evidence and `docs/evidence/phase8/P8-02.md`.

Required work:

- Resolve actual inherited dependency findings through public feature/platform interfaces,
  appropriate providers, browser/Node test separation or shared pure helpers. Preserve allowed
  package directions, DI and meaningful tests; do not whitelist violations or delete fixtures.
- Reconcile strict schemas, enums/limits, responses/errors, Swagger and existing entity/migration
  source for identified gaps. Avoid duplicate DTOs, graph stores or unchecked new write paths.
- Keep transactional service/repository and lock order boundaries intact. Add a forward migration
  only for a demonstrated schema/index gap; never edit an applied migration or enable sync.
- Prepare corresponding real schema/auth/route/permission regressions for final verification.
  Record configured state as uninspected; source alignment proves only source alignment.

Non-goals: no global cleanup beyond release findings, architecture/ORM replacement, configured
migrations, dependency refresh, budget revision, database verification or UI feature expansion.

Checks during implementation: boundary scan with negative fixtures, focused contract/API/Node
regressions, formatting/lint/types, affected app/package builds and allowed source scans.

Completion evidence: actual findings resolved or precise remaining failures, public interfaces
and source decisions documented, checker unchanged in strength, deferred runtime/schema proof
identified. Binding remaining defects keep dependent acceptance OPEN. Unlocks P8-03/P8-04.

### P8-03 — Complete keyboard, focus, and accessible interactions

Commit subject:

```text
feat(web): complete accessible editor and keyboard workflows
```

Depends on: P8-01/P8-02; follows P8-02 in the linear history.

Read first: `phase8.md` section 6 and A28; web instructions, nearest UI primitives, canvas/
inspector selectors/commands, shortcut/text bindings, dialogs, step reorder and role/recovery UI.

Owned paths: web editor/boards/discussion/presentation/portability/auth UI integration, pure
keyboard/state helpers, prepared A28 procedures/harnesses, focused Node checks and P8-03 evidence.

Required work:

- Implement a keyboard path for creating/selecting/editing cards, geometry operations, connection,
  zoom/fit, deletion/restoration, discussion, steps, presentation and exports/dialogs.
- Add source/target/fixed-handle alternate connection UI using existing commands and validation;
  preserve self-loop/endpoint/role/archive constraints. Add keyboard step ordering alternatives.
- Name controls, associate fields/errors, preserve visible focus, modal initial/trapped/returned
  focus, and useful focus after deletion/panel exit. Do not hijack shortcuts while typing.
- Provide understandable permission/save/offline/pending/limit/storage/presenter states and
  coalesced announcements; preserve reduced motion, themes, text zoom and panel collapse.
- Cover viewer/archived/offline/demo and narrow-screen read/present behavior. Prepare full
  keyboard and spoken screen-reader protocol with tool/version and observed-result fields.

Non-goals: no mobile editing, new styling/UI/router system, bypassed command mutations, forced
shared camera, browser execution or release accessibility claim based on source names.

Checks during implementation: Node-only command/shortcut/role/focus-state policy checks where
meaningful, source/lint/types, web build, boundaries and document formatting. Real keyboard,
focus/contrast/screen-reader browser proof is **UNRUN (deferred by user)**.

Completion evidence: required paths implemented and prepared with actual control/procedure
names; static/Node scope separated from deferred rendered A28. Unlocks P8-04 in sequence.

### P8-04 — Prepare workloads and repair measured performance bottlenecks

Commit subject:

```text
perf(editor): bound release rendering and collaboration work
```

Depends on: P8-01/P8-02; follows P8-03 in the linear history.

Read first: `phase8.md` section 7.2–7.3, A26 and inherited performance evidence; fixture exports,
projection/subscriptions/highlighting, local load, transport/worker/queue/commit/fanout paths.

Owned paths: seeded fixture generators, pure model/export workload helpers, web/sync/API
profiling and targeted fixes, measurement harness source, report schema and P8-04 evidence.

Required work:

- Reuse/extend deterministic typical 200-node/400-edge and graph-limit 500/1,000/50/50 fixtures,
  all-kind/templates, text/history and hostile cases. Record seeds/hashes/counts/encoded size;
  test individual cap families without assuming all field maxima fit simultaneously.
- Define frame/open/visibility timestamp boundaries, warm-up/sample/percentile method and
  hardware/browser/region/100 ms RTT conditions before collecting eventual results.
- Add safe stage timing for local persistence, queue/worker, commit/ACK/delivery/render where
  suitable. Separate optimism from durable peer visibility; no content-bearing trace payloads.
- Use historical profiles and permitted CPU/source evidence for targeted subscription/projection/
  layout/highlighting/scheduling/transfer/fanout improvements. Keep caches bounded/scoped and
  commit final geometry without flooding transient drags. Record hypotheses requiring later proof.
- Prepare repeatable real frame, cached-open, five-user and limit/admission harnesses. Preserve
  inherited failures and classify supporting CPU measurements honestly.

Non-goals: no running browser/DB benchmarks during pauses, smaller acceptance workload, weakened
validation/ACK/durability, reset history, implicit target revision or invented latency claims.

Checks during implementation: Node-only fixture/model/export/profiling logic and affected
regressions, lint/types/builds/boundaries. Browser/DB/same-region performance evidence remains UNRUN
at its own boundary; a CPU benchmark is not A26 acceptance.

Completion evidence: workloads/method and targeted changes reproducible, invariants unchanged,
exact deferred measurements and known misses retained. Unlocks P8-05.

### P8-05 — Enforce bounded rates, sizes, admission, and validation

Commit subject:

```text
feat(collaboration): enforce bounded release admission and validation
```

Depends on: P8-02/P8-04.

Read first: `phase8.md` sections 7.1, 8.3, 12 and A23/A30; shared limits/errors, production
WS adapter, complete-candidate worker/wrapper, queue/rooms/rates, cap transactions and client recovery.

Owned paths: contracts/API collaboration/resource cap services, sync recovery/admission policies,
web limit states, justified export allocation safeguards, negatives and P8-05 evidence.

Required work:

- Enforce frame/base64/decoded/request limits before expensive work and complete-candidate
  stored/history/count/text limits before commit. Retain causally complete pinned-Yjs fail-closed
  validation, including unknown dependency shape, hidden content and pending delete sets.
- Bound workers to two, timeout to two seconds, backlog and fanout; terminate timed-out work
  and discard stale results. Room/connection admission returns safe documented temporary codes.
- Enforce sustained/burst content and separate presence budgets with authoritative timing;
  document compatible board/session abuse controls, identity scope and retry semantics.
- Keep resource caps transactional and tests for concurrent admission/creation/checkpoint/comment
  wins. UI reports limits without silently truncating graph/text/history or clearing pending bytes.
- Preserve temporary backoff and permanent-recovery distinctions, exact update IDs/bytes and
  causal order. Prepare overload/fairness and next-legitimate-update A23/A30 assertions.

Non-goals: no published budget changes, accepting into live room before validation, partial
candidate commit, receipt deletion, dropping failed queue dependencies or live load during pause.

Checks during implementation: clock/rate/admission/size/worker-policy units with fake adapters,
contract/causal-wrapper negatives, recovery units, types/builds/boundaries. Actual socket/worker/
transaction/race/fairness enforcement is deferred until final DB/browser conditions.

Completion evidence: central enforcement map and strict boundary cases, accepted-state and
responsiveness assertions prepared; mocks labeled. Unlocks P8-06.

### P8-06 — Harden security, privacy, cache isolation, and recovery

Commit subject:

```text
fix(security): harden release privacy and pending-work recovery
```

Depends on: P8-02/P8-03/P8-05.

Read first: `phase8.md` section 8 and A10/A11/A18/A22/A24/A25/A27; existing auth/origin/access
fanout, CSP/referrer/cache/log policy, worker/update/account lifecycle, export and recovery flows.

Owned paths: API auth/permissions/transport/privacy, web and sync account/cache/recovery,
safe scans/header configuration helpers, relevant negatives/prepared harnesses and P8-06 evidence.

Required work:

- Reconcile trusted origins, same-origin production cookie/auth/WS rules, current role/session/
  archive reads/writes/fanout and scoped denial. Preserve immediate revocation and periodic checks.
- Preserve inert graph/comment/code/import text and controlled SVG/PNG; prepare malicious payload
  tests for actual no-execution/no-fetch/CSP and allocation/cleanup/file-byte boundaries.
- Implement scoped CSP/referrer and generic protected-response cache exclusions; keep app-route
  fallback distinct from API/auth/WS/health/static errors. Coordinate actual host files with P8-07.
- Sanitize application/evidence output and define proxy token-path redaction. Scan public artifacts
  and synthetic evidence for backend secrets/tokens/bodies; never persist raw failure dumps.
- Finish combined storage/quota/revocation/archive/account/tabs/eviction/worker-update/uncertainty
  preservation. Complete JSON exports and above-import-cap warning remain available; late results
  cannot cross namespaces or restore stale consent. Retain explicit destructive reset choices.
- Prepare real negative/fanout/cache and combined served preservation cases, including the missing
  Phase 7 A10/A22/A24 and A18 reviewed inputs.

Non-goals: no custom auth scheme, raw HTML execution, unsafe blanket CSP, silent cache clearing,
cross-account uploads, browser/DB verification during pause or real-secret fixtures.

Checks during implementation: in-memory permission/origin/error/state units, strict parser/export
negatives, static cache/public/evidence scans, lint/types/builds/boundaries. Real cookies/headers/
fanout/storage/cache/network/browser execution remain explicitly deferred.

Completion evidence: source policy and recovery invariants mapped to prepared integrated cases;
safe scan results and exact remaining boundaries. Unlocks P8-07.

### P8-07 — Package production operations and writer lifecycle

Commit subject:

```text
feat(ops): package single-writer deployment and lifecycle controls
```

Depends on: P8-05/P8-06.

Read first: `phase8.md` section 9; selected Docker Compose/Caddy architecture, actual build/config
and Better Auth handler routing, database writer lock, health/readiness, queue/workers/shutdown.

Owned paths: discovered/new justified Docker/Compose/Caddy/build configuration, API config/
health/lifecycle/log/metric owners, safe environment examples, process test sources and P8-07 evidence.

Required work:

- Package pinned production builds and runtime artifacts, Caddy same-origin static/SPA/API/auth/
  WS/health routing, persistent database storage and documented OAuth/HTTPS configuration.
- Protect secrets and logs, avoid default public DB exposure, preserve auth handler/cookies,
  and prohibit multiple Nest replicas/workers. Do not auto-apply repair migrations or enable sync.
- Implement safe configuration validation and liveness/readiness for DB/schema/singleton/write
  admission, with no sensitive details. Dedicated-lock loss disables writes immediately and exits.
- Implement bounded shutdown: unready/stop admission, finish/abort transactions, close sockets,
  stop workers, release lock in safe order; durable retry handles commit-before-ACK termination.
- Expose safe structured timings/counters and operator actions for admission, latency, rejects,
  compaction, lock/readiness and backup failures. Document compatibility/upgrade/rollback limits.
- Prepare running-package/direct-route/host-header, literal kill/lock-loss/shutdown/restart tests.
  Verify Compose/Caddy syntax statically without starting DB services during implementation.

Non-goals: no remote deployment, domain/OAuth-account creation, paid monitoring, Redis/Kubernetes/
horizontal scaling, configured migrations, running-stack readiness/load verification during pause.

Checks during implementation: static config/script checks, production app/workspace builds,
safe config/lifecycle/metric units, secret scans and boundaries. Real package/DB/process/header/
browser acceptance remains deferred; a built image or source config alone does not prove readiness.

Completion evidence: reproducible files/commands and safe defaults, finite shutdown policy,
one-writer invariants and exact prepared process/host proof. Unlocks P8-08.

### P8-08 — Implement backups and isolated restore procedures

Commit subject:

```text
feat(ops): add daily backups and isolated restore tooling
```

Depends on: P8-07.

Read first: `phase8.md` section 10 and A29; actual database/auth schema source, snapshots/updates/
receipts/checkpoints, deployed-volume plan, tool/config secret handling and fixture generators.

Owned paths: justified operational backup/restore scripts/config, runbook, synthetic A29 fixture/
integration harness source, safe script checks and P8-08 evidence.

Required work:

- Implement PostgreSQL-consistent backup and target-verified isolated restore commands, complete
  table/relationship coverage, hosted daily schedule and observable success/failure.
- Document ownership, protected destination/credentials, retention/storage/encryption policy where
  applicable, checksum, recovery-point coverage, restore duration fields and safe cleanup scope.
- Prepare synthetic board/access/comment/invite/snapshot/log/checkpoint/receipt fixture and
  expected content hashes/sequences/relationships. Include delayed duplicate retry after restart.
- Build guardrails against source overwrite, public artifact placement and cross-environment
  connections. Document older-backup receipt/session/state rollback and newer local pending work.
- Prepare real backup/restore/restart checks now; separate database consistency from authenticated
  browser reopening and hosted schedule observations.

Non-goals: no backup/restore/readiness DB execution before complete implementation, source data
overwrite, production-volume deletion, paid storage/account setup, browser cache as backup,
or invented production schedule/RPO/RTO evidence.

Checks during implementation: script syntax/source/config/fixture tests without DB connections,
lint/types/builds as affected, document formatting and secret/path checks. Actual backup/drill is
**UNRUN (deferred by user — until Version 1 implementation is complete)**; browser reopen is
**UNRUN (deferred by user)**.

Completion evidence: mechanism/runbook and recoverable A29 harness exist; every operation names
target/scope and proof boundary. Hosted schedule execution remains separately unclaimed. Unlocks P8-09.

### P8-09 — Complete setup, operating, and product documentation

Commit subject:

```text
docs(release): document setup operations and recovery workflows
```

Depends on: P8-03–P8-08 with earlier contract/inventory evidence.

Read first: `phase8.md` section 11, `plan.md` section 20, actual scripts/routes/config examples,
Swagger, operational package, backup/recovery and preceding task evidence.

Owned paths: README, local/OAuth/env/migration/deployment/operations/backup/product guidance,
safe examples, truthful demo/case-study script and P8-09 evidence.

Required work:

- Document pinned prerequisites, frozen setup/build/start, explicit target-verified migrations,
  PostgreSQL configuration, GitHub OAuth callback/scopes/secrets, development/production origins,
  and local-only demo. Placeholders never masquerade as configured credentials or hosted URLs.
- Provide single-instance same-origin operation, storage/limits, health/readiness, observability,
  shutdown/lock loss, upgrades/rollback and daily backup/isolated restore instructions.
- Explain local versus committed save states, offline/cache/permission restrictions, preservation,
  immutable checkpoints/restoration, export/image limits, templates and keyboard shortcuts.
- Prepare the five-minute two-profile/offline/reconnect/delete/checkpoint/presentation/export
  script and engineering viewer-denial/durable-retry walkthrough. Distinguish library work from
  the project's domain/protocol/access/outbox/recovery/portability implementation.
- Reconcile commands/env/API/schema docs by source and identify deferred clean-setup/demo/runtime
  proof. No fabricated screenshots, metrics, uptime, adoption or readiness claims.

Non-goals: no publication/deployment, account creation, product fixes disguised as docs, running
DB/browser setup verification during pause, or required paid local services.

Checks during implementation: focused formatting/local links, command/config/API/source agreement,
safe example scans and evidence history/status review. Real clean setup and demonstration proof
wait for their conditions; no broad tests for document-only changes.

Completion evidence: coherent reproducible guidance, unchanged contracts and honest unverified
observations. Unlocks P8-10.

### P8-10 — Assemble consolidated acceptance and inventory implementation completion

Commit subject:

```text
test(phase8): assemble release verification and completion inventory
```

Depends on: P8-03–P8-09 and all earlier fixes/evidence.

Read first: `phase8.md` sections 13–18, every earlier deferred inventory, phase verifier/check-plan
and evidence validators, real DB/process and served browser fixtures, verification policy.

Owned paths: `scripts/phase8-verify.mjs` and established check-plan/report helpers, root script
registration, verifier meta-tests, prepared integration/process/browser/manual/performance cases,
`docs/phase8-verification.md`, initial `docs/phase-8-release-hardening.md`, P8-10 evidence/index.

Required work:

- Map every P01–P14 and A01–A30 plus security/fault/ops/manual/performance boundary to a meaningful
  executable case or reviewed procedure, exact expected assertion, setup/target and evidence.
  Reuse earlier cases without losing current-role/candidate/receipt/recovery coverage.
- Complete all required harness sources and fixture setup, including real process-kill/lock-loss/
  shutdown, isolated restore, five-user timing, connection/cap/load and missing reviewed Phase 7 rows.
- Add fail-propagating implementation/non-browser/full modes, sanitized child reports and validated
  reviewer/artifact/build inputs. Required missing/deferred/failing rows keep full mode nonpassing.
  Partial success must show its scope and release OPEN; no forbidden child runs to produce UNRUN.
- Meta-test mode scheduling, no DB env/probes or browsers in implementation mode, no browsers in
  non-browser mode, failure propagation, secret-safe reports and missing/stale manual evidence.
- Run allowed implementation mode, record actual failures, fix binding implementation defects
  without suppressing them, and inventory every M00–M08 product/test/package/runbook/doc deliverable.
- Publish the initial OPEN audit/checklist. If implementation is complete, record that exact
  source boundary and unlock P8-11; if any implementation is missing, list it and repair first.
  Acceptance UNRUN alone is not a missing implementation deliverable.

Non-goals: no DB acceptance before completion inventory, full/browser execution before resumption,
release PASS from implementation mode, skipped tests labeled passing, undocumented budget revision,
deployment or configured migration permission.

Checks during implementation: `pnpm phase8:verify --implementation` once wired, meta-tests and
relevant allowed regressions/builds/scans. No repeated broad runs after unchanged passing sources.
Final DB mode and browser/full mode remain UNRUN at this task's recorded pre-trigger boundary.

Completion evidence: recoverable full coverage, honest allowed child results and initial audit;
explicit complete/missing M00–M08 inventory with no circular verification prerequisite. Unlocks
P8-11 only when the entire implementation is present, not merely because this task was named complete.

### P8-11 — Verify real database, process faults, and isolated restore

Commit subject:

```text
test(phase8): record final database fault and restore verification
```

Depends on: all M00–M08 implementation complete, including P8-10 inventory and required fixes.
Database verification now resumes under the shared policy; browser verification remains independent.

Read first: `phase8.md` sections 9–10, 14.3, 15, 17; actual completion inventory, all deferred DB
commands, target setup, forward migration/auth schema and fault/restore safety/runbooks.

Owned paths: focused real API/auth/session/socket/transaction/fault/restore tests and synthetic
fixtures, justified owner-layer repairs or prior focused fixes, reports and P8-11 evidence/index.

Required work:

- Confirm implementation trigger and safely verify a disposable PostgreSQL target before any
  migration/write/fault/cleanup. Prefer separate local PostgreSQL where compatible; include only
  necessary deployment-specific checks. Apply migrations only under existing authorization.
- Run consolidated DB integration/current session/HTTP/socket/role/fanout/order/cap/idempotency/
  rollback/lease/checkpoint/private-copy/receipt/compaction/causal-gap/worker/admission regressions.
- Inspect configured migration/auth-schema compatibility separately from isolated migrated schemas;
  establish current lifetime receipt retention. Never confuse historical configured state with proof.
- Run literal commit-before-ACK kill, failed transaction, compaction death, second writer/lock loss,
  bounded shutdown/restart and next-legitimate-update tests with actual stored bytes/sequences.
- Execute safe isolated backup/restore/restart assertions for A29 graph/access/checkpoint/receipt
  consistency; record artifact checksum/duration and target identity without private data.
- Repair failures in the owning layer, rebuild as needed and rerun affected real checks. Update
  new evidence with PASS/FAIL rather than perpetuating an expired database user-deferral label.
  Keep combined served/browser portions explicitly UNRUN and full release OPEN.

Non-goals: no nonisolated destructive faults, production migration/deployment implied by this
guide, running browsers, DB-only A26/A28/UI PASS, source backup removal or historical report edits.

Checks now permitted: selected real integration/schema/migration/fault/restore commands and
`pnpm phase8:verify --non-browser` once wired with safe target configuration, plus affected units/
builds/scans. Inspect children and record exact selected commands and actual environment failures.

Completion evidence: repaired current DB/process results tied to final sources/target/versions,
separate configured/isolated schema observations, backup consistency and outstanding browser/
manual/staging requirements. Unlocks P8-12 only after explicit browser resumption.

### P8-12 — Verify served browsers, accessibility, and performance

Commit subject:

```text
test(phase8): record browser accessibility and performance verification
```

Depends on: P8-11 with passing required dependent boundaries and explicit browser resumption.
If either condition is missing, leave this task pending with an OPEN handoff; do not run it.

Read first: `phase8.md` sections 6–8, 10.2, 14.4, 15, 17; served host/fixture setup, A01–A30
coverage, manual input schemas and P8-11 results. Verify any source fixes have current builds.

Owned paths: actual browser/manual/performance harnesses, reviewed synthetic evidence artifacts,
direct owner fixes or prior focused fixes, report validators and P8-12 evidence/index.

Required work:

- Serve the recorded production build through actual host/proxy policy with real independent
  authenticated accounts/profiles, cookies, active worker, offline mode and synthetic DB fixtures.
- Run native and served acceptance for editing/convergence/undo/restore, offline reload/reconnect,
  tabs/locks, account/storage/revocation/eviction/worker updates and pending recovery/export.
- Prove checkpoint/offline-original isolation, private file round trip and fresh IDs, controlled
  SVG/PNG bytes/dimensions/alpha/scale/allocation/cleanup, inert content/no-fetch/CSP, templates,
  direct routes/cache and persistent opt-out following with independent participants.
- Complete A28 keyboard create/edit/connect/present, useful focus/names, themes/contrast/text zoom,
  narrow-screen and spoken screen-reader observations. Validate reviewer/date/build/procedure and
  artifacts for the three missing Phase 7 rows and every additional required manual gate.
- Measure A26 frame ≤32 ms, cached opening ≤2 seconds and durable visibility p95 ≤500 ms under
  the specified reference/fixture/same-region/five-user/100 ms RTT conditions, with sanitized raw
  samples and method. Localhost/Node/ACK-only results cannot replace missing staging proof.
- Complete A29 authenticated reopened restored board/checkpoint, real clean setup and truthful
  demo observations; record hosted schedule evidence only where actual hosted operation exists.
- Fix failures, rebuild and rerun affected database/browser/security/performance checks so final
  proof matches final source. Missing infrastructure/human evidence is UNRUN with actual reason.

Non-goals: no resumed browser work inferred from elapsed time, screenshots as sole proof,
mocked transactions, secret/session dumps, cherry-picked fast samples, fabricated hosted data,
or unilateral contract/budget revision to pass a gate.

Checks now permitted: concrete native/served/manual/performance commands and `pnpm phase8:verify`
full mode after both conditions, with required reviewed inputs. Earlier aggregates are reused
only as needed to retain every assertion; rerun affected checks after fixes, not arbitrary repeats.

Completion evidence: integrated final-build results and reviewed actual observations, all
performance targets satisfied or explicitly amended, remaining FAIL/UNRUN precisely blocking.
Unlocks final P8-13; missing proof still permits an OPEN audit, never release PASS.

### P8-13 — Audit release status and hand off operations

Commit subject:

```text
docs(phase8): record release exit status and operating handoff
```

Depends on: P8-10; final PASS additionally requires P8-11/P8-12 and all focused fixes/reproof.
Normally follows them; an explicitly requested interim OPEN audit follows section 4's exception.

Read first: `phase8.md` sections 16–18 and `plan.md` section 20, all task/fix evidence/history,
implementation inventory, final reports/manual artifacts, operational/docs and inherited audits.

Owned paths: `docs/phase-8-release-hardening.md`, `docs/phase8-verification.md`,
`docs/evidence/phase8/README.md`, P8-13 evidence, status/setup/operating guidance and truthful
documentation amendments. Functional changes require a separate prior fix, not this audit.

Required work:

- Map baseline/planned/fix/verification hashes, actual schema/config/dependency changes, commands,
  counts/timings/versions, modes/targets, build hashes and human reviewer/date/artifact boundaries.
- Reconcile every phase8 deliverable, P01–P14 capability, A01–A30 case and plan section 20 condition
  with current passing proof or explicit FAIL/UNRUN. Keep historical audit records linked/intact.
- Distinguish implementation completion, current fast checks, real configured/isolated DB proof,
  browser/manual/performance acceptance, hosted operation and release status. Partial results or
  an early audit leave full acceptance OPEN with exact pending commands/setup and next condition.
- Hand off package/local/OAuth/config/limit/support documentation, health/shutdown/lock/recovery,
  upgrades/rollback, daily backup/isolated restore, measured performance and real demo material.
- Verify final evidence matches repaired sources/builds; stale artifacts cannot close rows.
  Publish release PASS only when the entire unchanged or explicitly amended gate is satisfied.
- Preserve deployment/migration/publication permission boundaries. A release decision does not
  itself push, merge, publish or deploy, and no future phase receives mandatory unresolved scope.

Non-goals: no functional fixes, migrations, dependency upgrades, test weakening, remote actions,
resuming either verification condition, rewriting old evidence or PASS based on delivered files.

Checks: focused document formatting/link/history/status/command consistency, evidence input
validation and `git status --short`. Reuse valid exact-tree results; rerun affected runtime
checks only when material changes/failures justify them and their execution conditions hold.

Completion evidence: audit/index/history agree, each release row has honest provenance/status,
and the operating handoff or precise OPEN continuation inventory is usable by the next contributor.

## 7. Sequential execution order

| Order | Task  | Why it is next and execution condition                                                  |
| ----- | ----- | --------------------------------------------------------------------------------------- |
| 1     | P8-01 | Inventory capabilities, contracts, owners, inherited findings and deferred cases        |
| 2     | P8-02 | Repair boundaries/source alignment before dependent changes                             |
| 3     | P8-03 | Complete accessible commands/UI and prepare actual A28                                  |
| 4     | P8-04 | Prepare workloads/method and targeted performance changes before load hardening         |
| 5     | P8-05 | Enforce bounded validation, rates, capacity and safe recovery                           |
| 6     | P8-06 | Integrate authority/privacy/host/cache/pending-work safeguards                          |
| 7     | P8-07 | Package same-origin single-writer operation and bounded lifecycle                       |
| 8     | P8-08 | Implement consistent backups and isolated A29 tooling without DB execution              |
| 9     | P8-09 | Complete setup/operator/product/demo documentation from actual implementation           |
| 10    | P8-10 | Wire all acceptance/verifier modes and establish complete M00–M08 implementation        |
| 11    | P8-11 | After completion inventory, execute isolated real DB/process/restore and repair         |
| 12    | P8-12 | After explicit browser resumption and dependencies, run served/manual/performance proof |
| 13    | P8-13 | Audit final proof or an explicitly requested interim OPEN handoff                       |

`phase8.md` defines task dependencies; this guide chooses a compatible linear order. A later
condition cannot be inferred from completing an earlier task. During pauses, hand off implemented
scope and exact pending proof without placeholder acceptance commits. Focused fixes/reproof stay
on the same branch. There is no parallel work or automatic permission to merge/deploy.

## 8. Required evidence format

Each planned task adds `docs/evidence/phase8/P8-xx.md`:

```text
# P8-xx — <title>

Planned commit subject: <exact subject from this guide>
Commit: <mapped in final evidence index; do not amend for self-hash>
Parent: <actual parent before task>
Branch: phase-8-release-hardening
Environment: <OS, Node/pnpm/PostgreSQL/browser/assistive tool, build/source hash or UNRUN>
Stage: <implementation / final database / final browser / interim or final audit>

## Behavior proved
<observable implemented behavior; supporting proof versus integrated acceptance>

## Contracts used
<commands/Y.Text/tombstones, outbox/ACK/receipts, roles, limits, fencing, cache, restore>

## Changed scope
<owned modules and justified integration files>

## Schema, API, and configuration impact
<source migration/OpenAPI/headers/env/package changes or none; configured state separate>

## Commands and results
- `<exact command>` — PASS/FAIL/UNRUN, cwd, duration/counts, mode, versions/hash, target conditions

## Inherited findings
<original audit/build, violated invariant, owner/fix and required current reproof>

## Accessibility evidence
<keyboard/connection/focus/state/contrast/spoken procedure, tool/reviewer/date or deferred>

## Performance and limits evidence
<seed/hash/count/bytes/history, reference hardware/region/RTT, samples/method/metrics or deferred>

## Database, session, socket, and process evidence
<real versus mocked; stored bytes/sequence/receipt/race/fanout/kill/lock/shutdown; target or deferred>

## Browser, host, and cache evidence
<production hash, independent contexts, worker/offline/files/headers/network/storage or deferred>

## Security, account, and recovery evidence
<current authority, inert content, safe scans/logs, pending bytes/namespace/full export preservation>

## Operations, backups, and restoration
<package/schedule policy, isolated destination/checksum/restore duration/consistency or deferred>

## Implementation completion inventory
<M00–M08 delivered/missing, exact source boundary, database trigger met or not>

## Deferred and missing verification inventory
<case IDs, exact user DB/browser labels or actual other reason, concrete commands/fixtures/setup>

## Known gaps and release gate
<remaining FAIL/UNRUN, binding criteria, historical/current proof; OPEN until all required proof>

## Decision or amendment
<none, or exact contract link/evidence/consequences>

## Next task or verification condition
<next sequential P8 task, DB implementation trigger, explicit browser resumption, or handoff>
```

The final index maps planned/fix/interim/final commits to actual hashes and source/evidence
boundaries. Record tests/assertions/case names, not just numeric pass counts. For manual rows
validate procedure/build/artifact/reviewer/date and required observations, rather than accepting
an unstructured PASS string. Missing or stale evidence keeps that acceptance row open.

Use sanitized synthetic artifacts. Do not commit raw secrets, cookies, DB URLs, invitation tokens/
hashes/URLs, emails, private graph/checkpoint/comment/snippet payloads, browser profiles, dumps,
backup files or environment exports. Synthetic exports and timing samples may support proof.
Screenshots corroborate visuals; they cannot replace database, multi-client, worker/storage,
download bytes, performance method or spoken observations.

## 9. Fix commit policy

If a defect is discovered after its planned commit, add a focused fix on the same branch before
dependent acceptance:

```text
fix(<scope>): <specific violated invariant>
```

Record introducing/exposing source boundary, observation, correction, affected cases/results,
and which prior proof becomes stale. Examples:

```text
fix(architecture): consume collaboration through module exports
fix(web): restore focus after closing the connection dialog
fix(collaboration): reject excess worker backlog before candidate decoding
fix(auth): stop protected fanout after local session revocation
fix(ops): stop writes before releasing singleton ownership
fix(backup): retain receipt relationships in isolated restoration
fix(phase8): reject manual evidence from a different production build
```

Do not amend/squash completed tasks, relax boundaries, delete assertions, fabricate manual rows,
or relabel failures as deferrals. Contract/budget conflicts need exact evidence and a targeted
governing amendment before substitution. Preserve the original observation in its audit and
record current reproof separately. Functional fixes never hide in the P8-13 documentation commit.

During implementation prepare DB/browser regressions without execution. After the database
trigger, run affected DB/fault/restore checks; browsers still require resumption. After source
or build changes, rerun the materially affected integrated/performance/manual checks and match
final artifacts. Passing unrelated units does not refresh a stale browser/DB result.

## 10. Phase 8 final gate

Implementation-complete means the inventory establishes all M00–M08 required product code,
tests/harnesses, package, backup mechanisms/runbooks, documentation and verifier interfaces.
It unlocks final DB verification and is recorded at an exact source boundary. It does not prove
acceptance, require prior deferred test execution, or resume browsers.

Full Phase 8/Version 1 acceptance requires:

- P8 tasks/fixes have recorded history and actual evidence; shared contracts/migrations/configured
  schema/API/docs agree and strict types/builds/boundaries/negative fixtures pass.
- P01–P14 work together against PostgreSQL and independent authenticated browsers. All A01–A30
  have current meaningful assertions; earlier implemented or historical proof is not blanket PASS.
- Field/concurrent-text/delete/undo/fresh-ID behavior, local atomic outbox, honest saved states,
  commit-before-ACK/visibility, retained receipts, causal isolation, compaction and checkpoints
  survive real integrated reload/crash/retry/restore.
- Current roles/sessions, comments/invites/archive races, protected fanout and presenter consent/
  expiry enforce authority and preserve pending work without leakage or unauthorized effects.
- Actual offline/direct routes, worker updates, caches, accounts/tabs/storage/eviction/revocation,
  complete recovery exports and controlled SVG/PNG limits/files/cleanup satisfy their UI boundaries.
- A18 establishes inert content/no-fetch at raw API and served execution/network/CSP boundaries,
  with secret-free frontend/log/evidence surfaces and safe origin/cookie/referrer controls.
- A26 meets p95 frame ≤32 ms, cached opening ≤2 seconds, and p95 durable visibility ≤500 ms
  under recorded specified conditions, or an explicit evidenced amendment changes that contract.
  Rates/caps/workers/admission remain enforced while healthy unrelated work progresses.
- A28 has real keyboard create/edit/connect/present, useful names/focus/state/connection alternatives,
  themes/responsive access and spoken screen-reader proof. No static-only accessibility PASS.
- The same-origin Compose/Caddy package, one writer, schema/readiness, lock loss, bounded shutdown/
  restart/upgrade and observability have real current operating evidence.
- A29 isolated backup restore/restart/reopen preserves graph/access/checkpoint/lifetime receipts.
  Local mechanism/drill and actual hosted daily schedule are distinguished; caches are not backups.
- Current unit/integration/browser/security/fault/recovery/production-preview/performance/manual
  requirements pass with exact commands/builds/conditions and validated reviewed evidence.
- Binding inherited blockers and missing reviewed rows are resolved, plan section 20 is reconciled,
  operating/setup documentation is complete, and no fabricated URL/metric/uptime/readiness claim
  appears. Mandatory scope is not deferred to another phase.

If any required row is FAIL/UNRUN, full acceptance stays **OPEN**. Report delivered implementation,
current permitted results and exact next conditions. P8-13 can provide an honest interim handoff;
it cannot substitute for P8-11/P8-12. Partial verifier success, a merge, a valid SVG, a backup script,
or a lifecycle mock does not establish release PASS. Passing acceptance does not authorize push,
merge, configured migrations, publication or deployment.

## 11. Agent handoff response

After each authorized task implementation/verification commit, respond with:

```text
Completed: <P8-ID and title; implementation/verification/audit stage>
Branch: phase-8-release-hardening
Commit: <actual hash>
Parent: <actual parent>
Changed: <main owned modules/config/docs>
Implemented behavior: <observable result>
Checks: <exact selected commands and PASS/FAIL/UNRUN, counts/durations/build>
Database/process/restore: <real results or exact database deferral; safe target boundary>
Browser/manual/performance: <actual served/reviewed conditions or deferred/missing proof>
Security/recovery: <authority/privacy/cache/pending bytes preserved>
Implementation inventory: <complete/missing M00–M08 and whether DB verification is unlocked>
Evidence: <task path, artifacts/index and recoverable pending command inventory>
Release: <OPEN with blockers, or PASS only if all required proof exists>
Risks: <inherited/current findings and practical limits>
Next: <next sequential task and explicit verification condition if required>
```

The response describes committed state, not proposed work. The next contributor verifies the
named hash is HEAD and checks the condition before continuing. An implementation handoff does
not automatically resume browser checks or authorize operational actions. This planning request
produces only `guide7.md`; it creates no branch/task commits/runtime changes/evidence artifacts.

## 12. Technical references

- [plan.md](plan.md), P01–P14, sections 5–18, M08 and section 20 — governing product,
  architecture, limits, failure, acceptance and Version 1 release contracts.
- [phase8.md](phase8.md) — Phase 8 scope, thirteen task dependencies, two-stage verification,
  implementation completion, release gate and operating handoff.
- [guide6.md](guide6.md) — reference single-branch commit-by-commit format for Phase 7.
- [Verification policy](docs/verification-policy.md) — database timing, independent browser pause,
  evidence labels and consolidated final verification.
- [Phase 2 audit](docs/phase-2-editor.md) — editor, pan/keyboard and historical performance gaps.
- [Phase 3 audit](docs/phase-3-identity-boards.md) — identity/permissions/lifecycle proof boundary.
- [Phase 4 audit](docs/phase-4-collaboration.md) — durability/worker/receipt/fencing/fault findings.
- [Phase 5 audit](docs/phase-5-offline.md) — account/offline/cache/recovery/update boundaries.
- [Phase 6 audit](docs/phase-6-discussion-sharing.md) and
  [verification inventory](docs/phase6-verification.md) — authority/discussion/invalidation cases.
- [Phase 7 audit](docs/phase-7-presentation-portability.md) and
  [verification inventory](docs/phase7-verification.md) — presentation/portability gaps,
  inherited boundary failures and missing reviewed evidence inputs.
- [Root instructions](AGENTS.md), [frontend instructions](apps/web/AGENTS.md), and
  [API instructions](apps/api/AGENTS.md) — workspace/application conventions.
- Current source/manifests/lockfile and nearest tests — actual providers, script/config names,
  exact pins, migration sources, host/worker policy and operational tool availability.

Library references in `plan.md` describe available mechanisms. Archboard's persistence, authority,
fencing, recovery, portability, limits, operating guarantees and release gate are project contracts;
library capabilities or prepared harnesses do not prove those boundaries. Any deployment/provider
configuration and external operational work remain separately authorized.
