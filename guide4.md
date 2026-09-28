# Archboard Phase 5 — Commit-by-Commit Implementation Guide

Version: 1.0<br>
Date: 28 September 2026<br>
Status: Implementation guide<br>
Governing documents: `plan.md` version 1.1 and `phase5.md` version 1.0<br>
Branch policy: one long-lived Phase 5 branch for the entire milestone

## 1. Purpose

This guide turns Phase 5 offline product completion into eleven small, reviewable commits. It
specifies the branch workflow, owned paths, checks, evidence, and handoffs for an implementing
agent. The outcome is a production-build application shell that opens previously cached boards
offline, preserves locally durable edits, and safely returns to authenticated collaboration.

Authority order is the user's latest written instruction, `plan.md`, `phase5.md`, then this guide.
If these disagree, record the exact conflict and evidence before changing a contract. Routine
internal names may follow the current tree, but cache separation, local/server durability,
account isolation, authorization, and recovery behavior must stay intact.

The [Phase 4 audit](docs/phase-4-collaboration.md) is **OPEN** despite its implemented P4 tasks.
Its visibility target, configured migration, boundary checks, and several fault/browser proofs
remain unresolved. Phase 5 can be implemented on that baseline, but it cannot claim the inherited
gate passed. The independent Phase 2 audit remains open as well.

## 2. Fixed implementation decisions

### 2.1 One branch and one planned commit per task

Use one branch named:

```text
phase-5-offline-product
```

Create it once from the approved Phase 4 integration baseline after `phase5.md` and this guide
are committed or included in an approved planning commit. Record the base hash, audit status, and
unresolved dependencies in P5-01 evidence. P5-01 through P5-11 land in order on this branch. If
it already exists or the working tree contains user changes, inspect and preserve them; do not
force-create the branch or reset files.

This guide does not authorize remote push, merge, rebase, deployment, production migration,
OAuth configuration, or deletion of user data. Follow any later explicit user instruction. If
several contributors take turns, only one edits or commits to the shared branch at a time. The
outgoing contributor leaves a committed, reviewable state and an evidence handoff. No per-task
branches, worktrees, or cherry-pick assembly are part of this guide.

### 2.2 Sources of truth and offline boundary

```text
Service worker  -> versioned static shell and route fallback only
IndexedDB       -> account/board/schema cache, Yjs log, outbox, receipts
Browser Y.Doc   -> editable local graph loaded from committed local data
PostgreSQL      -> accepted graph, board metadata, role, session-backed writes
```

The service worker never owns graph data or chooses an account. It precaches local build assets
and returns the shell for allowlisted navigation paths. It must not cache authenticated REST
responses, OAuth callbacks, invite tokens, or WebSocket traffic. TanStack Query remains the online
REST metadata cache, while explicit account-scoped IndexedDB records drive offline board lists.
React Flow remains a projection of the one Y.Doc; Zustand holds only ephemeral editor state.

Offline graph editing is limited to a previously opened, locally committed, active board under
its last known owner/editor role and a Web Lock. A cached role is a local editing hint, never
authority to upload. The server rechecks the session, current role, and archive state on every
durable write. A cached viewer or archived board is read-only.

### 2.3 Durable edits and truthful save states

Reuse the Phase 4 sync client. A local update and its exact outbox bytes/ID are inserted in one
IndexedDB transaction before the transport sends. Remote updates enter the local log without an
outbox entry. An ACK atomically records its receipt/sequence and removes or marks the matching
outbox entry. A crash before ACK persistence resends the original bytes and ID. Local compaction
does not delete pending work.

The UI may show “Saved on this device” only after local commit and “Saved to server” only after
handshake/hydration and all local updates receive durable ACKs with no recovery error. A browser
`online` event, service-worker cache hit, WebSocket open, or `ready` frame is not a server-save
event. Offline cached copies have unknown remote freshness. Keep the exact labels and conditions
in `plan.md` section 10.4 and `phase5.md` section 8.

### 2.4 App-shell and cache policy

Use Vite PWA integration/Workbox as selected in `plan.md`. Precache the versioned HTML entry and
local JS, CSS, font, icon, and worker assets needed by the editor. Allowlisted navigation
fallbacks include `/`, `/boards`, `/boards/:boardId`, and `/demo` where applicable. A direct
offline refresh must load the shell and then consult local account/board data. A route with no
usable local board data shows an unavailable state rather than an invented graph.

Do not use a broad network-first or cache-first rule for `/api/*`, `/ws/*`, auth callbacks,
invite-token paths, or any user-specific response. Inspect actual Cache Storage after exercising
those requests. Do not fetch essential editor assets from a CDN at runtime. A worker install does
not mean a particular board is cached; show offline readiness only when both shell and board
data are locally available. Cached assets and IndexedDB are best-effort browser storage, not a
backup.

### 2.5 Account, sign-out, and access-change rules

Offline account selection uses only a safe marker from a previously established authenticated
session. It does not prove that the server session is still active. If there is no recognized
local account, show the signed-out/offline state and `/demo`, not a list of all cached users. A
different authenticated user selects only their own origin/user/board/schema namespace. Failed
network auth is not proof of sign-out.

Before a sign-out or account switch hides or clears pending edits, show the affected board count
and explicit preservation choices. Cancel leaves the current session/caches intact; retaining
keeps data under the old account only; recovery export precedes any deliberate clear. If export
fails, keep the data. Never copy pending edits to another user or board automatically. Explain
the device privacy implication of retaining a local copy.

Online sign-out goes through Better Auth. Offline sign-out stops sockets and local authenticated
editing immediately, notifies other tabs, records a local pending invalidation intent without
credentials, and says server invalidation is pending. Before authenticated UI/upload later
resumes, try to resolve that intent when reachable; a still-valid HttpOnly cookie must not
silently restore a supposedly signed-out session. BroadcastChannel is for notices, not graph
writes. One writer per namespace remains enforced by Web Locks.

On server revocation, viewer downgrade, archive, session expiry, unsupported schema, or permanent
validation failure, stop unauthorized sends, freeze editing as appropriate, retain the exact
outbox and graph, and offer recovery export. Never skip a rejected update and send causal
descendants. “Reload server version” remains an explicit exact-namespace clear with warning;
cancel preserves data. Full import/export product controls remain Phase 7.

### 2.6 Application updates and storage failure

A waiting service worker prompts the user. It does not force `skipWaiting`, `clientsClaim`, or
page reload while an editor is active, a local transaction is in flight, or pending work has not
had a safe user-directed transition. The app checks version/schema compatibility before
activation/reopening. Compatible cached code may keep running offline; unsupported new schema
makes the old client read-only with update/export options and retained pending data.

Storage status shows current board cache availability, cache time, committed local state,
pending outbox count, and browser-reported usage/quota if available. These are diagnostic hints,
not guarantees. Quota/IndexedDB failure pauses editing and offers in-memory recovery without a
false save label. Missing or evicted data shows an unavailable state until an authenticated
online fetch is possible. Unsupported Web Locks environments retain read-only/export fallback.

### 2.7 Phase and dependency boundary

Phase 5 completes A06/A07/A10/A22/A24/A25 in an active-service-worker production preview. It
does not implement offline server-board creation or offline REST metadata/comments/invites. Phase
6 owns finished sharing/discussion UX; Phase 7 owns presentation, checkpoints, general
portability, and templates; Phase 8 owns deployment/backup and the release-wide gate. `/demo`
remains a separate local-only namespace.

The current Phase 4 audit lists the collaboration visibility miss, configured unapplied
migration, boundary violations, literal process-kill and lock-loss proofs, socket-level A23/A30,
combined A10, and served storage-error proof. A Phase 5 task may resolve a concrete inherited
defect at its owning layer with focused evidence. It must not silently reclassify an unrun/failing
Phase 4 assertion as a Phase 5 success. The final Phase 5 audit reports the updated status of
each inherited blocker.

### 2.8 Coding, dependencies, and evidence policy

**Temporary browser-check pause (user direction, effective from P5-05):** Do not run native
browser tests, Playwright, served-browser scripts, or aggregate commands that launch Chrome.
This includes `pnpm test`, `pnpm test:browser`, `pnpm phase4:quick`, and full prior-phase
verifiers. Run focused non-browser unit/integration checks, format, lint, types, and builds.
Implement browser harnesses when a task owns them, but leave execution **UNRUN (deferred by
user)**. Do not rerun P5-01 through P5-04 browser regressions during this pause. This
paragraph overrides browser-running instructions in the task checks and command tables below
until the user resumes them. Acceptance criteria remain open, not waived.

Follow `apps/web/AGENTS.md` for Tailwind/shadcn reuse, route composition, accessibility, and
editor ownership. Follow `apps/api/AGENTS.md` when touching API code for a Phase 4 dependency
fix. Reuse existing auth, sync-client, IndexedDB, Web Lock, and recovery modules before creating
new ones. Add the selected PWA/Workbox dependency only in P5-01 at an exact compatible pin and
lockfile update; do not add an alternate router, persistence layer, service-worker framework,
session store, or graph library.

Use synthetic accounts/boards in evidence. Never commit `.env`, credentials, cookies, OAuth
codes, database URLs, invite tokens, private graph bytes, browser profiles, or generated build
output. Browser evidence records the served build hash, URL, browser, service-worker control
state, network condition, Cache Storage/IndexedDB observation, and result. A component render or
synthetic offline flag cannot prove a direct route works offline.

## 3. Single-branch execution contract

Before P5-01:

1. Read `plan.md` sections 4.1, 5–7, 10–11, 16–20, `phase5.md`, this guide, root
   `AGENTS.md`, both application guides, and the Phase 2–4 audits.
2. Inspect the approved base commit, branch, HEAD, status, manifests, existing route/sync/auth
   modules, migrations, and service-worker configuration if any. Preserve user changes.
3. Record Phase 4's OPEN blockers, including the configured migration and package-boundary
   failures, without printing database credentials.
4. Ensure the planning documents are committed or included in an approved planning commit,
   then create/switch to `phase-5-offline-product` safely.
5. Run lightweight baseline checks and record pre-existing failures before editing.

Before each task, confirm the prior planned/fix commit is HEAD, inspect unexplained changes,
read dependency evidence and nearest code/tests, and state the task's non-goals. While working,
stay within owned paths except justified integration files. Use the current frontend component
system and shared contracts; do not introduce mock-only substitutes for required real proofs.

Before each commit:

1. Review the full diff and remove unrelated edits.
2. Run focused checks plus `pnpm lint` and `pnpm typecheck`; if a dependency temporarily blocks
   them, record why and run them at the first possible downstream task.
3. Rerun affected earlier gates after changes to collaboration, auth, persistence, app routing,
   package manifests, service-worker policy, or root scripts.
4. Write `docs/evidence/phase5/P5-xx.md` with exact commands and PASS/FAIL/UNRUN, environment,
   browser/cache conditions, known gaps, and next dependency.
5. Commit using the exact subject below and report commit/parent hashes without amending solely
   to add a self-hash to the evidence file.

Do not reset unknown work, clear a shared/production database, weaken tests, claim a mocked
session or service worker is real, or label Phase 4's OPEN gate as passed without its missing
proof. P5-11 is audit/documentation only; functional fixes land first.

## 4. Branch and commit policy

The planned history is linear:

```text
approved Phase 4 baseline
  -> P5-01 -> P5-02 -> P5-03 -> P5-04 -> P5-05
  -> P5-06 -> P5-07 -> P5-08 -> P5-09 -> P5-10
  -> focused fixes, if any -> P5-11
```

One P5 task is one planned commit. The migration, lockfile update, or script belongs to the first
task that needs it. Evidence belongs with the behavior. Fix a defect found before landing the
task within that task; a defect found later gets a focused `fix(<scope>): ...` commit. Do not
rewrite, squash, amend, rebase, or merge intermediate `main` changes without user direction. If
the base changes, record the integration and rerun affected checks.

## 5. Canonical repository commands

Preserve existing scripts and add stable Phase 5 interfaces by P5-10. These are commands to use
or introduce, not a claim that the proposed Phase 5 command exists now.

| Command                                             | Purpose                                            |
| --------------------------------------------------- | -------------------------------------------------- |
| `pnpm install --frozen-lockfile`                    | Reproduce exact dependency graph                   |
| `pnpm format:check`                                 | Verify formatting                                  |
| `pnpm lint` / `pnpm typecheck`                      | Code and strict TypeScript checks                  |
| `pnpm test` / `pnpm test:browser`                   | Browser-running; temporarily skip                  |
| `pnpm test:integration`                             | Real PostgreSQL/API integration tests              |
| `pnpm auth:schema:check` / `pnpm db:migration:show` | Auth/migration compatibility                       |
| `pnpm --filter @archboard/sync-client test`         | Native browser suite; temporarily skip             |
| `pnpm --filter @archboard/api test:integration`     | Server authority and durable-denial proofs         |
| `pnpm --filter @archboard/web build`                | Typecheck/build the versioned production shell     |
| `pnpm --filter @archboard/api build` / `pnpm build` | API and workspace builds                           |
| `pnpm boundary:check`                               | Enforce shared-package/application boundaries      |
| `pnpm phase1:verify` through `pnpm phase4:verify`   | Browser-running aggregates; temporarily skip       |
| `pnpm phase5:verify`                                | Final aggregate; defer execution if it runs Chrome |

Prepare focused scripts for direct-route offline refresh, cache inspection, revocation, account
switching, worker update, and storage failure, but do not run them during the temporary pause.
Document their names and mark their results UNRUN (deferred by user).
Use a served production build with an active service worker, independent browser contexts, and
isolated migrated PostgreSQL schemas where a server commit/denial is asserted. Stop browser/API
helpers deterministically and do not print credentials.

## 6. Commit plan

### P5-01 — Add the offline application shell and safe cache policy

Commit subject:

```text
feat(web): add offline application shell
```

Depends on: approved Phase 4 baseline and committed Phase 5 planning documents.

Read first: `phase5.md` sections 5–6, 12, 14.1; Vite config, web manifest/assets, router,
production preview setup, CSP, and Phase 4 audit.

Owned paths: `apps/web` Vite/PWA/service-worker configuration and local assets, exact dependency
and lockfile changes, focused browser/cache tests, and `docs/evidence/phase5/P5-01.md`.

Required work:

- Add Vite PWA/Workbox at an exact compatible version and precache the local production shell,
  editor chunks, fonts, icons, and worker scripts.
- Serve the shell on allowlisted direct navigation paths including `/boards` and
  `/boards/:boardId` offline. Keep online direct-route refresh working in production preview.
- Exclude `/api/*`, `/ws/*`, OAuth callbacks, invite tokens, and user-specific responses from
  service-worker caches; avoid a blanket runtime rule.
- Test first install, later controlled navigation, missing asset, and first-visit-offline state.
- Inspect Cache Storage after authenticated requests and confirm no protected response or graph
  content is stored.

Non-goals: no cached account selection, board hydration, sign-out flow, or update prompt.

Required checks: web build, served production-preview service-worker route/cache checks,
`pnpm lint`, `pnpm typecheck`, workspace build.

Completion evidence: active service worker loads the static shell offline at a direct editor
URL; sensitive requests bypass caches; CSP and essential local assets work without a CDN.

### P5-02 — Add account-scoped board cache selection

Commit subject:

```text
feat(sync-client): add account scoped board cache
```

Depends on: P5-01.

Read first: `phase5.md` sections 5, 7, 10; sync-client namespace/`boardCache` modules,
Better Auth session provider, and board metadata contracts.

Owned paths: `packages/sync-client/src/persistence/**` and focused account cache helpers,
frontend session integration only for selecting a safe local account, browser tests, and P5-02
evidence.

Required work:

- Store safe cached board metadata, effective role, archive state, fetch/commit time, local
  availability, and last received server sequence under origin/user/board/schema.
- Keep a safe previously authenticated local account marker separate from session authority;
  select it only when no real current session is available and no pending sign-out forbids reuse.
- After a real session resolves, select that exact user's namespace. Network failure is not a
  definitive signed-out result.
- List only records belonging to the selected account. Treat missing/evicted snapshots as
  unavailable even if metadata remains.
- Prove different accounts and `/demo` cannot enumerate or load one another's records.

Non-goals: no offline dashboard UI, account switch dialog, or implicit auth from cached identity.

Required checks: sync-client native browser tests, auth/session focused checks, web build, lint,
types.

Completion evidence: account namespace isolation, safe cache ages, missing-data state, and no
new graph authority or secret storage.

### P5-03 — Show the cached-only offline dashboard

Commit subject:

```text
feat(web): show cached boards offline
```

Depends on: P5-02.

Read first: `phase5.md` sections 5, 7, 12, 14.2; existing board dashboard, TanStack Query
flow, route error/empty states, and frontend guide.

Owned paths: `apps/web/src/features/boards/**`, board entry route and focused UI helpers,
served-browser evidence, and P5-03 evidence.

Required work:

- Switch to an explicitly labeled cached-only list when the server is unavailable, with each
  record's cache time, role/archive hint, and local document availability.
- Search/filter the local subset without representing it as a complete server list.
- Disable create, rename, archive/restore, duplicate, access, invite, and other REST-only actions
  offline with clear reasons; keep online TanStack Query behavior intact.
- Show first-use empty, unavailable board, stale metadata, auth-network uncertainty, and
  signed-out/offline states accessibly.
- Verify a second account and `/demo` data are absent from the offline list.

Non-goals: no offline metadata writes, background REST caching, or general import/export UI.

Required checks: web build, sync-client browser tests, served offline `/boards` route, lint,
types.

Completion evidence: dashboard direct-route refresh under active service worker shows only the
selected account's cached subset and truthful disabled actions.

### P5-04 — Bootstrap cached editor documents offline

Commit subject:

```text
feat(web): reopen cached boards offline
```

Depends on: P5-01 and P5-02.

Read first: `phase5.md` sections 6, 8, 11, 14.2; board editor route, editor session, sync-client
hydration, Web Lock, and device-save labels.

Owned paths: authenticated editor route/session integration, focused sync-client hydration
fixes, browser failure harness, and P5-04 evidence.

Required work:

- Reload a previously opened direct editor URL offline from the cached shell and local
  snapshot/log; acquire the account/board Web Lock before enabling commands.
- Use last-known owner/editor role for local active-board edits; cached viewers/archived boards
  stay read-only. A second tab stays read-only until safe lock transfer.
- Attach persistence before editing. A device-save label appears only after the update and
  outbox commit; in-memory uncommitted work is not described as reload-safe.
- Show an explicit unavailable state for an uncached board or missing IndexedDB data.
- Prove `/demo` remains local-only and outside authenticated account clearing.

Non-goals: no reconnect convergence proof, offline new board, or service-worker graph cache.

Required checks: sync-client browser tests, web build, A06 served offline direct-route browser
flow, A12 lock regression, lint, types.

Completion evidence: A06 restores exact committed content/geometry and pending bytes after a
close/reopen while offline; no duplicate writer or false save label appears.

### P5-05 — Reconcile offline edits on reconnect

Commit subject:

```text
feat(sync-client): reconcile offline board edits
```

Depends on: P5-04.

Read first: `phase5.md` sections 8–9, 14.2; Phase 4 `ready`, outbox, receipt, reconnect, and
save-state implementation.

Owned paths: focused `packages/sync-client/src/**` reconnect/session changes,
`apps/web` connection state integration, real-browser/API tests, and P5-05 evidence.

Required work:

- Resume a locally committed outbox from an offline reload without new update IDs or altered
  bytes. Merge full server `ready` into the local document before ordered drain.
- Preserve an independent remote edit made while this browser was offline; use Yjs conflict
  rules and tombstone behavior, not whole-board REST saves.
- Persist ACK/sequence and remove the matching entry atomically; reach zero pending changes
  only after durable server ACKs.
- Handle connection loss, auth-network uncertainty, gaps, and retry without reporting server
  save early or overwriting local work.
- Prepare the two-context authenticated browser proof, but defer its execution. Verify the
  committed PostgreSQL result with non-browser integration where feasible.

Non-goals: no revocation dialog, service-worker background sync, or alternate CRDT transport.

Checks during browser pause: real socket/database integration that does not launch a browser,
web/API builds, lint, and types. Mark sync-client browser tests and the served A07 flow
**UNRUN (deferred by user)**.

Completion evidence: both users' independent edits survive, pending count reaches zero after
server commit, and no remote update echoes into the local outbox.

### P5-06 — Recover from changed access and incompatible schema

Commit subject:

```text
feat(web): preserve offline edits after access changes
```

Depends on: P5-05.

Read first: `phase5.md` sections 9–10, 12, 14.2–14.3; Phase 4 recovery download, role/archive
notifications, permission service, and pending Phase 4 A10 proof.

Owned paths: web editor recovery states, focused sync-client access handling, necessary API
test/fix at owning boundary, browser/DB evidence, and P5-06 evidence.

Required work:

- Simulate editor revocation or viewer downgrade while one client holds offline queued bytes.
  On reconnect, prove no queued write commits and freeze old editing while preserving bytes.
- Keep archived-board queues without uploading until owner restore; require server authority
  before resuming any write.
- Distinguish temporary network loss from expired session, denied access, permanent validation,
  and unsupported newer schema. Preserve export and clear next actions for each.
- Keep “Reload server version” an explicit exact-namespace warning/decision; cancellation and
  export failure preserve the queue. Do not auto-copy to another board/user.
- Prepare the combined served-browser, socket, and database A10 proof missing from Phase 4;
  execute non-browser socket/database portions now and leave the browser portion UNRUN.

Non-goals: no general import, finished sharing UX, or offline role administration.

Checks during browser pause: real access/archive integration that does not launch a browser,
web/API builds, lint, types, and non-browser Phase 4 regressions. Mark served A10 and recovery
browser checks **UNRUN (deferred by user)**.

Completion evidence: unchanged server seq/update/receipt after rejected upload; exportable
local graph/outbox; correct archived/session/schema states.

### P5-07 — Make sign-out and account switching safe

Commit subject:

```text
feat(auth): preserve pending edits across account changes
```

Depends on: P5-02 and P5-06.

Read first: `phase5.md` sections 5, 10, 12, 14.3; Better Auth sign-out, query clear,
BroadcastChannel/Web Lock, account namespaces, and recovery export.

Owned paths: frontend auth/session and account-switch UI, focused sync-client cross-tab/pending
sign-out state, browser tests, and P5-07 evidence.

Required work:

- Before sign-out/switch makes pending edits inaccessible, show affected board count and
  cancel/retain/export-before-clear choices. A failed export leaves data untouched.
- Online sign-out uses Better Auth and clears authenticated frontend/query state. Offline
  sign-out stops sockets/editing, records a pending server invalidation intent without a secret,
  and visibly distinguishes local completion from remote revocation.
- Prevent a still-valid HttpOnly cookie from silently resuming authenticated UI/upload before
  the pending sign-out is resolved when connectivity returns.
- Broadcast local sign-out/account-change notices to other tabs without graph messages;
  coordinate writer-lock release and exact-namespace clearing safely.
- Preserve second-account cache isolation and `/demo` independence in implementation and
  non-browser checks; defer the authenticated browser sign-in proof.

Non-goals: no new identity provider, global cache wipe, or automatic account-to-account import.

Checks during browser pause: non-browser auth checks, web build, lint, and types. Mark
auth/sync-client browser tests, browser-backed online sign-out, and the offline/online A24
served flow **UNRUN (deferred by user)**.

Completion evidence: preservation choice is usable; server invalidation status is truthful;
second account cannot enumerate or open old cached content.

### P5-08 — Prompt for safe application updates

Commit subject:

```text
feat(web): defer application updates during editing
```

Depends on: P5-01, P5-04, and P5-07.

Read first: `phase5.md` sections 5, 11–12, 14.3; service-worker lifecycle, route shell,
schema-version contracts, outbox and sign-out state.

Owned paths: PWA registration/update UI, focused web config/worker messaging, browser upgrade
fixtures, and P5-08 evidence.

Required work:

- Detect a waiting worker and prompt rather than forcing activation/reload during active
  editing or an IndexedDB transaction.
- Check pending outbox and compatibility before user-directed update; require a safe
  preserve/export decision if pending work cannot transparently survive.
- Keep the compatible old shell running when offline. For unsupported new graph schema,
  freeze writes, retain outbox, and show update/export state.
- Implement cancel and safe update preservation for the exact account/board namespace and
  pending work; defer the production-preview browser proof through reopening.
- Ensure new static asset cache activation never sweeps account-scoped IndexedDB data.

Non-goals: no automatic schema migration, forced `skipWaiting`, or release deployment.

Checks during browser pause: web build, lint, types, and non-browser update-state checks. Mark
the two-build production-preview worker update test and sync-client browser tests **UNRUN
(deferred by user)**.

Completion evidence: update prompt and old-client paths preserve pending bytes; no forced
reload, namespace clear, or false compatibility claim occurs.

### P5-09 — Show storage health and fail safely

Commit subject:

```text
feat(web): expose local storage recovery state
```

Depends on: P5-04 and P5-06.

Read first: `phase5.md` sections 5, 11–12, 14.3; sync-client failpoints, recovery download,
editor save state, and cached dashboard.

Owned paths: focused storage-status/recovery UI, sync-client failure reporting, browser
fault/eviction tests, and P5-09 evidence.

Required work:

- Show local board availability, cache time, pending count, and browser-reported usage/quota
  when available, with a clear best-effort-storage explanation.
- Implement IndexedDB/quota failure handling during a rendered edit: pause further edits,
  avoid any saved label, and offer in-memory validated recovery export. Defer the rendered
  browser fault injection.
- Show explicit missing/evicted board cache and unsupported Web Locks read-only/export states.
- Ensure a browser that cannot load an offline shell is not represented as a successful offline
  board opening; record that limitation honestly.
- Keep recovery actions keyboard accessible and preserve focus/announcements.

Non-goals: no browser storage guarantee, database backup, or general portability UI.

Checks during browser pause: non-browser storage-state checks, web build, lint, and types. Mark
native sync-client failpoint tests, served A22, and missing-cache/eviction/Web Lock browser
checks **UNRUN (deferred by user)**.

Completion evidence: A22's local write failure retains exportable in-memory content without
claiming durability; unavailable cases show correct state.

### P5-10 — Verify the full offline product boundary

Commit subject:

```text
test(offline): verify offline recovery and cache gates
```

Depends on: P5-03 through P5-09.

Read first: `phase5.md` sections 12–17, all prior P5 evidence, Phase 4 audit, root scripts,
and production preview configuration.

Owned paths: end-to-end offline/cache/security/fault harnesses, root `phase5:verify` script,
focused direct fixes exposed before landing, run documentation, and P5-10 evidence.

Required work:

- Prepare the A06, A07, A10, A22, A24, and A25 served-browser harnesses and evidence matrix.
  Do not execute browser flows during the pause; keep those outcomes UNRUN. Use independent
  authenticated profiles and real PostgreSQL/socket results when browser verification resumes.
- Prepare checks for direct `/boards` and `/boards/:boardId` refresh online and offline,
  first-use and evicted-cache states, account separation, sign-out pending intent, worker
  update, and Cache Storage inspection; defer their browser execution.
- Recheck A12 and affected Phase 4 outbox, ACK, archive, causal-gap, and save-label behavior.
- Review Phase 4's OPEN blockers one by one. Fix inherited defects at their owning layer with
  focused evidence; rerun real proofs. Report any still-failing visibility budget, migration,
  boundary, process-kill/lock-loss, socket A23/A30, combined A10, or storage-error gate as open.
- Add `phase5:verify` with a non-browser mode for the current pause and a later full mode that
  runs browser tests, active-SW checks, and cache inspection. Do not execute full mode until
  the user resumes browser verification; propagate failures from the checks that do run.

Non-goals: no Phase 6/7 features, release deployment, mock-backed gate substitution, or
relaxation of governing performance targets.

Checks during browser pause: clean frozen install, non-browser `phase5:verify` mode, focused
non-browser regressions, and builds. Mark focused browser/cache/fault scripts and the full
`pnpm phase4:verify` **UNRUN (deferred by user)**.

Completion evidence: test matrix links every claim to the actual service worker, browser,
session/socket, database, and local cache boundary. Missing or failed proofs are labeled
FAIL/UNRUN, not converted into pass by the aggregate.

### P5-11 — Audit and hand off Phase 5

Commit subject:

```text
docs(phase5): record offline product evidence and exit status
```

Depends on: P5-01 through P5-10 and every focused Phase 5 fix.

Read first: `phase5.md` sections 16–18, all P5 evidence, Phase 2/4 audits, README, manifests,
lockfile, verifier scripts, migration state, and branch history.

Owned paths: `docs/phase-5-offline.md`, `docs/evidence/phase5/README.md`, evidence metadata
corrections, README command/status update, and approved documentation amendments only.

Required work:

- Record base hash, planned/fix commits, PWA dependency/migration changes, runtime/browser/DB
  matrix, build hash, active worker state, network mode, commands, counts, and timings.
- Link every deliverable/exit criterion to a direct route reload, local data, real auth/socket/DB
  result, cache inspection, fault, accessibility, build, or explicit blocker.
- Record A06/A07/A10/A22/A24/A25 separately with PASS/FAIL/UNRUN and the exact scope of each
  proof. Do not infer offline reload from a client-only test.
- State the current Phase 4 dependency gate and the separate Phase 2 audit status; link any
  focused follow-up evidence without silently marking inherited failures passed.
- Check public bundles, service-worker cache, logs, and evidence for secrets/private content.
- Mark Phase 5 PASS only if its own mandatory gates and binding Phase 4 prerequisites pass;
  otherwise mark OPEN with reproducible next steps.

Non-goals: no functional implementation, dependency changes, test weakening, merge, remote
push, or version 1 release claim. Functional fixes land before this audit commit.

Checks during browser pause: frozen install, non-browser `phase5:verify` mode, auth/migration
state, API/web/workspace builds, and `git status --short`. Mark full `pnpm phase5:verify`
and `pnpm phase4:verify` **UNRUN (deferred by user)**; the audit remains OPEN.

Completion evidence: final audit and evidence index match current code/history and distinguish
measured success from stale, mocked, missing, or failed proof.

## 7. Sequential execution order

| Order | Commit | Why it is next                                       |
| ----- | ------ | ---------------------------------------------------- |
| 1     | P5-01  | Establishes shell and sensitive-request cache policy |
| 2     | P5-02  | Selects the correct local account/board records      |
| 3     | P5-03  | Adds cached dashboard behavior on that model         |
| 4     | P5-04  | Reopens a cached direct editor route offline         |
| 5     | P5-05  | Reconciles queued edits after an offline reload      |
| 6     | P5-06  | Handles changed authority and schema after reconnect |
| 7     | P5-07  | Separates sign-out and account switching safely      |
| 8     | P5-08  | Defers new app versions until edits are preserved    |
| 9     | P5-09  | Makes storage failures and eviction explicit         |
| 10    | P5-10  | Proves full offline browser/cache/database boundary  |
| 11    | P5-11  | Audits completed work and states PASS or OPEN        |

There are no parallel commit waves. The dependency table in `phase5.md` describes what can be
developed independently, while this guide keeps the history linear. After a focused fix, rerun
targeted and downstream checks that can observe the changed contract.

## 8. Required evidence format

Each planned commit adds `docs/evidence/phase5/P5-xx.md`:

```text
# P5-xx — <title>

Planned commit subject: <exact subject from this guide>
Commit: <filled in the final evidence index; do not amend solely for self-hash>
Parent: <actual parent hash before implementation>
Branch: phase-5-offline-product
Environment: <OS, Node.js, pnpm, browser, PostgreSQL, served build hash>

## Behavior proved
<observable result>

## Contracts used
<cache policy, account namespace, role, outbox, save state, update/recovery rules>

## Changed scope
<owned modules and justified integration files>

## Commands and results
- `<exact command>` — PASS/FAIL/UNRUN, duration, counts, fixture size

## Offline browser and cache evidence
<URL, build, browser, active worker/controller, network mode, reload, Cache Storage/IDB result>

## Database and socket evidence
<real cookie/session, role/denial, ACK/seq, independent connections, or not applicable>

## Account, security, and recovery evidence
<cache exclusion, cross-account/sign-out, preserved bytes/export/update result>

## Known gaps and inherited gates
<unresolved Phase 5 issue and current Phase 4/Phase 2 status>

## Next commit unlocked
<P5 ID or phase exit>
```

The final `docs/evidence/phase5/README.md` maps P5 IDs and focused fixes to hashes. Evidence
uses synthetic users/boards and contains no cookies, OAuth codes, secrets, invite URLs or hashes,
database URLs, raw private graph bytes, private names, browser profiles, or full environment
dumps. Sanitized screenshots may corroborate but do not replace route/cache/DB proof.

## 9. Fix commit policy

If a defect is found after its planned commit, add a focused fix on the same branch before the
next dependent task:

```text
fix(<scope>): <specific violated invariant>
```

Record the introducing/exposing commit, failing observation, smallest correction, targeted and
downstream checks, and effect on prior evidence. Examples:

```text
fix(web): exclude auth callback from navigation cache
fix(sync-client): retain outbox after offline reload
fix(auth): block silent session reuse after offline sign out
fix(offline): defer worker activation with pending edits
```

Do not amend/squash completed planned commits or weaken a test to make the gate pass. A genuine
contract conflict needs failed evidence and a targeted `plan.md`/`phase5.md` amendment before
substitution. Phase 4 defects resolved here also need a linked Phase 4 audit follow-up.

## 10. Phase 5 final gate

The branch is ready to close only when:

- P5-01 through P5-11 and focused fixes form recorded linear history.
- Frozen install, format, lint, types, unit/browser/integration, auth schema, migration,
  boundary, independent builds, and `phase5:verify` pass on the recorded tree.
- A served production build with an active service worker loads direct supported routes offline
  and caches no authenticated API/WS/OAuth/invite response or private graph data.
- The offline dashboard shows only the selected account's cached subset and age; an uncached
  board is unavailable, not invented.
- A06 reloads a locally committed board offline; A07 reconciles with an independent user's edit
  and empties outbox only after durable ACK.
- A10 denies revoked queued writes and preserves/export local work in one real browser/socket/DB
  flow. A22 pauses on IndexedDB failure with no false save and in-memory export.
- A24 shows preservation choices and prevents cross-account cache access. A25 proves online and
  offline production direct-route refresh and no accidental API caching.
- App updates, schema incompatibility, storage eviction, unavailable Web Locks, and offline
  sign-out report accurate states without clearing pending edits unexpectedly.
- Phase 4 prerequisites are proved or remain explicitly open; the Phase 2 independent gaps stay
  visible until separately resolved. No Phase 6–8 or release claim is made.

If an inherited binding Phase 4 failure or a required Phase 5 real browser/database proof is
missing, mocked, or failing, Phase 5 remains **OPEN**. P5-11 reports the blocker and does not
change the governing gate.

## 11. Agent handoff response

After a planned or focused commit, report:

```text
Task: <P5-xx — title, or focused fix>
Branch: phase-5-offline-product
Hash: <commit hash>
Parent: <parent hash>
Changed: <files/modules>
Proved: <observable behavior>
Checks: <exact commands with PASS/FAIL/UNRUN>
Offline browser/cache: <build, worker, network, route, cache result>
Database/socket/account: <real result or not applicable>
Evidence: <path>
Risks: <known gaps and inherited gate status>
Next: <next sequential P5 task>
```

The response describes committed state. The next contributor verifies the named hash is HEAD
before continuing on the shared branch.

## 12. Technical references

- `plan.md` sections 4.1, 5–7, 10–11, 16–20 and milestone M05 — product and offline contracts.
- `phase5.md` — Phase 5 scope, tasks, acceptance matrix, and exit gate.
- `guide3.md` — prior single-branch, commit-by-commit format.
- `docs/phase-4-collaboration.md` — current implementation and OPEN dependency audit.
- `docs/phase-2-editor.md` — separate open editor/performance audit.
- `apps/web/AGENTS.md` and `apps/api/AGENTS.md` — binding application coding rules.
- Current source, package manifests, and lockfile — actual modules, scripts, and pinned versions.

External library documentation linked by `plan.md` explains available mechanisms. Archboard's
account separation, cache exclusion, save labels, recovery, task order, and evidence gate come
from the governing project documents.
