# Archboard Phase 2 — Commit-by-Commit Implementation Guide

Version: 1.0<br>
Date: 16 September 2026<br>
Status: Implementation guide<br>
Governing documents: `plan.md` version 1.1 and `phase2.md` version 1.0<br>
Branch policy: one long-lived Phase 2 branch for the entire milestone

## 1. Purpose

This guide turns Phase 2 into a sequence of small, reviewable commits that one implementing agent
can complete on a single branch without guessing architecture, weakening Phase 1 guarantees, or
absorbing work from later milestones.

`plan.md` remains the product and architecture authority. `phase2.md` defines the Phase 2 scope,
behavior, task list, and exit gate. This guide defines the single-branch workflow, exact commit
order, owned paths, non-goals, checks, evidence, and handoff requirements.

When documents disagree, use this order:

1. The user's latest written instruction.
2. `plan.md` product behavior and data invariants.
3. `phase2.md` Phase 2 scope and exit criteria.
4. This implementation guide.

The implementing agent must stop and document a conflict instead of silently choosing a different
contract. Routine internal names may change when the resulting boundary is clearer, but the
observable behavior, shared schemas, limits, command origins, tombstone policy, and persistence
semantics must remain unchanged.

## 2. Fixed implementation decisions

### 2.1 One branch for all Phase 2 work

Use one branch named:

```text
phase-2-local-editor
```

Create it once from the approved Phase 1 completion baseline after the Phase 2 planning documents
are present. Record that base commit in the P2-01 evidence file. All P2-01 through P2-13 commits and
any focused fix commits land directly on this branch in dependency order.

This phase does not use per-task branches, temporary integration branches, worktrees, or
cherry-pick-based assembly. If more than one agent contributes, only one may edit or commit at a
time. The outgoing agent must leave the shared branch committed, tested for its assigned task, and
free of unrelated working-tree changes before the next agent begins.

The guide does not authorize creating, pushing, merging, rebasing, or deleting the branch on a
remote. Those operations occur only when the user requests them. At implementation start, if the
named branch already exists or the working tree contains user changes, inspect and preserve them;
do not force-create the branch or discard work.

### 2.2 Durable graph ownership

The Y.Doc remains the only editable graph store.

```text
React controls / React Flow callbacks
              |
              | intents
              v
     document-model commands
              |
              v
            Y.Doc
          /       \
 projection       exact Yjs updates
     |                    |
     v                    v
React Flow adapter   sync-client IndexedDB
                          |
                          +-- local log
                          +-- outbox
                          +-- local snapshot
```

Rules:

- React components never write Y.Map fields, entity roots, or tombstones directly.
- React Flow nodes and edges are render models derived from `GraphProjection`; they are not stored
  as an independently editable array.
- Zustand stores only ephemeral interface state: selection IDs, panels, dialogs, viewport
  preferences, drag/resize previews, command mode, and clipboard metadata.
- Text inputs apply incremental edits through the approved Y.Text command/binding. Full-string
  replacement per keystroke is forbidden.
- React Flow measurements, DOM values, screen pixels, selection flags, and viewport state never
  enter the graph document.
- Completed gestures dispatch domain commands. Pointer-move previews stay ephemeral.
- Hydration, remote application, local edits, and structural edits retain their existing distinct
  origins.

When a Phase 2 interaction needs atomic behavior that the current command API cannot express, add
one focused command to `packages/document-model`. Do not open Yjs transactions in `apps/web` as a
shortcut.

### 2.3 Local persistence and demo isolation

Phase 2 productizes the Phase 1 IndexedDB adapter. It does not replace it with localStorage,
`y-indexeddb`, a debounced JSON save, or a React-state persistence plugin.

The demo namespace is derived from:

```text
deployment origin + reserved local-demo user key + stable UUID board ID + graph schema version
```

The reserved demo user key does not represent an authenticated identity. Future account caches must
not enumerate the demo namespace.

Required persistence rules:

- Exact local Yjs update bytes enter `localUpdates` and `outbox` in one IndexedDB transaction.
- “Saved on this device” appears only after every pending local write commits.
- Hydration replays one valid snapshot and later ordered log entries without producing new outbox
  entries.
- Local snapshot replacement commits before covered log deletion. Compaction never deletes outbox
  work merely because a snapshot contains it.
- A persistence error pauses graph mutation and preserves in-memory recovery export.
- Reset deletes only records matching the fully resolved demo namespace.
- `/demo` never creates a WebSocket or claims cloud/server persistence.

### 2.4 Single-writer browser model

Use the Web Locks API to enforce one writer for a storage namespace. A second tab is read-only until
the first writer releases its lock and the second tab rehydrates the committed cache.

BroadcastChannel carries only cache-change, reset, and release hints. It is not a Yjs transport and
cannot be used as an independent multi-writer path. Browsers without Web Locks remain read-only for
cached data; inventing a lease in localStorage is not an acceptable fallback.

### 2.5 Frontend architecture

Organize Phase 2 code by application shell, editor capability, and platform adapter:

```text
apps/web/src/
  app/
    router/                    route tree, not-found, route error boundaries
    providers/                 theme and application providers
    shell/                     landing and shared page chrome
  features/editor/
    application/               editor session and command orchestration
    canvas/                    React Flow projection adapter and viewport
    cards/                     card renderers and creation palette
    connections/               handles, edge rendering, alternate connection flow
    inspector/                 validated property and Y.Text editors
    selection/                 selection and compound-command coordination
    boundaries/                background rendering and geometry interaction
    history/                   undo/redo and deletion recovery UI
    demo/                      fixture seeding, reset, recovery download
    state/                     ephemeral Zustand slices only
    testing/                   editor-specific builders and harnesses
  platform/
    browser-locks/             Web Lock integration only if not owned by sync-client
    clipboard/                 browser clipboard boundary
    downloads/                 recovery download boundary
  styles/
packages/
  contracts/                   existing shared schemas and limits
  document-model/              framework-independent graph commands/selectors
  sync-client/                 framework-independent browser persistence and locking
  fixtures/                    deterministic demo and performance fixtures
docs/evidence/phase2/
```

This is a responsibility map, not a requirement to create empty folders. Prefer a small public API
per feature and focused names over broad `utils`, `helpers`, `common`, or `components` dumping
grounds.

Cross-boundary rules:

- `contracts` and `document-model` do not import React, React Flow, Zustand, Nest, or browser APIs.
- `sync-client` may use browser APIs but does not import React.
- `apps/web` may depend on shared packages; shared packages never import the application.
- `apps/web` does not import from `apps/api` and never contains database or authentication secrets.
- Clipboard, download, Web Lock, IndexedDB, and viewport globals sit behind narrow adapters so
  deterministic tests can control failures without replacing real-browser acceptance evidence.
- Existing Phase 1 spike files stay clearly labeled. Product code does not import UI from the
  spike feature; reusable binding logic must move to an appropriately owned module with regression
  coverage.

### 2.6 UI and dependency policy

Use the technologies selected by `plan.md` and `phase2.md`:

- React and Vite for the web application.
- TanStack Router for routes.
- Zustand for ephemeral interface state only.
- Tailwind CSS and checked-in shadcn/ui primitives for visual composition.
- Lucide for icons.
- `@xyflow/react` for canvas interaction and rendering.
- A pinned, locally bundled, non-executing syntax tokenizer for code-card read views.
- Vitest for shared-package units and browser adapters. Frontend behavior uses manual supported-
  browser acceptance evidence; `apps/web` does not retain an automated test suite.

P2-01 chooses mutually compatible exact versions, initializes shadcn/ui, updates the lockfile, and
records them. Do not use floating `latest` ranges. Run the shadcn CLI at an exact recorded version;
commit `components.json`, the alias and Tailwind/CSS-variable setup, the shared `cn` utility, and the
small primitive set required by named Phase 2 interactions. Generated shadcn/ui component source is
owned by the repository after it is added. The application must not depend on the CLI, registry, or
a hosted stylesheet at runtime.

Add only dependencies required by a named Phase 2 behavior. Do not add a second graph store,
another CRDT, a full rich-text editor, a state persistence framework, a second icon set, or a
remote syntax-highlighting service.

### 2.7 No magic values or duplicate contracts

Continue the Phase 1 constant policy:

- Shared graph limits remain in `packages/contracts/src/limits`.
- Stable schema values and enums remain in `packages/contracts`.
- Browser persistence thresholds and database names remain in `packages/sync-client/src/config`.
- Phase 2 UI constants such as grid size, paste offset, desktop editing breakpoint, default
  viewport, fit padding, and lock-name prefix live in focused named modules.
- Test fixture counts, performance sample counts, and time budgets use named test constants.

Do not recreate graph DTOs, color tokens, handle enums, error codes, default card sizes, or text
limits inside React features. UI option lists should be derived from or checked against the shared
contract source.

### 2.8 Phase boundary

Phase 2 edits `apps/web`, `packages/document-model`, `packages/sync-client`, `packages/fixtures`,
root tooling, and Phase 2 documentation. It should not add product behavior to `apps/api`, change
database migrations, or implement identity, board REST endpoints, production rooms, PWA caching,
comments, presentation UI, checkpoints, or final import/export.

The recovery JSON download is a loss-prevention artifact, not the M07 portability format. The demo
fixture may contain presentation-step records for future use, but Phase 2 does not expose a step
editor or presentation mode.

## 3. Single-branch execution contract

Each planned row below is one sequential commit on `phase-2-local-editor`. The same agent may
implement the entire phase. If responsibility changes between commits, the next agent continues
from the current branch HEAD rather than creating another branch.

Before P2-01, the implementing agent must:

1. Read `plan.md`, `phase2.md`, this guide, `docs/phase-1-compatibility.md`, and repository-level
   agent instructions.
2. Inspect the current branch, HEAD, status, and recent history.
3. Confirm the approved Phase 1 baseline and record its hash.
4. Ensure `phase2.md` and this guide are committed or included in an explicitly approved planning
   commit before implementation begins.
5. Create or switch to `phase-2-local-editor` without overwriting an existing branch or user work.
6. Run the existing lightweight baseline checks and record any pre-existing failure before edits.

Before each planned commit, the agent must:

1. Confirm the prior planned commit or focused fix is the current HEAD.
2. Confirm the working tree contains no unexplained changes.
3. Read the task's owned files and its dependency evidence.
4. State the P2 task being implemented and its non-goals.
5. Recheck `phase2.md` sections named by the task.

While working, the agent must:

- Stay within the task's owned paths except for listed integration files.
- Preserve unrelated user changes and avoid drive-by formatting or renaming.
- Reuse shared schemas, limits, origins, commands, and fixtures.
- Add behavior-focused tests with deterministic IDs, clocks, and failure controls.
- Use real browser evidence where the gate requires IndexedDB, Web Locks, clipboard, focus,
  pointer, reload, or multiple pages.
- Keep the branch buildable and leave no intentionally failing placeholder test.
- Record exact commands and outcomes in `docs/evidence/phase2/P2-xx.md`.
- Label mocked, skipped, browser-specific, and unrun checks honestly.

Before each commit, the agent must:

1. Review the complete diff and remove unrelated changes.
2. Run every task-specific required check.
3. Run `pnpm typecheck` and `pnpm lint` unless the task explicitly cannot yet establish them; any
   exception must be recorded.
4. Run broader regression checks when shared packages, manifests, test runners, or root config
   changed.
5. Update the task evidence with actual results, limitations, and the next task.
6. Commit with the exact subject in this guide.
7. Record the commit hash in the handoff response. P2-13 may add hashes to the final evidence index
   without rewriting earlier commits.

The agent must never:

- Create per-task branches or use parallel commits for this phase.
- Rewrite, squash, amend, or rebase completed Phase 2 commits unless the user explicitly requests
  it.
- Use `git reset --hard`, discard unrecognized changes, or force-update the branch.
- Commit `.env`, secrets, cookies, database URLs, browser profiles, coverage, screenshots containing
  private data, build output, or editor state.
- Mark a jsdom/mock test as real-browser evidence.
- Weaken Phase 1 tests, contracts, limits, package boundaries, or error behavior to make Phase 2
  pass.
- Claim authenticated boards, cloud saves, offline app-shell navigation, or collaboration are
  complete.

## 4. Branch and commit policy

The history is intentionally linear:

```text
approved Phase 1 baseline
  -> P2-01
  -> P2-02
  -> P2-03
  -> P2-04
  -> P2-05
  -> P2-06
  -> P2-07
  -> P2-08
  -> P2-09
  -> P2-10
  -> P2-11
  -> P2-12
  -> focused fixes, if any
  -> P2-13
```

Commit rules:

- One P2 task equals one planned commit.
- Use the exact Conventional Commit subject listed below.
- A generated lockfile or checked-in UI primitive belongs in the commit that introduces it.
- Evidence for a task belongs in the same commit as the behavior it records.
- A defect found before the task commit lands is fixed within that task.
- A defect found after its planned commit lands receives a focused `fix(...)` commit at the point
  it is discovered. Do not amend the original commit.
- P2-13 is documentation/audit only. Functional corrections must land in focused commits before it.
- Do not merge intermediate `main` changes into the phase branch without user direction. If the
  baseline must change, record the reason, resulting conflicts, and rerun all affected checks.

Because there is only one Phase 2 branch, parallel editing is prohibited. Independent dependency
paths in `phase2.md` describe architecture, not authorization to run multiple branch histories.

## 5. Canonical repository commands

Preserve all existing Phase 1 commands. Phase 2 adds stable command interfaces without renaming the
current ones.

| Command                              | Purpose                                                                     |
| ------------------------------------ | --------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`     | Reproduce the pinned dependency graph                                       |
| `pnpm format:check`                  | Check formatting without modifying files                                    |
| `pnpm lint`                          | Run lint and package-boundary rules                                         |
| `pnpm typecheck`                     | Run strict TypeScript checks across the workspace                           |
| `pnpm test`                          | Run workspace unit tests, including Phase 1 regressions                     |
| `pnpm test:browser`                  | Run browser-backed non-frontend package tests                               |
| `pnpm test:integration`              | Preserve the existing API/PostgreSQL regression command                     |
| `pnpm build`                         | Build every application and publishable package                             |
| `pnpm --filter @archboard/web build` | Build the web application independently                                     |
| `pnpm phase2:measure`                | Measure named local editor fixtures in a production build                   |
| `pnpm phase1:verify`                 | Re-run the complete Phase 1 gate when its required environment is available |
| `pnpm phase2:verify`                 | Run static, package-unit, sync-browser, boundary, and build checks          |

P2-01 establishes the toolchain needed by later work. It must not add a placeholder
`phase2:verify` that exits successfully without running the gate. P2-12 adds the complete aggregate
script no later than its own commit.

Manual frontend evidence requiring a production-build preview must start and stop it
deterministically. Package test scripts must not leave browsers, locks, or temporary profiles
running.
Database-dependent Phase 1 regressions fail clearly or are explicitly reported unrun when their
existing environment is unavailable; Phase 2 must not silently replace them with mocks.

## 6. Commit plan

### P2-01 — Add the editor toolchain and enforce boundaries

Commit subject:

```text
chore(web): add the phase 2 editor toolchain
```

Depends on: approved Phase 1 baseline and committed Phase 2 planning documents.

Read first:

- `phase2.md` sections 3–5, 12, 14, and 15.
- `docs/phase-1-compatibility.md` compatibility matrix and risk section.
- Current root, web, document-model, sync-client, and fixtures manifests/configuration.

Owned paths:

- Root `package.json`, `pnpm-lock.yaml`, and test/verification runner configuration.
- `apps/web/package.json`, TypeScript/Vite/Tailwind configuration.
- shadcn/ui `components.json`, import aliases, shared `cn` utility, theme variables, and the minimal
  checked-in primitive source required by Phase 2.
- ESLint/package-boundary checks and root README Phase 2 entry points.
- `docs/evidence/phase2/P2-01.md`.

Required work:

- Add exact compatible versions for React Flow, TanStack Router, Zustand, Tailwind, Lucide,
  shadcn/ui's required underlying primitive/helper packages and a local syntax tokenizer.
- Initialize shadcn/ui in `apps/web` with an exact recorded CLI version. Commit `components.json`,
  the `@/` alias mapping, the shared `cn` utility, theme variables, and only the foundational
  primitives required by the named P2-05 through P2-10 interactions (for example buttons, labels,
  inputs, textareas, dialogs, tooltips, selects, and collapsible/panel controls). List the actual
  selected primitives and their consumers in P2-01 evidence.
- Review generated primitive source before committing it. Remove unused variants, confirm it uses
  local imports and design tokens, and keep later product composition inside its owning feature.
- Record why the chosen tokenizer is safe for inert local highlighting and its production bundle
  contribution.
- Configure Tailwind/content scanning and design-token entry points without implementing the final
  editor appearance.
- Remove automated `apps/web` test scripts and dependencies. Frontend behavior is verified through
  manual supported-browser evidence in the later feature commit that owns each interaction.
- Extend boundary checks so shared packages cannot import React/React Flow/Zustand and sync-client
  cannot import React.
- Add named Phase 2 UI/test constants in focused modules where configuration already needs them.
- Update README to identify Phase 2 as the active implementation scope and link `phase2.md` and
  `guide1.md`.
- Record the Phase 1 base commit, branch name, exact added versions, and install/build results.

Non-goals:

- No routes, editor shell, graph rendering, persistence changes, composed product UI, or frontend
  behavior tests.
- No API dependencies, database changes, PWA plugin, service worker, or collaboration transport.
- No large library added merely for a future milestone.

Required checks:

```text
pnpm install
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @archboard/web build
pnpm build
```

Completion evidence:

- Clean frozen install and independent web build.
- No automated frontend test dependency, script, configuration, or test file remains.
- Boundary-negative fixtures fail when forbidden imports are introduced.
- Production build uses the checked-in shadcn/ui source and locally bundled assets, with no runtime
  registry, hosted stylesheet, or syntax-highlighting CDN reference.

### P2-02 — Add atomic UI-facing document commands

Commit subject:

```text
feat(document-model): add atomic editor commands
```

Depends on: P2-01.

Read first:

- `phase2.md` sections 5, 8, 9.3–9.6, and 10.
- Existing document-model commands, origins, undo, projection, and validation tests.

Owned paths:

- `packages/document-model/src/commands/**`.
- Focused selector/access modules in `packages/document-model/src/**` when required.
- Document-model exports and tests.
- Deterministic command fixtures in `packages/fixtures` only when shared across later tests.
- `docs/evidence/phase2/P2-02.md`.

Required work:

- Add an atomic batch position command for completed multi-node drags.
- Add an atomic mixed geometry command for selected nodes and boundaries without implying
  containment or relative coordinates.
- Add atomic batch creation for duplicate/paste after full preflight validation.
- Add atomic batch deletion that captures/tombstones selected objects and internal edges according
  to `phase2.md`, while leaving unrelated external connections hidden but untombstoned.
- Expose the minimum safe text-target or entity access needed by product bindings without exposing
  writable roots.
- Validate all candidates and capacity before mutation so a failed batch leaves the document
  byte-for-byte unchanged.
- Use `LOCAL_EDIT` for eligible property/geometry history and `LOCAL_STRUCTURAL` for create/delete/
  paste/restore behavior excluded from generic undo.
- Add explicit undo capture-boundary support if the current public undo API cannot separate
  completed gestures and field commits.

Non-goals:

- No React hooks, React Flow changes, Zustand state, browser storage, clipboard API, or UI defaults.
- No change to graph DTOs, immutable identities, tombstone semantics, or shared limits.
- No support for semantic grouping or nested coordinates.

Required checks:

```text
pnpm --filter @archboard/document-model test -- commands undo
pnpm --filter @archboard/document-model typecheck
pnpm --filter @archboard/document-model build
pnpm --filter @archboard/fixtures test
pnpm lint
pnpm typecheck
pnpm test
```

Completion evidence:

- One completed batch produces one command transaction/update.
- Invalid member, duplicate ID, over-limit count, and out-of-bounds geometry produce no partial
  mutation.
- Mixed node/boundary movement preserves absolute coordinates.
- Batch delete/restore tests retain tombstones and remap only internal edges.
- Existing convergence and undo suites remain green.

### P2-03 — Productize local persistence and hydration

Commit subject:

```text
feat(sync-client): productize local editor persistence
```

Depends on: P2-02.

Read first:

- `phase2.md` sections 7.1–7.4, 13, and A01/A22 requirements in section 15.3.
- Existing sync-client database, adapter, namespace, failpoint, and browser tests.

Owned paths:

- `packages/sync-client/src/persistence/**` and focused config/status modules.
- Sync-client browser tests and test fixtures.
- Shared document-model access only if a defect in P2-02 is first captured by a failing regression;
  otherwise use a focused fix commit.
- `docs/evidence/phase2/P2-03.md`.

Required work:

- Add a deterministic open/hydrate lifecycle that applies the newest namespace snapshot and only
  later local log records in local-sequence order.
- Ensure update observation that creates local writes is inactive or origin-filtered during
  hydration so replay cannot duplicate local log/outbox entries.
- Validate the hydrated document before exposing a writable session.
- Expose immutable status snapshots through subscribe/getSnapshot or an equivalent framework-
  independent external-store contract.
- Emit status changes for loading, saving, saved, storage error, and recovery required with exact
  pending-write semantics.
- Implement local snapshot creation and crash-safe covered-log compaction using named thresholds.
- Preserve every outbox record across local compaction.
- Add exact-namespace listing/deletion for confirmed demo reset; reject broad or unresolved
  namespace deletion.
- Make close idempotent and safe during partial initialization or pending writes.
- Preserve A22: persistence failure pauses edits, never reports saved, never exposes failed bytes as
  transport eligible, and retains in-memory projection access.

Non-goals:

- No Web Lock, BroadcastChannel, React provider, transport, ACK draining, server snapshot, service
  worker, or account-switch behavior.
- No schema migration for unknown cached versions; fail explicitly and preserve bytes.
- No deletion of pending outbox entries during compaction or close.

Required checks:

```text
pnpm --filter @archboard/sync-client test
pnpm test:browser -- indexeddb hydration snapshot outbox failure
pnpm --filter @archboard/sync-client typecheck
pnpm --filter @archboard/sync-client build
pnpm lint
pnpm typecheck
pnpm test
```

Completion evidence:

- A real-browser close/reopen rebuilds an equivalent projection from persisted bytes.
- Hydration creates no additional local log or outbox record.
- Interrupted snapshot replacement retains one complete replay path.
- Namespace reset cannot delete a neighboring user, board, origin, or schema namespace.
- Status subscribers observe saving before saved, and failure never emits saved afterward.

### P2-04 — Enforce one writable editor tab

Commit subject:

```text
feat(sync-client): enforce one writable editor tab
```

Depends on: P2-03.

Read first:

- `phase2.md` sections 7.1 and 7.5 plus A12 in section 15.3.
- The P2-03 session lifecycle and namespace implementation.

Owned paths:

- `packages/sync-client/src/locking/**` or an equivalently focused browser-session module.
- Browser lock/BroadcastChannel config and exports.
- Real-browser multi-page tests and fixtures.
- Non-frontend browser-package runner changes strictly required for independent pages.
- `docs/evidence/phase2/P2-04.md`.

Required work:

- Derive a versioned lock name from the fully resolved storage namespace.
- Acquire the writer lock without stealing it and hold it for the writable session lifetime.
- Represent writer, read-only-held-elsewhere, unsupported, releasing, and closed states explicitly.
- Keep non-owners from attaching writable document bindings or persistence writers.
- Use BroadcastChannel only for cache-changed, reset-complete, and lock-release hints.
- On transfer, close the stale read-only view, acquire the lock, rehydrate current committed bytes,
  validate, and only then enable mutation.
- Make release/close idempotent across route unmount, explicit retry, page closure, and partial open.
- Provide the unsupported-Web-Locks read-only state without a localStorage lease fallback.
- Prove A12 with two independent pages sharing one origin and namespace.

Non-goals:

- No cross-user collaboration, WebSocket, presence, service-worker messaging, or background sync.
- No busy polling and no automatic lock theft.
- No React UI beyond a minimal test harness.

Required checks:

```text
pnpm --filter @archboard/sync-client test
pnpm test:browser -- web-lock broadcast-channel
pnpm lint
pnpm typecheck
pnpm build
```

Completion evidence:

- Exactly one page can execute a graph mutation for the namespace.
- The second page reports read-only and cannot create an IndexedDB local update.
- After the writer closes, the second page acquires the lock and sees the first page's last committed
  edit before controls become writable.
- A forged BroadcastChannel hint cannot bypass the lock.

### P2-05 — Add routes, shell, theme, and ephemeral state

Commit subject:

```text
feat(web): add the local editor shell and routes
```

Depends on: P2-01. Implement after P2-04 on the single branch.

Read first:

- `phase2.md` sections 6, 12, and 14.
- Existing web app bootstrap, styles, config, and Phase 1 spike boundary.

Owned paths:

- `apps/web/src/app/**`.
- `apps/web/src/features/editor/state/**`.
- Shared web-only UI primitives and `apps/web/src/styles/**`.
- Web entry/bootstrap and manual supported-browser route evidence.
- `docs/evidence/phase2/P2-05.md`.

Required work:

- Replace the Phase 1 placeholder with TanStack Router routes for `/`, `/demo`, and not-found.
- Add route-level error handling without inventing `/boards` or authenticated placeholders.
- Build the stable editor layout: top bar, collapsible palette, canvas region, collapsible inspector,
  and bottom controls region.
- Add loading, seeding, writable, read-only, saving, saved, storage-error, recovery-required, and
  narrow-screen visual states as typed view state.
- Add light, dark, and system theme handling through local preference/design tokens, not the graph.
- Add Zustand slices only for ephemeral UI state and selectors that avoid broad rerenders.
- Add accessible dialog, tooltip, live-region, and button primitives needed by later tasks.
- Ensure the empty shell has visible focus and sensible landmark/heading structure.

Non-goals:

- No Y.Doc session, IndexedDB hookup, graph rendering, cards, edge editing, or functional graph
  controls.
- No sign-in, dashboard, comments, presentation, export center, or PWA behavior.
- No graph DTO copy in Zustand.

Required checks:

```text
pnpm --filter @archboard/web typecheck
pnpm --filter @archboard/web build
pnpm lint
pnpm typecheck
```

Completion evidence:

- Direct online refresh of `/demo` renders the route shell in a served production build.
- Unknown routes show a useful link to `/demo`.
- Theme/panel/selection preferences remain outside graph projection.
- A store test demonstrates graph nodes/edges cannot be inserted into the UI state API.

### P2-06 — Connect the editor session and render the canvas

Commit subject:

```text
feat(web): render graph projections on the canvas
```

Depends on: P2-02, P2-04, and P2-05.

Read first:

- `phase2.md` sections 7, 8, 9.3, and 13.
- P2-03/P2-04 public APIs and P2-05 typed shell states.

Owned paths:

- `apps/web/src/features/editor/application/**`.
- `apps/web/src/features/editor/canvas/**`.
- Minimal boundary render layer needed to verify z-order; full boundary editing remains P2-09.
- Editor session/projection adapter tests.
- `docs/evidence/phase2/P2-06.md`.

Required work:

- Create one editor-session owner that coordinates Y.Doc, local persistence, writer lock, undo
  manager, projection subscription, and idempotent cleanup.
- Expose projection and status to React through `useSyncExternalStore` or an equivalent tear-free
  external-store adapter.
- Convert graph nodes and edges into deterministic React Flow render models with fixed IDs,
  geometry, and handles.
- Preserve adapter object identity for unchanged graph objects where practical.
- Render boundaries in a dedicated background layer below nodes/edges with correct world geometry.
- Implement space/middle-button pan, documented wheel/trackpad zoom, zoom controls, fit-to-content,
  reset zoom, background, and optional minimap state.
- Treat React Flow selection/position changes as intent. Until later tasks attach commands, they must
  not write graph data.
- Render a stable loading shell until hydration and validation complete; never flash an editable
  empty document.
- Keep read-only sessions inspectable while removing mutation callbacks.

Non-goals:

- No card-specific visuals/inspectors, new connection gesture, geometry persistence, clipboard,
  delete, reset, or final demo seeding.
- No persisted viewport or React Flow measurement.

Required checks:

```text
pnpm --filter @archboard/web typecheck
pnpm --filter @archboard/web build
pnpm lint
pnpm typecheck
pnpm test
```

Completion evidence:

- The all-kinds fixture renders the correct object count, IDs, handles, geometry, and boundary
  z-order.
- Projection change notifications cannot produce mismatched React revisions.
- Pan/zoom/fit/reset create no Yjs update or IndexedDB write.
- Unmount closes observers, database connections, lock, channel, and undo manager once.

### P2-07 — Add cards, palette, inspector, and incremental text editing

Commit subject:

```text
feat(web): add card creation and inspectors
```

Depends on: P2-06.

Read first:

- `phase2.md` sections 9.1–9.2, 12, and the text-related checks in section 15.
- Phase 1 Y.Text binding implementation/evidence and P2-02 safe text access API.

Owned paths:

- `apps/web/src/features/editor/cards/**`.
- `apps/web/src/features/editor/inspector/**`.
- Palette integration and reusable product text binding.
- Safe syntax highlighting adapter and manual inert-rendering checks.
- `docs/evidence/phase2/P2-07.md`.

Required work:

- Implement distinct component, code, schema, and note renderers with contract defaults and sizes.
- Add palette actions that create cards at a snapped visible-viewport position with fresh UUIDs.
- Render all four fixed handle positions without enabling connection creation yet.
- Build single-selection inspectors with exactly the fields valid for the selected kind.
- Bind title, description, technology, code/schema/note body, edge-ready text fields, and future
  boundary title through incremental Y.Text edits.
- Keep invalid drafts local until corrected/cancelled and show inline limits/errors.
- Validate category, language, color, external URL, and other atomic values before command dispatch.
- Add a locally bundled inert code highlighting read view for every supported language.
- Escape all rendered text and open only validated HTTP(S) URLs with safe opener isolation and no
  preview fetch.
- Define field-level history boundaries, Escape cancellation, Enter behavior, composition handling,
  and shortcut suppression while typing.

Non-goals:

- No rich text, HTML preview, code execution, remote URL preview, connection creation, geometry
  persistence, or multi-selection inspector.
- No full-string Y.Text replacement on each input event.

Required checks:

```text
pnpm --filter @archboard/document-model test -- text undo
pnpm --filter @archboard/web build
pnpm lint
pnpm typecheck
```

Completion evidence:

- Each card kind creates, renders, edits, persists, and hydrates with its exact allowed fields.
- Manual Chrome evidence shows incremental insert/delete behavior and supported caret/selection
  preservation.
- Invalid/oversized values never mutate the document.
- Script-like code/text is displayed inertly, and highlighting loads no remote asset.
- Manual negative checks prove external-link protocol restriction and opener isolation.

### P2-08 — Add editable graph connections

Commit subject:

```text
feat(web): add editable graph connections
```

Depends on: P2-07.

Read first:

- `phase2.md` sections 9.2, 9.5, 12, and edge checks in section 15.
- Existing edge contracts and create/edit/replace commands.

Owned paths:

- `apps/web/src/features/editor/connections/**`.
- Edge portions of inspector/canvas integration.
- Manual supported-browser connection evidence.
- `docs/evidence/phase2/P2-08.md`.

Required work:

- Enable incoming/outgoing interaction on `top`, `right`, `bottom`, and `left` handles.
- Create complete edges with fresh IDs and forward/solid/empty-text defaults.
- Render forward and bidirectional arrows, solid/dashed style, label, and protocol safely.
- Add edge inspector editing through existing commands.
- Reconnect by one structural command that creates a fresh edge and tombstones the original.
- Allow parallel edges and reject self-loops with accessible feedback.
- Add a keyboard connection flow: choose source card/handle, target card/handle, review, create or
  cancel.
- Ensure missing/tombstoned endpoint edges remain absent through projection rather than a view-only
  workaround.

Non-goals:

- No edge routing persistence, executable protocols, automatic layout, collaboration preview, or
  connection to boundaries.
- No mutation of endpoint or handle fields in place.

Required checks:

```text
pnpm --filter @archboard/document-model test -- edges projection
pnpm --filter @archboard/web build
pnpm lint
pnpm typecheck
```

Completion evidence:

- Every source/target handle combination creates the contracted handle IDs.
- Both styles/directions render and survive reload.
- Reconnect leaves the original tombstone and a fresh valid edge.
- Self-loop/malformed-handle attempts create no partial graph update.
- The alternate keyboard flow completes without a pointer.

### P2-09 — Add selection, geometry, alignment, and boundaries

Commit subject:

```text
feat(web): add selection geometry and boundaries
```

Depends on: P2-06 and P2-08.

Read first:

- `phase2.md` sections 9.3, 9.4, 9.6, 12, and 13.
- P2-02 atomic geometry commands and React Flow adapter behavior.

Owned paths:

- `apps/web/src/features/editor/selection/**`.
- `apps/web/src/features/editor/boundaries/**`.
- Geometry portions of canvas/inspector/state.
- Pointer and keyboard geometry tests.
- `docs/evidence/phase2/P2-09.md`.

Required work:

- Implement click, Shift-click, selection rectangle, edge selection, and deterministic selection
  cleanup when a projection target disappears.
- Document and test the rectangle containment/intersection rule.
- Preview node and boundary drag/resize in ephemeral state and commit exactly once at gesture end.
- Move selected nodes as one atomic batch; move mixed nodes/boundaries through the P2-02 absolute
  geometry command.
- Add resize handles and accessible numeric/keyboard geometry alternatives.
- Enable the 16-world-unit grid by default and Alt bypass for drag/resize.
- Implement left, horizontal-center, right, top, vertical-center, and bottom alignment for at least
  two selected nodes, one transaction per action.
- Complete boundary create/render/select/edit/move/resize behavior with labeled translucent
  background visuals and explicit non-containment help.
- Clamp or reject invalid geometry consistently before dispatch.

Non-goals:

- No node parenting, relative coordinates, semantic nesting, auto-layout, or presence broadcasts.
- No per-pointer-move durable commands.
- No free movement for edges.

Required checks:

```text
pnpm --filter @archboard/document-model test -- geometry boundaries
pnpm --filter @archboard/web build
pnpm lint
pnpm typecheck
```

Completion evidence:

- Completed drag/resize produces one durable transaction; intermediate pointer moves produce none.
- Snap and Alt-bypass calculations use world coordinates at multiple zoom levels.
- All six alignments pass for unequal node sizes.
- Moving a boundary alone never changes an enclosed node.
- Mixed movement preserves absolute positions and remains atomic.

### P2-10 — Add compound commands, deletion recovery, and local history

Commit subject:

```text
feat(web): add compound editor commands and history
```

Depends on: P2-07, P2-08, and P2-09.

Read first:

- `phase2.md` section 10 and A13/A14 in section 15.3.
- P2-02 batch commands and existing undo/restore APIs.

Owned paths:

- `apps/web/src/features/editor/history/**`.
- Clipboard/compound-command modules under editor/platform boundaries.
- Selection inspector actions and global shortcut routing.
- Document-model regression tests only for newly exposed command defects.
- `docs/evidence/phase2/P2-10.md`.

Required work:

- Add duplicate, strict versioned selection copy/paste, and explicit paste-as-note.
- Include internal edges only when both endpoints are selected; never copy presentation steps,
  tombstones, permissions, or unrelated external connections.
- Preflight fresh IDs, references, capacity, geometry, and the 32-world-unit paste offset before one
  structural creation transaction.
- Report system clipboard denial honestly and provide only the documented session-local fallback.
- Capture selected objects and internal edges before atomic deletion.
- Require confirmation above 10 selected objects and leave state unchanged on cancellation.
- Store only the most recent deletion capture in session memory and expose restore until reload/reset.
- Restore fresh IDs/internal edges through `restoreDeletedObjects`; retain old tombstones and omit
  external edges.
- Wire session-local undo/redo for eligible local-edit origins with explicit gesture/field capture
  boundaries and tombstoned-target feedback.
- Add platform-aware shortcuts and suppress canvas commands in editable controls.

Non-goals:

- No generic undo for create/delete/duplicate/paste/restore.
- No persistence of undo stack or deletion capture across reload.
- No arbitrary external clipboard JSON import or implicit text-to-note conversion.

Required checks:

```text
pnpm --filter @archboard/document-model test -- commands undo restore
pnpm lint
pnpm typecheck
pnpm build
```

Completion evidence:

- A13 passes with a remote-origin edit retained after local undo.
- A14 passes with fresh IDs, remapped internal edges, omitted external edges, and unchanged
  tombstones.
- Repeated paste offsets correctly and never exceeds graph limits partially.
- Native text copy/paste and text undo remain available while canvas shortcuts are suppressed.
- Reload clears undo/delete-recovery state without changing the graph.

### P2-11 — Complete the local demo lifecycle

Commit subject:

```text
feat(web): complete the local demo lifecycle
```

Depends on: P2-03, P2-05, and P2-10.

Read first:

- `phase2.md` sections 6.3, 7, 11, and A01/A22 in section 15.3.
- Existing canonical fixtures and fresh-ID restore/remap behavior.

Owned paths:

- `packages/fixtures/src/templates/**` or equivalent product-fixture location.
- `apps/web/src/features/editor/demo/**`.
- Editor-session integration required for seeding/reset/status/recovery.
- Manual supported-browser demo lifecycle evidence.
- `docs/evidence/phase2/P2-11.md`.

Required work:

- Add the deterministic `web-application` fixture required by the plan: browser, API, database,
  cache, HTTPS/SQL/cache edges, backend boundary, request payload code card, and four presentation
  step records.
- Validate the source fixture and instantiate it with fresh IDs and remapped references.
- Seed only when the exact demo namespace has no recoverable local state.
- Hold the writer lock throughout confirmed reset, detach the old adapter/document, delete only the
  exact namespace, persist the fresh fixture, then notify other tabs.
- Connect session states to the exact Phase 2 local-only labels. Never show connecting/syncing/server
  wording.
- Implement recovery JSON download from the current strict projection with marker, creation time,
  and local-only state. Escape serialization and create/revoke object URLs safely.
- Offer recovery download before reset and after storage failure.
- Keep pan, zoom, selection, inspection, and recovery available after persistence failure while all
  mutations remain blocked.
- Prove A01's local portion through the rendered product: create two components, connect, wait for
  device save, close/reload, and compare IDs/content/geometry/endpoints.
- Rerun the A22 failure path through product UI, not only the adapter unit.

Non-goals:

- No general JSON import, final portable export schema, SVG/PNG, other templates, blank server board,
  authenticated board, service worker, or network synchronization.
- No claim that recovery JSON can be imported by Phase 2.

Required checks:

```text
pnpm --filter @archboard/fixtures test -- web-application template
pnpm --filter @archboard/web build
pnpm lint
pnpm typecheck
pnpm test
```

Completion evidence:

- First use seeds once; later opens hydrate user edits without reseeding.
- A01 local reload passes only after the saved-device state is observed.
- Reset changes every fixture entity ID, clears only the demo namespace, and cannot race another
  writer.
- A22 product UI never reports saved after failure and downloads the in-memory projection.
- Network observation confirms `/demo` opens no collaboration socket or graph API request.

### P2-12 — Verify accessibility, security, and performance

Commit subject:

```text
test(web): verify local editor quality gates
```

Depends on: P2-11.

Read first:

- `phase2.md` sections 12, 13, and 15.
- All P2-01 through P2-11 evidence and known gaps.

Owned paths:

- Phase 2 manual browser accessibility, security-negative, and performance evidence.
- Deterministic typical/limit frontend fixtures under `packages/fixtures`.
- Measurement scripts and root `phase2:measure`/`phase2:verify` orchestration.
- Small accessibility corrections in Phase 2 web features when directly exposed by these checks;
  substantial behavioral fixes require focused fix commits.
- `docs/evidence/phase2/P2-12.md`.

Required work:

- Complete the local A28 keyboard workflow: create, edit, alternate connect, inspect, move/resize or
  numeric equivalent, delete/restore, fit, zoom, and open help without a pointer.
- Record a screen-reader spot check with browser, reader, route, controls traversed, announcements,
  and limitations. Do not claim a full accessibility audit.
- Verify visible focus, dialog focus trap/return, live-region save/error/restore announcements,
  accessible names, and non-color-only states.
- Verify narrow screens are coherently read-only and do not expose broken editing controls.
- Perform negative checks for HTML/script-like graph text, clipboard payloads, syntax highlighting,
  recovery JSON, and external URL protocols/opener isolation.
- Measure production-build open-to-interactive time for a cached 200-node/400-edge fixture.
- Measure pan/drag p95 frame time on the same fixture without generating per-move durable updates.
- Record hardware, OS, browser, build mode, sample count, fixture counts, method, raw summary, and
  comparison with the 2-second and 32-ms targets.
- Assemble `pnpm phase2:verify` so it runs formatting, lint, strict typecheck, shared-package units,
  sync-client browser checks, independent web build, workspace build, boundary, and
  bundle-secret/CDN checks.
- Re-run Phase 1 shared-package regressions and `phase1:verify` when its required database
  environment is available.

Non-goals:

- No presentation keyboard flow, full WCAG certification, mobile editing, unsupported-browser
  claims, service-worker offline test, or multi-user latency measurement.
- No changing a performance target after measurement merely to report a pass.

Required checks:

```text
pnpm phase2:measure
pnpm phase2:verify
pnpm phase1:verify
pnpm --filter @archboard/web build
pnpm build
```

Completion evidence:

- Local A28 workflow and screen-reader notes are reproducible.
- Security-negative payloads remain inert and unsafe URLs cannot open.
- Performance report contains measured values, not estimates, and calls out any missed target.
- Aggregate gate output names every child command and propagates failures.
- Phase 1 regression result is PASS or honestly UNRUN with the precise missing environment; no
  regression is hidden by changing the old gate.

### P2-13 — Audit and close Phase 2

Commit subject:

```text
docs(phase2): record local editor evidence and exit status
```

Depends on: P2-01 through P2-12 and every focused Phase 2 fix commit.

Read first:

- Complete `phase2.md` exit gate and deliverables.
- Every `docs/evidence/phase2/P2-xx.md` file.
- Current README commands, manifests, lockfile, and git history from the recorded Phase 1 base.

Owned paths:

- `docs/phase-2-editor.md`.
- `docs/evidence/phase2/README.md` and evidence metadata/hash corrections.
- README verification/status references.
- `phase2.md` or this guide only for an already approved, evidence-backed amendment.

Required work:

- Record the exact branch base, linear planned/fix commit history, runtime/browser matrix, and final
  direct dependency versions.
- Link every P2 task, deliverable, and exit criterion to tests, build results, screenshots only when
  useful, measurements, or a documented blocker.
- Record exact clean-tree command results and meaningful test counts.
- Confirm A01 local, A12, A13, A14, A22 regression, and local A28 evidence.
- Confirm the demo never opens a collaboration transport and no UI claims server persistence.
- Confirm Y.Doc ownership, command-only mutation, Zustand/React Flow state boundaries, Web Lock
  exclusion, namespace reset scoping, and recovery behavior.
- Record supported browser evidence and explicitly list unsupported or untested platforms.
- Record measured opening/interaction performance and any budget miss.
- Distinguish reload-safe local persistence from offline service-worker navigation.
- Mark Phase 2 passed only if every mandatory gate is satisfied; otherwise mark it blocked/open with
  reproducible evidence.

Non-goals:

- No functional code, dependency upgrades, refactors, styling changes, or test weakening.
- No merge, remote push, release tag, deployment, or claim that version 1 is complete.

Required checks:

```text
pnpm install --frozen-lockfile
pnpm phase2:verify
pnpm phase2:measure
pnpm phase1:verify
pnpm --filter @archboard/web build
pnpm build
git status --short
```

Completion evidence:

- `docs/phase-2-editor.md` contains a pass/block decision with no unsupported claim.
- Every exit-gate row has a direct evidence link or explicit blocker.
- The branch contains no unexplained or generated working-tree files.
- Any environment-dependent unrun Phase 1 check is clearly separated from Phase 2 results.

## 7. Sequential execution order

The single branch uses this exact order:

| Sequence | Commit | Why it is next                                                                |
| -------- | ------ | ----------------------------------------------------------------------------- |
| 1        | P2-01  | Establishes dependencies, runners, boundaries, and active-scope documentation |
| 2        | P2-02  | Adds atomic framework-independent commands before UI event handlers exist     |
| 3        | P2-03  | Makes local bytes reloadable and status observable before product integration |
| 4        | P2-04  | Enforces the writer invariant before any product editor enables mutation      |
| 5        | P2-05  | Establishes routes, shell, themes, and ephemeral state                        |
| 6        | P2-06  | Integrates the real session and read-only canvas projection                   |
| 7        | P2-07  | Adds all card kinds and correct text/property editing                         |
| 8        | P2-08  | Adds connection behavior on stable card/inspector foundations                 |
| 9        | P2-09  | Adds selection, durable geometry, alignment, and boundaries                   |
| 10       | P2-10  | Adds compound behavior after all selectable object types work                 |
| 11       | P2-11  | Integrates seeding, reset, save/recovery UI, and product acceptance paths     |
| 12       | P2-12  | Measures and verifies the integrated local editor                             |
| 13       | P2-13  | Audits already-correct code and closes the phase                              |

There are no parallel waves. Do not start a later commit early because its architecture dependency
appears satisfied; doing so would create overlapping edits on the only Phase 2 branch. A task may
prepare notes for later work, but it must not place later-task code in an earlier commit.

After any focused fix commit, rerun the affected task checks and all downstream aggregate checks
that could observe the changed contract. Record the fix between the planned commits where it was
discovered; do not reorder completed history.

## 8. Required evidence format

Every planned commit adds `docs/evidence/phase2/P2-xx.md` with:

```text
# P2-xx — <title>

Planned commit subject: <exact subject from this guide>
Commit: <filled in the final Phase 2 evidence index; do not amend solely for self-hash>
Parent: <actual parent hash before implementation>
Branch: phase-2-local-editor
Environment: <OS, Node.js, pnpm, browser and build mode when relevant>

## Behavior proved
<observable result>

## Contracts used
<schemas, limits, commands, origins, and invariants>

## Changed scope
<owned files/modules and any justified integration file>

## Commands and results
- `<exact command>` — PASS/FAIL/UNRUN, duration and relevant counts

## Browser evidence
<real browser/pages used and result, or not applicable>

## Failure injection
<failpoint and unchanged state proved, or not applicable>

## Accessibility evidence
<keyboard/screen-reader/focus result, or not applicable>

## Measurements
<fixture, samples, hardware, build mode, result, or not applicable>

## Known gaps
<remaining issue, consequence, and owner, or none>

## Next commit unlocked
<P2 task ID>
```

The `docs/evidence/phase2/README.md` index maps planned IDs to final hashes during P2-13. This avoids
amending task commits merely to place their own hash inside their evidence file.

Do not include secrets, cookies, database URLs, private clipboard contents, full environment dumps,
user graph content, or browser profiles. Screenshots are optional corroboration, not a substitute
for assertions, and must contain only deterministic non-sensitive fixtures.

## 9. Fix commit policy

When a defect is discovered after its planned commit landed, add a focused fix commit on the same
Phase 2 branch before continuing.

Subject format:

```text
fix(<scope>): <specific violated invariant>
```

A fix commit must record in `docs/evidence/phase2/`:

- The planned commit that introduced or exposed the defect.
- The failing test or exact reproducible behavior.
- The smallest correction and why it preserves the governing contracts.
- Targeted checks and downstream checks rerun.
- Any effect on previous evidence or performance results.

Examples of acceptable subjects:

```text
fix(sync-client): prevent hydration from duplicating outbox entries
fix(editor): retain writer lock throughout demo reset
fix(canvas): commit grouped drag positions atomically
```

Do not use broad subjects such as `fix bugs`, `cleanup`, `changes`, or `phase 2 fixes`. Do not amend,
squash, or reorder the earlier planned commit. If a defect changes scope or architecture rather than
correcting an implementation, stop and request a documented amendment.

## 10. Phase 2 final gate

The `phase-2-local-editor` branch is ready to close only when:

- P2-01 through P2-13 are present in order, with focused fixes explicitly recorded where needed.
- The lockfile reproduces a clean install.
- Formatting, lint, strict typecheck, shared-package unit, sync-client browser, boundary,
  independent web build, and workspace build checks pass; manual frontend evidence is recorded.
- Phase 1 shared contracts, convergence, persistence, auth/WS spike, durable receipt, and worker
  behavior have not been weakened; the full old gate is passed when its database environment is
  available or precisely reported unrun.
- The Y.Doc is the only editable graph state and all durable mutations use document-model commands.
- React Flow render models and Zustand state contain no independent editable graph copy.
- `/demo` seeds a validated fresh-ID fixture once, reloads committed edits, and never opens a
  collaboration connection.
- Every card kind, fixed handle, edge style/direction, boundary, inspector, and required viewport
  operation works.
- Multi-object movement, mixed geometry, alignment, paste, deletion, and restore are atomic where
  specified.
- Incremental Y.Text product controls pass supported browser caret/selection tests.
- A01 local, A12, A13, A14, the A22 regression, and local A28 evidence pass in the required real
  browser/page arrangements.
- The second tab is read-only until lock transfer and rehydrates before becoming writable.
- Device-save labels correspond to committed IndexedDB state; storage failure pauses mutation and
  offers the current in-memory recovery projection.
- Reset holds the writer lock and deletes only the exact demo namespace.
- Clipboard, rendered text/code, recovery JSON, and external-link manual security-negative checks
  pass.
- Opening/interaction measurements are recorded honestly against the 2-second and 32-ms targets.
- The final audit distinguishes local reload safety from service-worker offline navigation and
  contains no authentication, server durability, collaboration, deployment, or version 1 release
  claim.

If a mandatory check is unrun, mocked where a real browser is required, or failing, Phase 2 remains
open. P2-13 records the blocker; it does not redefine the gate.

## 11. Agent handoff response

After each planned or focused fix commit, the implementing agent responds with:

```text
Task: <P2-xx — title, or focused fix>
Branch: phase-2-local-editor
Hash: <commit hash>
Parent: <parent hash>
Changed: <files/modules>
Proved: <observable behavior>
Checks: <exact commands and PASS/FAIL/UNRUN results>
Browser evidence: <browser/pages used, or not applicable>
Evidence: <path>
Risks: <known gaps or none>
Next: <next sequential P2 task>
```

The response describes committed state, not a plan or an uncommitted experiment. The next agent, if
ownership changes, verifies the named hash is current HEAD and continues on the same branch.

## 12. Technical references

- `plan.md` sections 4.2–4.5, 6–10, 16, 18, and milestone M02.
- `phase2.md` — complete local-editor contract and exit gate.
- `docs/phase-1-compatibility.md` — pinned baseline, passed evidence, and known browser limitations.
- [React Flow multiplayer guidance](https://reactflow.dev/learn/advanced-use/multiplayer) — durable
  versus ephemeral diagram state.
- [Yjs UndoManager](https://docs.yjs.dev/api/undo-manager) — tracked origins and capture boundaries.
- [Yjs offline support](https://docs.yjs.dev/getting-started/allowing-offline-editing) — background
  context; Archboard still uses its custom atomic IndexedDB/outbox adapter.
- [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API) — exclusive
  namespace writer ownership.
- [BroadcastChannel API](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel) —
  cross-tab hints, not durable graph transport.
- [React `useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore) — coherent
  external projection/status subscriptions.

These references establish library capabilities. Archboard's command-only mutation, exact save
labels, namespace isolation, tombstone rules, batch atomicity, recovery behavior, task order, and
Phase 2 gate remain project-specific requirements defined by `plan.md`, `phase2.md`, and this guide.
