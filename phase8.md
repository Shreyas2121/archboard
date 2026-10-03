# Archboard — Phase 8: Release Hardening

Version: 1.0<br>
Date: 2 October 2026<br>
Status: Closed for amended personal/portfolio scope; original production release OPEN<br>
Governing specification: `plan.md` version 1.1<br>
Prerequisites: M05 offline product completion, M06 discussion/sharing, and M07 presentation/
portability implementations, plus their M00–M04 foundations. Read the current Phase 2–7 audits,
the Phase 6/7 verification inventories, and `docs/verification-policy.md` before deriving tasks.

## 1. Purpose and authority

The user's later instruction closes this phase for personal diagramming and a
recruiter portfolio, following P8-01–P8-07 and P8-09, with a scoped P8-13 audit and
local merge to main. [The closure amendment](docs/phase-8-closure.md) governs that
current scope. Remaining production work is explicitly deferred, not delivered;
the original release criteria below remain OPEN and verification pauses remain.

This document defines milestone M08: release-wide accessibility, measured performance,
consistent rate/size limits, security and recovery hardening, operational packaging,
backup/restore, documentation, and consolidated acceptance. It completes the implementation
and evidence needed for `plan.md` section 20; it does not introduce another product milestone
to which required Version 1 work can be deferred.

`plan.md` is the product and architecture authority. This file translates M08 into bounded
work, dependencies, observable evidence, and an exit gate. In a conflict, follow the user's
latest written instruction, then `plan.md`, then this document, then implementation details.
MUST means required for Phase 8. Product features marked DEFERRED in `plan.md` remain excluded
from Version 1. Deferred verification means required proof awaiting its execution condition;
it is not a feature exclusion or an acceptance waiver.

This document is planning only. It does not authorize implementation, applying configured
migrations, altering existing data, deployment, paid services, account creation, or publication.
Creating task prompts, runtime changes, audit files, evidence, and verifiers is later work.
No result in this specification claims that the current tree passes a phase or release gate.

### Version 1 implementation verification pause and final verification

Until all required M00–M08 capabilities and implementation deliverables are implemented,
defer every database-dependent check/test. This includes PostgreSQL/Neon integration,
database-backed HTTP/auth/session/socket tests, migration/schema inspections, readiness
probes or diagnostics used for verification, database performance measurements, and restore
drills. Do not run aggregates with database children, including `--non-browser` modes.

Run database-free, non-browser formatting, lint, types, builds, static/public-bundle scans,
boundary checks, and meaningful unit/Node tests. Prepare database/socket/browser/fault/
performance/restore tests and fixtures without executing deferred children. Record database
boundaries as **UNRUN (deferred by user — until Version 1 implementation is complete)** and
browser boundaries as **UNRUN (deferred by user)**. Follow the
[shared verification policy](docs/verification-policy.md).

Once every M00–M08 implementation deliverable is present, record an explicit implementation
completion inventory and begin consolidated database verification. This trigger does not
require database acceptance to have already passed: tests, harnesses, packaging, and runbooks
must be implemented first, while their database evidence may still be UNRUN. Completing one
P8 task or an earlier phase does not unlock that pass. Fix discovered failures and rerun the
affected checks; implementation completion is not verified release completion.

Browser checks remain independently paused until the user explicitly resumes them, even
after M08 implementation. Do not launch Playwright, native browser tests, served previews,
browser performance/accessibility sessions, `pnpm test`, `pnpm test:browser`,
`pnpm phase4:quick`, or browser-running full verifiers during that pause. Combined tests
requiring both databases and browsers wait for both conditions.

Tasks can land and implementation can finish with honest **OPEN** acceptance gates.
Database-free substitutes never close database/browser acceptance. Preserve historical
results at their original build boundaries; final verification must identify its own tree.

## 2. Phase outcome

A developer can run the complete product locally from documented prerequisites and reproduce
its supported failure cases. A desktop keyboard user can create a board, add/edit/connect
cards, manage discussion and steps, present, and export through named controls with visible
focus and usable alternatives to pointer gestures. Narrow screens support reading/presenting
and explain the desktop editing requirement.

The editor remains within measured interaction/opening budgets on recorded reference hardware.
A five-user session meets the durable-visibility target under the specified network conditions.
Graph/history/transport/capacity limits are enforced consistently; malformed or excessive input
cannot mutate accepted state or monopolize the room/process. Recovery preserves pending local
work, and connection/save states describe actual persistence boundaries.

An operator has a reproducible Docker Compose/Caddy package for the selected single-writer,
same-origin deployment, with secret handling, health/readiness, bounded shutdown, safe logs,
daily database backups, and an isolated restore procedure. The eventual release evidence maps
P01–P14 and A01–A30 to the integrated build. Until required proof exists, report implementation
progress and the exact open release conditions.

## 3. Consumed baseline and open dependencies

| Existing foundation                                         | Phase 8 responsibility                                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Shared contracts, graph schema, commands, limits            | Keep one strict schema/limit authority; reconcile validation, UI, API, export, and documentation           |
| Phase 2 editor and local persistence                        | Complete keyboard/assistive access, interaction profiling, and local durability regressions                |
| Phase 3 identity, lifecycle, permission services            | Verify current-role/session enforcement, creation caps, invite races, and archive ordering                 |
| Phase 4 queue, workers, receipts, snapshots, singleton lock | Harden admission/lifecycle; prove crash, timeout, causal-gap, compaction, and lock-loss behavior           |
| Phase 5 PWA, account namespaces, outbox, recovery           | Prove direct/offline routes, preservation, worker updates, eviction/storage failure, and cache isolation   |
| Phase 6 discussion/sharing and invalidation                 | Complete role/conflict/accessibility/privacy coverage and recover missed invalidations                     |
| Phase 7 steps, lease, checkpoints, portability, templates   | Complete integrated A16–A18/A21 and host/image/recovery/manual evidence                                    |
| Existing phase verifiers and evidence inventories           | Reuse meaningful cases, repair missing evidence inputs, propagate failures, and expose deferred boundaries |

Start with a source inventory and the actual current audits. Do not rebuild completed features
or infer runtime acceptance from routes, DTOs, prepared tests, or a task's delivered status.
Read `apps/web/AGENTS.md` before frontend work and `apps/api/AGENTS.md` before API work. Keep
existing feature/platform boundaries and reuse providers, UI primitives, test helpers, and
fixture generators. Shared packages must retain the dependency rules in `plan.md` section 7.

The current [Phase 7 audit](docs/phase-7-presentation-portability.md) records delivered
P7-01–P7-12 implementation with an OPEN gate. Its historical implementation verifier reported
24 PASS / 1 FAIL / 14 UNRUN, 628 passing tests, and 32 inherited dependency-boundary findings.
Resolve the imports at their owning layers without weakening the checker or removing its
negative fixtures. Those counts describe recorded evidence, not a fresh Phase 8 inspection.

Carry these additional inherited conditions into the Phase 8 inventory:

- Phase 2 recorded pan p95 83.3 ms against the 32 ms budget and missing spoken screen-reader
  evidence. Phase 4 recorded durable visibility p95 4,876 ms against 500 ms. Neither measurement
  can be silently relabeled or replaced by a Node benchmark.
- Configured retention-migration state remains unverified on the current target. Source review
  and isolated test migrations do not prove configured state; inspect it only in final verification.
- Literal process-kill, writer-lock-loss, socket timeout/causal-gap, protected presence fanout,
  and combined pending-edit preservation still require current integrated evidence. Retain
  historical failures and focused fixes from the Phase 4–6 audits separately.
- Phase 7 requires real checkpoint/copy/lease tests and browser file/image/follow/offline proof.
  Its three missing reviewed evidence rows cover combined A10/A22/A24 recovery, A18 host/image
  limits/cleanup, and focused A28/template legibility/keyboard/spoken screen-reader observations.
- Historical Phase 3 PASS is scoped to its recorded build and observations. It does not certify
  the assembled release's OAuth, permissions, session lifecycle, or migrations.

Binding authority, ordering, migration, cache-isolation, preservation, and capacity failures
block their dependent release criteria. M08 owns their resolution and consolidated proof;
earlier audits remain historical records with linked new evidence.

## 4. Scope

### 4.1 Included

- Release-wide keyboard, focus, accessible names/statuses/dialogs, contrast/state communication,
  theme and narrow-screen behavior, and a documented shortcuts policy.
- Deterministic typical/limit/hostile/history fixtures, profiling, targeted optimization, and
  measured interaction, cached opening, durable collaboration, and worker/admission behavior.
- Centralized transport/document/import/image/resource limits, bounded queues/workers, sustained
  and burst rate enforcement, safe retry/admission UX, and raw security-negative coverage.
- Auth/origin/cookie/CSP/referrer/cache/privacy/public-bundle review across frontend, API, WS,
  proxy, service worker, logs, exports, and evidence.
- Docker Compose/Caddy production packaging, pinned builds, same-origin routing, startup
  configuration, schema readiness, singleton lock, bounded graceful shutdown, and upgrades.
- Structured logs/minimal metrics, operator failure guidance, daily database backups, and
  isolated restoration including durable graph/access/checkpoint/receipt data.
- Local/GitHub OAuth/environment/migration/deployment/backup/recovery documentation,
  truthful demonstration/case-study material, A01–A30 consolidation, and release audit.

### 4.2 Excluded

- New capabilities deferred by `plan.md`, including AI, uploads, rich HTML, organizations,
  anonymous public boards, hard deletion, mobile editing, PDF/Mermaid, and automatic layout.
- Horizontal collaboration scaling, distributed room ownership, Kubernetes, a large monitoring
  platform, new cloud-provider commitments, paid accounts, or purchases.
- Architecture replacements, a second editable graph store, whole-board REST saves,
  permissionless demos, destructive cache resets, or reduced acceptance to make gates pass.
- Actual hosted deployment, production migration execution, domain/OAuth-account creation,
  publishing, or remote operations without separate authorization.

## 5. Non-negotiable architecture rules

1. Domain commands are the only local graph mutation path. React Flow and Zustand remain
   adapters/transient state; accessibility and performance work must not bypass commands,
   Y.Text, tombstones, immutable IDs/endpoints, or fresh-ID restoration/remapping.
2. Local update and outbox insertion remain atomic. Server-saved means committed PostgreSQL
   state and durable receipt acknowledgment, never socket receipt, elapsed time, or render.
3. Every accepted update is isolated, causally complete, fully bounded, validated, committed,
   then applied/ACKed/broadcast. Rate/performance shortcuts cannot skip authority or validation.
4. Graph, archive/access writes, checkpoint capture, and snapshot work retain the shared board
   queue and database lock ordering. No post-revocation protected read or post-archive write.
5. Version 1 has exactly one collaboration-capable Nest process, fenced by a dedicated
   PostgreSQL advisory-lock connection. A competing process never becomes ready; lock loss
   disables writes immediately and terminates the process for restart.
6. Update receipts survive compaction for the board's lifetime. Snapshot/log/sequence/receipt
   consistency and immutable checkpoints survive crash, upgrade, backup, and restore.
7. Pending bytes, original account namespaces, and recovery exports survive failures. Never
   delete an unacknowledged queue entry, upload another account's work, or clear caches to
   make a performance/recovery test pass.
8. Session/author/access metadata stay server-owned. Validate current authority on reads,
   updates, and protected fanout; hidden UI controls are not security boundaries.
9. No performance target, hosted URL, uptime, user count, browser compatibility, backup
   coverage, or release-readiness claim appears without evidence at the stated boundary.

## 6. Accessibility and complete product interaction

### 6.1 Keyboard paths and canvas alternatives

Inventory every route and role/state before changing controls. A28 requires keyboard-only
create/edit/connect/present, plus a spoken screen-reader spot check; naming buttons alone
does not satisfy it. Reuse shadcn/ui primitives and the established Tailwind/theme system.

Provide reachable, named controls for card/boundary creation, selection, inspector fields,
geometry operations, deletion/restoration, zoom/fit, discussion, presentation, and portability.
Canvas selection and inspector navigation need an explicit keyboard path. Provide an alternate
connection UI choosing source/target cards and fixed handles with the same domain validation
as pointer connection; users must not have to drag a handle to create an edge. Preserve node
kind/endpoint invariants and explain rejected self-loops or invalid references.

Step ordering requires keyboard alternatives to drag/drop. Presentation uses left/right and
Escape; highlights and notes remain understandable when referenced objects disappear.
Shortcuts must not intercept text-entry behavior in inputs, textareas, code/schema/note
editors, or dialogs. Document pan/zoom modifiers, selection, editing, presentation, and
shortcut scope in the shortcuts dialog and user guidance.

### 6.2 Focus, announcements, states, and visual access

Dialogs have accessible titles/descriptions, predictable initial focus, trapped modal focus,
and focus return. Closing panels or deleting a focused object must leave focus on a useful
control. Pending operations, forbidden states, import conflicts, and recovery/export failures
must be reachable and understandable without color or pointer hover.

Use visible focus, associated labels and field errors, meaningful icon-button names,
and appropriate status announcements. Do not announce every remote keystroke, cursor frame,
or ACK; coalesce changes so collaboration does not overwhelm assistive technology. Convey
save, offline, permission, archive, storage, presenter, and limit states in text as well as color.
Honor reduced-motion preferences for nonessential transitions and presenter movement.

Verify light/dark/system themes, contrast, zoomed text, and panel collapse. Narrow screens
support reading/presenting and an explicit desktop editing message; M08 does not add mobile
authoring. Cover viewer/archived/offline/demo modes as well as the editable live board.

### 6.3 Evidence boundary

Prepare repeatable A28 scripts for the full workflow and role/error states. Record supported
browser/OS/assistive-tool versions, actions, spoken output observations, focus problems, and
fixes. Automated semantic/static or Node-state checks support implementation; rendered
keyboard, visual contrast, and actual screen-reader checks remain deferred during the browser
pause. Complete them after resumption rather than claiming accessibility from source inspection.

## 7. Limits, admission, and measured performance

### 7.1 Central budgets and enforcement

Preserve `plan.md` sections 4, 14, and 16 as the limit authority. The following table is a
release checklist, not a separate set of locally copied constants.

| Area                       | Required budget or behavior                                                            |
| -------------------------- | -------------------------------------------------------------------------------------- |
| Live graph                 | 500 nodes, 1,000 edges, 50 boundaries, 50 steps                                        |
| Encoded accepted Yjs state | 10 MiB/board, including hidden/tombstoned history                                      |
| One client update          | 1 MiB decoded; reject before Yjs decoding/apply                                        |
| WebSocket frame            | 16 MiB encoded maximum; full ready snapshot remains bounded                            |
| Room/process admission     | 10 connections/board with `ROOM_FULL`; 20 active rooms/process with `SERVER_BUSY`      |
| Content/presence           | 20 content updates/sec/connection sustained, burst 40; separate presence budget 15/sec |
| Validation                 | 2-second worker timeout/update, at most 2 concurrent workers/process, bounded queue    |
| Comments                   | 2,000 threads/board, 500 messages/thread; message body maximum 4,000 characters        |
| Checkpoints                | 100/board; clear cap state; deletion remains deferred                                  |
| Owned boards               | 100 active boards/user; archived data still counts toward deployment storage planning  |
| JSON import                | 5 MiB UTF-8, whole-file strict validation before transactional creation                |
| PNG output                 | At most 8,192 pixels/side and 32 megapixels; scope/background and 1×/2× choices        |

Inventory all remaining field, coordinate, URL, and cardinality limits from shared contracts.
Check exact-boundary, below-boundary, and above-boundary cases at UI/REST/WS/export boundaries
where applicable. Enforce request/frame/base64/decoded sizes before expensive document work;
also bound decomposed request overhead, import depth, worker backlog, and fanout work.
Validate all stored content, including tombstoned objects, rather than only visible projection.

Rates must use server-authoritative time/identity and preserve the declared per-connection
content/presence budgets. Apply compatible session/board-level abuse controls so reconnects or
extra sockets cannot make board work unbounded. Record any additional policy and safe error/
retry behavior without silently revising the product budgets. Separate transient presence/
drag/presenter traffic from durable updates. A saturated board must not starve unrelated rooms.

Client recovery distinguishes temporary admission/rate/server failures from permanent document,
schema, authority, and archive failures. Preserve queued bytes and update IDs, use bounded
backoff, and keep causal order. Checkpoint/comment/board caps need transactional race proof,
not a frontend count check. Never trim content or drop history silently to fit a limit.

### 7.2 Fixtures and measurements

Reuse seeded fixtures from `packages/fixtures`; record seeds, hashes, graph counts, text sizes,
encoded document sizes, and history depth. Provide a typical 200-node/400-edge fixture and
limit-size graph fixtures with 500 nodes/1,000 edges/50 boundaries/50 steps. Include all card
kinds, representative text, deletion/history growth, parallel edges, and presentation targets.
Test count limits, text limits, and encoded-state limits independently; every field maximum
combined need not fit within the 10 MiB document budget.

| Measurement             | Required conditions and target                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- |
| Pan/drag frames         | Recorded reference laptop/browser, 200 nodes/400 edges, p95 frame time ≤32 ms                               |
| Cached opening          | Cached 200-node board interactive within 2 seconds on reference hardware                                    |
| Durable edit visibility | Same-region staging, 5 independent users, 100 ms simulated RTT, p95 ≤500 ms                                 |
| Validator/admission     | Typical and hostile/limit payloads; worker/queue/process bounds remain enforced and healthy work progresses |

Define measurement start/end events and percentile computation before collecting data.
Pan/drag evidence comes from real rendered interaction. Cached opening begins at navigation
and ends when locally loaded editing controls can accept work, not when a skeleton appears.
Durable visibility spans the initiating edit through committed acceptance and peer-visible
application; local optimism, ACK alone, or a socket round trip is not peer visibility proof.
Record local-persistence, queue, validator, DB commit, ACK, delivery, and render stages where
available, without including content or secrets. Separate cold/warm and online/offline runs.

Record hardware, OS, Node/browser/PostgreSQL versions, build hash, origins/region, network shaping,
sample count, warm-up, workload, concurrency, raw sanitized samples, p50/p95/max, and variance.
Use a documented repeatable sample count sufficient for p95; do not cherry-pick a short fast run.
Five users prove the named latency workload; separately verify ten-connection and eleven-join
admission behavior. If same-region staging is unavailable, report that target UNRUN; localhost
or Node measurements cannot be relabeled as staging evidence.

### 7.3 Optimization constraints

Profile before optimizing. Target rendering subscriptions, repeated projection/layout work,
text highlighting, worker/candidate transfer, transport scheduling, transaction time, and
fanout bottlenecks as evidence warrants. Bound memoization and caches by board/account lifecycle.
Retain transient drag previews and final durable commits rather than flooding geometry updates.

Do not optimize by skipping complete-candidate checks, weakening save semantics, disabling
presence/steps, reducing the measured fixture, batching away required independent edits, or
resetting live Y.Doc history. A miss requires a fix or an explicit evidenced amendment to
`plan.md` with consequences; the gate remains OPEN until resolved. Database/browser measurements
wait for their execution conditions; CPU-only benchmarks are supporting evidence only.

## 8. Security, privacy, and resource failures

### 8.1 Authentication and untrusted content

Verify same HTTPS origin for frontend/auth/REST/WS, trusted origins, secure HttpOnly production
cookies, auth-library CSRF/origin protection, and WS upgrade Origin validation. Test signed-out,
expired/revoked sessions, owner/editor/viewer, nonmember/cross-board IDs, archived state, role
changes, and long-lived protected fanout. Socket session reevaluation remains at least every
30 seconds with immediate local revocation events; the presenter lease remains 30 seconds.

Public assets, service workers, source maps where shipped, graph exports, logs, and evidence
must exclude backend database/session/GitHub secrets and OAuth/session tokens. OAuth requests
use only identity scopes. Invitation tokens/hashes, token-bearing URLs, emails, cookies,
source snippets, and comment bodies must not enter diagnostic output. Avoid real secrets in
fixtures; use synthetic values and scan the resulting artifacts.

Graph/import/comment/code/schema/note content stays inert text. No raw HTML rendering, eval,
SQL execution, external preview fetch, executable code card, or imported arbitrary Yjs bytes.
Retain strict JSON versions/keys/references/prototype defenses and controlled SVG primitives,
XML escaping, clipping, and no scripts/remote resources/`foreignObject`. Observe actual browser
network/execution behavior for A18 after resumption, including PNG rasterization and cleanup.

### 8.2 Host, cache, and log protection

Implement CSP compatible with the real editor, bundled workers, fonts, styles, and controlled
export URLs. Keep dependencies required by the offline shell local; do not solve CSP failures
by broad unsafe allowances. Document necessary narrowly scoped directives and verify served
headers at the actual proxy/application boundary after checks resume.

Invite pages use `Referrer-Policy: no-referrer`. Redact token path segments and sensitive query
values from Caddy/access/application/error logs, not just controller output. Do not persist raw
failed-test output containing cookies, invite URLs, or bodies in evidence reports.

Authenticated REST/auth/checkpoint responses must not enter generic service-worker/HTTP caches.
Keep approved account-scoped local graph/metadata/thread caching separate, with timestamps and
namespace isolation. SPA fallback never handles API/auth/WS/health/static-file errors. Direct
route and offline shell handling must work without turning an API 404 into cached HTML.

### 8.3 Failure, abuse, and recovery proof

Prepare malformed frames/base64, invalid schemas/fields, hidden oversized content, frame/update/
document limits, causal gaps, worker timeout/crash, saturated queue, excessive joins, and rates.
For A23/A30, prove accepted bytes/sequence/receipts stay unchanged and a subsequent legitimate
update remains usable. Unknown pinned-Yjs dependency shape fails closed; no candidate is first
applied to the live room. A terminated worker cannot later commit a stale result.

Combine authority loss, offline pending graph edits, storage/quota errors, sign-out/account
switch, second tab, and worker update/eviction with recovery. Offer complete local JSON export
even when in-memory content is not persisted; above-import-cap recovery exports remain full and
explain the reimport limitation. Explicit destructive reload/reset requires the existing warning
and preservation choice. Late responses cannot cross accounts or restore stale follow/access.

## 9. Operational package and lifecycle

### 9.1 Reproducible single-origin package

Implement the selected Docker Compose arrangement: Caddy, exactly one Nest process, and
PostgreSQL, with the production Vite build served under the same origin. Reuse the pinned
lockfile/runtime decisions and record build/runtime versions and image identities. Use
reproducible build stages, runtime-only artifacts, documented persistent database volumes,
and a configuration example containing placeholders rather than credentials.

Document same-origin API/auth/WS routing, WS upgrade forwarding/timeouts, SPA deep-route
handling, static asset/cache policy, HTTPS, and GitHub OAuth callback configuration. Ensure
Better Auth retains its handler/body/header ownership. Production builds must not bake backend
secrets into frontend variables. Never expose PostgreSQL publicly by default or scale Nest
workers/replicas through a process manager that defeats the singleton design.

Package creation and static/build inspection are implementation work. Starting the stack for
database verification, readiness, load, shutdown, or backup tests waits for M00–M08 completion;
served-browser checks also require browser resumption. A reviewed Compose file is not a running
deployment proof. Actual remote deployment requires separate authorization.

### 9.2 Startup, readiness, and graceful shutdown

Validate required production configuration with safe actionable errors. Do not automatically
enable TypeORM schema synchronization or run destructive schema repair to make startup succeed.
Migrations are explicit operator steps with target verification and existing authorization.
Readiness must detect schema incompatibility rather than presenting an apparently live editor
whose writes fail later.

`/health/live` indicates process health. `/health/ready` requires database connectivity, compatible
configured schema, singleton ownership, and willingness to accept work. Neither endpoint leaks
credentials, SQL, or board content. A second writer, lock-loss connection, or incompatible schema
cannot become/remain ready. Readiness tests during the database pause remain UNRUN.

On shutdown, stop new joins/writes, become unready, finish or abort queued transactions within a
documented finite interval, close sockets for reconnect, terminate workers, and release the writer
lock after write admission stops. Never ACK uncommitted work or broadcast an aborted candidate.
If commit succeeds before a disconnect, retry returns the original receipt/sequence. Prove lock
loss, literal process death, graceful termination, and restart with real process/database tests;
mock lifecycle hooks alone cannot establish those boundaries.

### 9.3 Updates, rollback, and observability

Document app/schema compatibility, forward migration order, startup failure, rollback limits,
and client/service-worker update handling. A waiting worker does not silently reload pending edits.
Retain compatible assets/cache or an explicit unsupported-state recovery path. Rolling back an
image does not imply rolling back PostgreSQL schema or erasing browser namespaces; avoid pretending
every migration has a safe destructive reverse.

Provide simple structured logs and metrics for request/update IDs, safe actor/board IDs, bytes,
database write and ACK latency, rejected updates by code, reconnects, rooms/sockets, worker queue/
timeouts, snapshot size, compaction duration, and denied writes after access changes. Avoid
unbounded per-object metric labels and content-bearing payloads. Include singleton/readiness,
backup failures, and storage/admission signals with operator guidance. A large telemetry stack
or third-party monitoring account is unnecessary.

## 10. Backups and isolated restore

### 10.1 Backup contract and runbook

A hosted release requires daily database backups and a documented restore drill. Implement a
repeatable backup mechanism/runbook for the selected PostgreSQL deployment, covering auth and
membership data, metadata/comments/invites, Yjs snapshots/update logs, board-lifetime receipts,
and immutable checkpoints consistently. Browser caches and exported JSON are not server backups.

Document schedule, operator ownership, retention/storage budget, protected destination, access
controls, encryption where applicable, completion/failure signals, checksums, and restore commands.
Use PostgreSQL-consistent backup tooling; copying a running volume is not accepted as a logical
consistency proof. Backup artifacts contain sensitive data and must not be committed or placed in
public frontend assets. Do not introduce S3 or a paid backup service as an implicit requirement.

State the daily recovery-point coverage and measured restore time honestly. Do not invent a
stronger uptime/RPO/RTO promise. If the hosted schedule has not run, record that operational
boundary UNRUN; a runbook alone cannot claim daily production backup execution. Local release
proof includes the implemented mechanism and isolated drill; hosted operation additionally
requires the daily schedule. Neither proof requires deploying to a paid provider.

### 10.2 A29 restore drill

Prepare a synthetic fixture containing users/roles, board metadata, comments, invites, committed
snapshot plus post-snapshot updates, retained duplicate receipts, checkpoint, and appropriate
archive state. Record expected sequence/content hashes and relationships without credentials.

After all implementation is complete, verify a disposable isolated destination and restore the
backup there. Never overwrite the source or connect test clients to it by mistake. Record source/
destination identity safely, versions, backup artifact checksum/time, restore duration, schema
state, and restart result. Establish the restored process's singleton ownership for that isolated
deployment. Test reconstructed graph, latest/through sequence consistency, memberships/permissions,
checkpoint immutability, comments, and delayed duplicate retry returning its original receipt.

After browser resumption, reopen the restored board/checkpoint through authenticated UI and
complete A29 end to end. Offline local work newer than the backup remains local pending work;
do not label it server-saved because it exists in a cache. Document the recovery implications of
restoring an older database, including receipt/state rollback, session handling, reconnecting
clients, and prevention of accidental cross-environment writes.

Retain failed drill evidence and fixes. Cleanup only verified disposable resources; removal of
source data, backups, or production volumes is outside this specification's authority.

## 11. Documentation and demonstration

Complete a coherent local setup guide covering pinned prerequisites, frozen installation,
build/start commands, PostgreSQL configuration, explicit migrations, GitHub OAuth app/callback,
environment variables, test target selection, and production versus development cookies/origins.
Document no-sign-in local `/demo` separately from authenticated server boards.

Provide operator guidance for same-origin single-instance deployment, limits/storage planning,
health/readiness, logs/metrics, graceful shutdown, lock loss, upgrades/rollback, daily backup,
isolated restore, and common failure/recovery cases. Explain what is local versus committed,
what offline users can do, cache eviction limits, immutable checkpoint restore-as-new, and
safe portability. Keep shared schema/migration/API/Swagger and user-facing documentation aligned.

Provide a verification guide with real selected commands, environment prerequisites, isolated
database setup, evidence input requirements, deferred-check inventory, and interpretation of
partial-mode results. Documentation must not require paid services for local use. Fresh-checkout
source/configuration review is allowed during implementation; actual setup against PostgreSQL
and production-preview paths waits for the applicable verification conditions.

Prepare the suggested five-minute demonstration from `plan.md` section 20: bundled architecture,
two independent editing profiles, offline reload/edit, independent remote edit, reconnect/save
states, delete-versus-edit, checkpoint, four presentation steps, and export. Include rejected
viewer write and durable retry in the engineering walkthrough. During the pause this is a
script, not claimed demonstration evidence.

Case-study material distinguishes React Flow interaction and Yjs merging from this project's
domain model, permission enforcement, durable protocol, outbox/recovery, presentation, exports,
and proof. Use real screenshots/results only after verification; no fabricated hosted URL,
metrics, uptime, adoption, performance, or readiness claims.

## 12. Failure matrix and required response

| Failure or boundary                               | Required behavior and release proof                                                                   |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Count, text, bytes, history, import, or image cap | Clear limit; accepted state unchanged on rejection; no truncation; full local recovery export         |
| Rate, room, worker, or process saturation         | Bounded work and safe temporary refusal; healthy unrelated work continues; pending queue preserved    |
| Database outage/failed transaction                | No ACK or peer visibility of candidate; local editing/persistence remains truthful                    |
| Crash after commit before ACK                     | Original receipt/sequence on retry; one durable logical effect                                        |
| Crash/kill during compaction                      | Consistent old or new snapshot/log pair; checkpoint and receipt retention                             |
| Invalid or causally incomplete update             | Isolated rejection before commit; recovery preserves causal queue; legitimate room update succeeds    |
| Session expiry, role revocation, archive          | Current authority blocks writes/protected fanout; pending local work has preservation/export path     |
| Account switch, storage failure, cache eviction   | No false saved label or account leakage; explicit preservation/recovery; no silent namespace deletion |
| Presenter disconnect/expiry or local pan          | Local control returns; later frames cannot silently re-enable follow                                  |
| Worker/application/schema upgrade                 | Compatible cached state or explicit unsupported recovery; no silent pending-edit discard              |
| Direct route/API error/cache                      | Correct SPA shell only for application routes; API/auth/checkpoint data not generically cached        |
| Second writer or lock connection lost             | Never ready/accepting writes; existing writer fencing and restart verified                            |
| SIGTERM or shutdown deadline                      | Stop admission, bounded finish/abort, sockets reconnect, no uncommitted ACK                           |
| Backup failure or restore mismatch                | Observable failure; release condition OPEN; repair and repeat isolated drill                          |

This matrix supplements every row in `plan.md` section 17. It does not replace tests or authorize
destructive fault injection against existing user data. Use synthetic isolated test targets.

## 13. Work breakdown

Implement one bounded task at a time in dependency order. Each task records owned modules,
contracts, non-goals, exact checks, and evidence under `docs/evidence/phase8/`. Names below are
planned deliverables, not claims that files/scripts exist. Deriving task prompt files is not
part of writing this specification.

| ID    | Task and primary ownership                                                             | Depends on                                           | Primary output                                                                                                  | Completion evidence                                                                                |
| ----- | -------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| P8-01 | Baseline and release inventory; docs/shared contracts/scripts                          | M05–M07 implementations                              | P01–P14/A01–A30 map, inherited blockers, schemas/limits/commands and deferred inventory                         | Source/contract review with original audit/build links; no database diagnostics                    |
| P8-02 | Dependency and contract repairs; owning shared/API/web layers                          | P8-01                                                | Resolve inherited boundary imports; source schema/API alignment and targeted forward migration only if needed   | Boundary negative fixtures, types/builds, focused units; configured schema proof deferred          |
| P8-03 | Keyboard, focus, and accessible interaction; web features/UI                           | P8-01, P8-02                                         | Complete canvas connection alternative, editor/dialog/step/role/state access, shortcuts/themes/narrow screens   | Source/Node policies; prepared full A28 and spoken screen-reader protocol                          |
| P8-04 | Fixtures, profiling hooks, and targeted performance fixes; fixtures/web/model/sync/API | P8-01, P8-02                                         | Seeded typical/limit/history workloads, reproducible metrics, evidence-based optimizations                      | Pure fixture/model/profiling units; eventual A26 real frame/open/visibility measurements           |
| P8-05 | Rate/size/admission and validator hardening; contracts/API/sync/web/export             | P8-02, P8-04                                         | Central budgets, bounded workers/queues/rooms/rates, safe errors and recovery UI                                | Clock/size/negative units; prepared real cap/race/A23/A30/load tests                               |
| P8-06 | Security/privacy/cache/recovery integration; API/web/sync/scripts                      | P8-02, P8-03, P8-05                                  | Origin/cookie/CSP/referrer/log/cache controls, full preservation paths, public/evidence scans                   | Database-free negatives/scans; prepared real A10/A11/A18/A22/A24/A25/A27 flows                     |
| P8-07 | Packaging, health, shutdown, observability; ops/API/config                             | P8-05, P8-06                                         | Compose/Caddy/build assets, one writer, safe readiness/shutdown/update behavior, logs/metrics                   | Static config/build/lifecycle units; deferred running-stack/lock-loss/kill/shutdown proof          |
| P8-08 | Backup and restore tooling/runbook; ops/docs/test fixtures                             | P8-07                                                | Daily backup mechanism, isolated restore commands, A29 consistency fixture/harness                              | Safe script/config/fixture checks; restore execution deferred until implementation complete        |
| P8-09 | Setup, operating and product guidance; docs/examples                                   | P8-03–P8-08                                          | Local/OAuth/env/migration/deployment/recovery/backup docs and truthful demo/case-study script                   | Source/command/link consistency; real clean setup/demo proof deferred as applicable                |
| P8-10 | Consolidated harness/verifier and implementation inventory; scripts/tests/docs         | P8-03–P8-09                                          | Fail-propagating phase8 modes, all A01–A30, reviewed evidence inputs, M00–M08 implementation checklist          | Database-free verifier/meta-tests; explicit implemented versus missing deliverables and OPEN gates |
| P8-11 | Final database/fault/restore verification and fixes; API/ops/tests/evidence            | All M00–M08 implementation complete, including P8-10 | Current isolated DB/auth/session/socket/migration/crash/backup results and repaired regressions                 | Real database and process proof; browser portions still UNRUN until resumed                        |
| P8-12 | Final browser/manual/performance verification and fixes; web/tests/evidence            | P8-11, explicit browser resumption                   | Independent served-browser A01–A30 coverage, A26 budgets, A28 spoken access, complete A29, reviewed manual rows | Real production-build/worker/offline/file/host/assistive evidence, never substitutes               |
| P8-13 | Release audit and handoff; docs/evidence                                               | P8-10; final PASS additionally requires P8-11/P8-12  | Criterion/evidence matrix, release status, exact blockers, operating handoff                                    | Every criterion linked to current proof or explicit FAIL/UNRUN; section 20 reconciliation          |

P8-11/P8-12 are final verification stages, not missing product implementation that prevents the
P8-10 completion trigger. P8-13 may publish an OPEN audit before those stages are permitted;
update it after actual evidence. No task completion, successful build, merge, or document
presence authorizes deployment or changes an OPEN acceptance gate into PASS.

## 14. Verification requirements

### 14.1 Permitted implementation checks

Run only meaningful database-free, non-browser checks during implementation: strict contracts,
seeded model convergence/remapping, fixture/export negatives, API service units with in-memory
adapters, clock/admission/lifecycle policies, recovery/account generation policies, public/
evidence secret scans, formatting, lint, types, builds, and dependency-boundary negatives.

Inspect selected suites and child scripts. Package `test`, Node wrappers, Docker commands,
syntax-valid browser harnesses, and `--non-browser` labels do not establish database-free behavior.
Do not run an aggregate merely to discover its deferred children. Existing focused source/meta
checks can prove verifier scheduling/failure propagation but cannot prove the product boundary.

### 14.2 Release-wide acceptance inventory

Every acceptance ID in `plan.md` section 18 needs a named executable case or reviewed manual
procedure, exact assertion, environment, and evidence link. Preserve all IDs; none are silently
not applicable in the completed Version 1 scope. Split supporting pure checks from required
integrated proof. The table summarizes required assertions; the governing spec remains authoritative.

| ID  | Required release assertion                                                              | Essential final proof boundary                                     |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| A01 | Create/connect/reload preserves IDs, content, geometry                                  | Authenticated editor and durable reload                            |
| A02 | Independent rename/move both retained                                                   | Replica semantics and real committed collaboration                 |
| A03 | Concurrent text converges without whole-field loss                                      | Y.Text tests and independent editors                               |
| A04 | Concurrent move has one converged position, no wall-clock winner claim                  | Replica exchange and integrated graph                              |
| A05 | Concurrent delete/edit/edge cannot resurrect node/incident edge                         | Tombstones and independent/offline participants                    |
| A06 | Offline reload retains locally committed edits after local-save label                   | Production shell, active worker, real offline/reopen               |
| A07 | Reconnect retains both independent edits and drains queue                               | Independent users, real DB/socket/outbox                           |
| A08 | Kill after commit before ACK returns one original receipt/sequence                      | Literal process fault and stored retry state                       |
| A09 | Failed commit sends no ACK and exposes no candidate to peers                            | Transaction fault and independent sockets                          |
| A10 | Revoked editor's pending queue cannot commit; export offered                            | Current DB authority plus served pending-work recovery             |
| A11 | Raw viewer update and foreign resource IDs denied without leakage                       | Real sessions, forged WS/HTTP, stored state and fanout             |
| A12 | Two tabs have one writer with correct lock transfer                                     | Browser tabs, shared cache, actual lock lifecycle                  |
| A13 | Undo local change preserves remote contribution                                         | Scoped undo and real remote edits                                  |
| A14 | Restore deleted objects uses fresh IDs/internal references; tombstones persist          | Domain restore and rendered/reloaded state                         |
| A15 | Compaction/retry reconstructs graph and returns original receipt                        | Real snapshot/log/receipt transactions and delayed retry           |
| A16 | Immutable checkpoint and isolated restore-as-new                                        | Exact committed capture plus independent offline-original UI       |
| A17 | All-kind JSON round trip is semantic; permissions absent                                | Pure remap plus real file/import/stored private board              |
| A18 | Hostile import/URL/text/XML stays inert or is rejected                                  | Raw API negatives, served execution/network/CSP and export bytes   |
| A19 | Single-use invite race admits exactly one new user                                      | Concurrent real sessions and winning stored state                  |
| A20 | Stale comment edit returns 409 and preserves newer version                              | Real edit races plus rendered conflict/draft handling              |
| A21 | Local pan exits follow across subsequent presenter frames                               | Independent authenticated participants and camera observation      |
| A22 | IndexedDB failure never shows saved; editing pauses/export works                        | Actual failed storage transaction and served recovery              |
| A23 | Invalid/oversized update or worker timeout leaves room usable                           | Real validator/socket/DB isolation and next legitimate update      |
| A24 | Pending-edit account switch offers preservation and isolates cache                      | Independent account namespaces, late responses, storage inspection |
| A25 | Production direct/offline refresh serves correct shell without API caching              | Real proxy/worker/Cache Storage/authenticated routes               |
| A26 | Typical/limit fixtures and five-user results meet section 16                            | Recorded hardware/browser/same-region shaped-network report        |
| A27 | Archive versus in-flight update obeys transaction order                                 | Real row/queue races and absence of post-archive writes            |
| A28 | Keyboard create/edit/connect/present and spoken spot check work                         | Production UI, focus/names/alternate connection and assistive tool |
| A29 | Restored DB restart preserves board/member/checkpoint/receipt consistency               | Isolated backup restore, restart, and authenticated reopen         |
| A30 | Missing causal predecessors rejected; legitimate room works; unknown shape fails closed | Pinned-wrapper negatives and fresh real socket/DB proof            |

Use seeded randomized duplicate/reordered replica delivery as a complement to integrated cases.
Run role/archive/session negatives for relevant graph, comment, invite, checkpoint, presenter,
import/duplicate/template operations. Real PostgreSQL is required for locks, transactions,
rollback, race winners, committed ACKs, receipts, compaction, and restore. Real independent
authenticated browsers/profiles with an active service worker are required for offline and
collaboration UI claims; two components in one tree do not supply that proof.

### 14.3 Consolidated database verification after implementation

Verify the disposable target before writes, migrations, fault injection, or cleanup. Prefer
a separate local PostgreSQL test database where compatible and include genuinely required
Neon-specific checks if the configured deployment depends on them. No new account/provider
commitment is implied. Keep configured migration/auth-schema inspections distinct from isolated
migrated test schemas, and apply migrations only under existing authorization.

Recover the exact deferred command/case lists from every phase audit. Run current integration,
auth/session/socket, authority/fanout, transaction/idempotency/cap, worker/causal-gap, crash/
compaction/lock-loss/shutdown, and isolated backup/restore checks. Confirm the configured retention
migration actually preserves lifetime receipts. A full-state ready, mocked repository, or service
callback does not substitute for committed bytes and real process faults.

Record actual PASS/FAIL/results and repair failures in their owning layers. Do not label a
database/browser-combined row PASS from the database half. Once a check runs, its current outcome
replaces the deferral in new evidence; preserve prior reports. Re-run affected cases after fixes.

### 14.4 Browser, host, manual, and performance verification after resumption

Use a served production build, actual proxy/headers, real cookies/sessions, independent accounts,
active service worker, and network offline mode. Retain build hashes and session-fixture setup
without recording tokens. Run native browser tests and served harnesses, then complete manually
reviewed keyboard/spoken/visual and host/cache/cleanup observations with reproducible procedures.

Complete pending graph export/account/storage/eviction/worker-update/response-loss recovery;
direct editor/checkpoint/invite routes; opt-in presenter behavior; checkpoint/offline isolation;
real SVG/PNG/file bytes, dimensions, alpha/scales, limits and cleanup; templates/demo legibility;
malicious content no-execution/no-fetch; and all role/error UI states. Screenshots support but
do not replace storage/network/stored-state assertions or spoken accessibility observation.

Measure A26 under section 7's conditions and resolve inherited misses. Populate the three Phase 7
reviewed rows and other manual gates using validated inputs tied to the current build/case and
reviewer/date. A free-form PASS string, missing artifact, stale build, or incomplete procedure
must not close a required manual row. Do not clear the browser pause merely because a full
verifier was implemented or a database pass succeeded.

## 15. Required verification commands and verifier modes

Implement a fail-propagating `pnpm phase8:verify` with `--implementation`, `--non-browser`,
and full modes, plus documented machine-readable per-child results and reviewed evidence inputs.
These are future interfaces at specification time; inspect existing phase scripts before reuse.

| Mode               | Permitted children and execution condition                                                                            | Meaning of successful selected checks                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `--implementation` | Database-free/non-browser only; usable throughout implementation; no DB env loading or probes                         | Implementation checks pass; deferred requirements reported UNRUN and release OPEN                   |
| `--non-browser`    | Real database/auth/session/socket/migration/fault/restore plus permitted units; only after all M00–M08 implementation | Database/non-browser subset passes; browser/manual/performance boundaries remain open as applicable |
| Full/default       | All required database, browser, host, manual, performance, restore and regression evidence; waits for both conditions | Full PASS only if every required release row has current passing proof                              |

Partial modes must visibly name their mode, propagate child failures, and never print release
PASS. Full mode fails closed on missing required tests, deferred/absent evidence, wrong build,
failed manual review, or unmet budgets. A missing reviewed row cannot be treated as a skipped
passing test. A verifier must not execute forbidden children merely to generate UNRUN output.

Implementation mode should run shared checks once and select meaningful database-free suites.
Concrete focused Node/API suite names are discovered during P8-01 and recorded in task evidence;
placeholders below are documentation, not executable commands.

```text
pnpm install --frozen-lockfile                     # only when dependency setup requires it
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @archboard/api test -- <selected database-free suites>
<explicit Node-only contracts/model/fixture/export/web policy suites>
pnpm build
pnpm boundary:check
pnpm phase8:verify --implementation                # once implemented
```

Do not run workspace/package test aggregates without checking their children. The current
planning task requires only document consistency and focused formatting checks.

During implementation the following remain **UNRUN (deferred by user — until Version 1
implementation is complete)**. After P8-10's full implementation inventory, run the consolidated
pass against verified isolated targets, including concrete suite/process/restore wrappers.

```text
pnpm test:integration
pnpm --filter @archboard/api test:integration
pnpm auth:schema:check
pnpm db:migration:show
pnpm phase5:verify --non-browser
pnpm phase6:verify --non-browser
pnpm phase7:verify --non-browser
pnpm phase8:verify --non-browser                    # once implemented
<database-backed HTTP/auth/session/socket/worker/cap/transaction wrappers>
<literal process-kill/lock-loss/compaction/shutdown and isolated backup/restore commands>
<configured readiness/schema diagnostics and database performance checks>
```

Avoid redundant re-running of earlier aggregates if phase8 selects the same current cases
directly; retain traceability and every required assertion. Do not assume earlier phase
verifiers implement compatible partial modes. Configured migration execution is an explicit
authorized operation, not an automatic consequence of listing inspection commands here.

The following remain **UNRUN (deferred by user)** until explicit browser resumption:

```text
pnpm test
pnpm test:browser
pnpm --filter @archboard/sync-client test
pnpm phase1:verify
pnpm phase2:verify
pnpm phase3:verify
pnpm phase4:quick
pnpm phase4:verify
pnpm phase4:verify:legacy
pnpm phase5:verify
pnpm phase6:verify
pnpm phase7:verify
pnpm phase8:verify                                 # future full mode
pnpm phase2:measure                                # inspect; browser measurement remains deferred
<served preview/direct-route/offline/file/cache/security/recovery harnesses>
<A26 rendered-frame/cached-opening/five-user measurements and A28 spoken/manual checks>
```

Record exact command, cwd, selected suites, durations, counts, child status, runtime/build/hash,
and target conditions without secrets. Failed checks are FAIL, not a user deferral. Environmental
or missing manual evidence is UNRUN with its actual reason; do not apply the user-deferred label
to unrelated failures. Keep prior failures visible until current fixes have matching proof.

## 16. Deliverables

Phase 8 implementation and eventual acceptance cover:

1. Release inventory for P01–P14 and all A01–A30, inherited gaps, required cases, and complete
   recoverable database/browser/manual command lists.
2. Resolved dependency-boundary findings and source/schema/API consistency with unchanged strict
   checker negatives; any required forward migration documented without claiming configured state.
3. Complete keyboard/focus/status/connection/step/dialog/theme/narrow-screen behavior and actual
   release-wide A28 spoken/keyboard evidence after resumption.
4. Deterministic typical/limit/history/hostile fixtures, profiling hooks, targeted optimizations,
   and honest A26 performance report against the unmodified or explicitly amended budgets.
5. Central rate/size/count/admission controls, bounded validator work, safe capacity/recovery UX,
   and real negative/race/load evidence with accepted-state preservation.
6. Same-origin auth/WS/origin/cookie/CSP/referrer/cache/log/public-artifact safeguards and
   integrated inert-content, authority, account, offline, and pending-work recovery proof.
7. Reproducible Docker Compose/Caddy package, one-writer startup/readiness, bounded shutdown,
   update/rollback guidance, safe structured logs/minimal metrics, and process-fault evidence.
8. Daily backup mechanism/runbook and isolated A29 restore/restart/authenticated-reopen proof,
   preserving graph/access/checkpoint/lifetime receipt consistency.
9. Local/OAuth/env/migration/deployment/backup/recovery/product documentation and truthful
   five-minute demo/engineering/case-study material.
10. Fail-propagating phase8 implementation/non-browser/full modes, reviewed human evidence
    validation, and consolidated current-tree unit/integration/security/fault/browser results.
11. `docs/phase-8-release-hardening.md`, `docs/phase8-verification.md`, and evidence/index under
    `docs/evidence/phase8/`, with implementation completion inventory, final release matrix,
    remaining blockers, and operating handoff.

These audit/evidence/verifier/tooling files are implementation deliverables, not outputs of
writing this specification. Their presence alone cannot establish runtime acceptance.

## 17. Exit gate and Version 1 release decision

M08 implementation is complete when all required M00–M08 product changes, tests/harnesses,
packaging, runbooks, documentation, and verifier interfaces are implemented and inventoried.
This unlocks database final verification under the shared policy. It does not require or imply
prior execution of deferred checks, explicit browser resumption, or release PASS.

Phase 8 and Version 1 release acceptance pass only when:

- P01–P14 work together against PostgreSQL and authenticated independent browsers; every
  A01–A30 has current meaningful proof, including the specified raw negatives and failure cases.
- Shared contracts/limits, migration source and configured schema, API/Swagger, implementation,
  and product/operator documentation agree; required boundaries and negative fixtures pass.
- Local/remote convergence, delete-wins, undo, fresh-ID copying, durable outbox, exact save labels,
  committed ACKs, lifetime receipts, compaction, causal completeness, and immutable checkpoints
  survive the integrated reload/retry/crash/restore scenarios.
- Current sessions/roles, invites, comments, archive/access ordering, lease/follow behavior, and
  protected fanout enforce authority without disclosure or pending-work loss.
- Direct/offline routes, active worker updates, cache exclusions, multi-tab lock transfer,
  storage/eviction/account/revocation recovery, and complete exports have real browser proof.
- A18 establishes inert graph/comment/import/XML content, controlled image output and allocation/
  cleanup bounds, actual CSP/no-fetch behavior, and secret-free public/log/evidence surfaces.
- A26 meets the recorded 32 ms frame, 2-second cached-open, and 500 ms durable-visibility targets
  under their specified conditions, or an explicit evidenced amendment has changed the contract.
  Limits, workers, rate/admission and unrelated-room responsiveness have real enforcement proof.
- A28 proves keyboard-only creation/editing/connection/presentation and spoken screen-reader
  usability, named controls, visible focus, role/error states, and supported responsive access.
- The packaged same-origin production build, health/readiness, singleton ownership, lock loss,
  bounded shutdown/restart, and update/rollback behavior have current operational evidence.
- Daily backup requirements and isolated A29 restoration/reopen are satisfied with safe artifacts
  and documented operation; caches or JSON exports are never claimed as database backup proof.
- Unit, integration, browser, security-negative, crash/recovery, required production-preview,
  manual and performance checks pass with exact commands/builds/conditions and reviewed evidence.
- All binding inherited failures and missing manual rows are resolved or remain visibly blocking;
  no fabricated URL, metrics, uptime, adoption, or production-readiness statements appear.
- Every requirement in `plan.md` section 20 is reconciled with the release matrix and operating
  documentation. Passing M08 does not itself authorize deployment, migration, or publication.

While any required proof is deferred, missing, or failing, report **OPEN** release acceptance
with per-row PASS/FAIL/UNRUN, implemented scope, and the next permitted check. No mock, build,
partial verifier, merge, or planning document can substitute for the specified boundary.
Resolve failures or propose a targeted contract amendment with evidence and consequences.
Do not move mandatory Version 1 work into an unnamed later phase to close the gate.

## 18. Handoff record

Each Phase 8 task report contains:

```text
Task: <P8-ID and title>
Implemented behavior: <observable result; implementation versus acceptance stage>
Changed files/modules: <owned scope>
Contracts used: <commands, persistence/ACK, roles, limits, fencing, caches, restore>
Schema/API/config impact: <source migration, routes, headers, env or none>
Checks run: <exact commands, cwd, selected suites and execution conditions>
Results: <PASS/FAIL/UNRUN, counts, durations, runtime versions and build/source hash>
Inherited findings: <original evidence/build, owning layer, fix and required reproof>
Accessibility evidence: <keyboard/focus/connection/spoken observations or deferred cases>
Performance/limits evidence: <fixtures, hardware, RTT/region, samples, metrics or deferred>
Database/socket/fault evidence: <real versus mocked; stored state, kill/lock/restore results>
Browser/host/cache evidence: <served build, accounts, worker/offline/files/headers or deferred>
Security/recovery evidence: <authority, inert text, secret scans, pending bytes and namespaces>
Operations/backup evidence: <package/lifecycle/schedule/isolated target/checksum/drill or deferred>
Implementation completion inventory: <M00–M08 delivered/missing; DB trigger met or not>
Known gaps and release status: <exact blocking rows; OPEN until required proof passes>
Decision or amendment: <none, or exact link, evidence and consequences>
Next dependency unlocked: <task ID, final verification condition, or operating handoff>
```

The final audit maps every deliverable, P01–P14 capability, A01–A30 case, and section 20 condition
to current passing proof or an explicit failing/unrun boundary. Preserve historical audit links,
source/build hashes, versions, commands, counts/timings, sanitized artifacts, and reviewer/date
for manual rows. Do not rewrite old results to match the current release outcome.

If implementation finishes while browsers remain paused, hand off the completed source and
database results when available, keep the release gate OPEN, and retain the exact browser/manual/
performance inventory for later resumption. A verified release handoff additionally includes
the operating package, setup/deployment constraints, backup/restore and upgrade procedures,
measured limits, known supported environments, and truthful demonstration evidence. Publishing
or deploying that result is a separate authorized action.
