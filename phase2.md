# Archboard — Phase 2: Local Editor

Version: 1.0<br>
Date: 16 September 2026<br>
Status: Implementation specification<br>
Governing specification: `plan.md` version 1.1<br>
Prerequisite: Phase 1 passed; see `docs/phase-1-compatibility.md`.

## 1. Purpose and authority

This document defines Phase 2 of Archboard: milestone M02, the local architecture editor. It turns
the Phase 1 contracts, Yjs document model, command layer, browser persistence spike, and text-binding
proof into a usable local product surface without claiming that identity, server board lifecycle,
live collaboration, or the production offline application shell are complete.

`plan.md` remains the product and architecture authority. This file narrows that plan into bounded
Phase 2 work, dependency order, observable behavior, and an exit gate. When the documents disagree,
use this order:

1. The user's latest written instruction.
2. `plan.md`.
3. This Phase 2 specification.
4. Existing implementation details and task handoffs.

MUST means required to close Phase 2. DEFERRED means excluded from Phase 2, not removed from version

1. An implementation must not weaken the shared graph schemas, immutable identity rules, tombstone
   semantics, limits, or persistence guarantees to simplify the user interface.

## 2. Phase outcome

At the end of Phase 2, a user can open `/demo`, work with a clearly labeled local-only architecture
board, and:

- Create, inspect, edit, move, resize, select, duplicate, copy, paste, align, and delete all four
  card kinds.
- Create and edit connections using the fixed handles, styles, directions, labels, and protocols
  defined by the product contract.
- Create and edit visual boundaries without turning them into React Flow parent nodes.
- Pan, zoom, fit the diagram, reset the viewport, use grid snapping, and operate the core editor by
  keyboard.
- Undo and redo eligible local edits without undoing remote-origin changes or structural
  create/delete operations.
- Restore the most recent deletion as fresh objects with remapped internal edges and unchanged
  tombstones.
- Reload the browser after the interface reports a completed device save and recover the exact
  locally committed graph.
- Open the same local board in two tabs and have only one writable tab at a time.
- See truthful local save, read-only, loading, and storage-failure states. The interface never says
  “Saved to server” in this phase.
- Reset the demo with confirmation or download a recovery JSON projection before destructive reset
  or after a persistence failure.

Phase 2 is a local editor milestone, not a version 1 release. Its browser persistence proves local
reload safety while the application shell is available. Service-worker-backed offline navigation,
server acknowledgements, reconnect synchronization, and multi-user editing remain later work.

## 3. Phase 1 baseline

Phase 2 consumes the following completed Phase 1 outputs rather than reimplementing them:

| Foundation                                    | Phase 2 use                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| Strict graph contracts and centralized limits | Validate every UI-created entity, clipboard payload, fixture, and projected view     |
| Fixed Yjs schema and deterministic projection | Sole durable graph state and React rendering input                                   |
| Domain commands and command origins           | Sole mutation path for card, edge, boundary, and text edits                          |
| Local Y.UndoManager policy                    | Session-local undo/redo for eligible `LOCAL_EDIT` transactions                       |
| Atomic IndexedDB update/outbox prototype      | Productized local hydration, persistence status, and recovery behavior               |
| Incremental Y.Text textarea proof             | Basis for product text controls; no whole-string replacement per keystroke           |
| Deterministic fixtures                        | Seed data and test inputs, extended only where Phase 2 needs product fixtures        |
| Browser test harness                          | Real Chrome verification of IndexedDB, Web Locks, text editing, and editor workflows |

The Phase 1 audit records these known boundaries that remain relevant:

- Chrome on Windows is the currently verified browser. Phase 2 must not claim Firefox, Safari,
  mobile, IME, bidirectional-text, or grapheme-perfect support without new evidence.
- The current local adapter is a proven persistence primitive, not yet a complete editor-session
  lifecycle. Phase 2 must add deterministic hydration, observable status changes, cleanup, and
  namespace reset behavior.
- The Phase 1 Y.Text harness is not the product editor. Phase 2 must integrate the same incremental
  strategy into accessible controls and rerun browser-backed selection/caret tests.
- Server authentication, membership, rooms, transport, ACKs, and compaction are not implied by the
  Phase 1 spikes and remain outside this phase.

## 4. Scope

### 4.1 Included

- The `/demo` route and a minimal landing route that can enter it without authentication.
- The desktop editor shell: top bar, collapsible palette, canvas, collapsible inspector, and bottom
  viewport controls.
- React Flow rendering as an adapter over `GraphProjection`.
- Component, code, schema, and note cards with the fields and limits in `plan.md`.
- Four fixed incoming/outgoing connection handles per card.
- Connections, visual boundaries, selection, multi-selection, geometry editing, grid snapping,
  alignment, duplication, clipboard operations, deletion, and restore-deleted behavior.
- Plain-text field editing through incremental Y.Text operations and safe local syntax highlighting
  for supported code languages.
- Session-local undo/redo for eligible edits and explicit history boundaries.
- A Zustand store for ephemeral interface state only.
- Productized local IndexedDB hydration and persistence for the demo namespace.
- One-writer-per-board enforcement through Web Locks and cache-change notification through
  BroadcastChannel.
- Truthful local save states and a recovery projection download when local persistence fails.
- A deterministic, version-controlled `web-application` demo fixture instantiated with fresh
  entity IDs on first use or confirmed reset.
- Light, dark, and system themes; visible focus; named controls; dialogs; inline validation; a
  shortcuts reference; and narrow-screen read-only behavior.
- Automated unit, component, browser, and production-build checks required by the Phase 2 gate.

### 4.2 Excluded

- GitHub sign-in, sessions, authenticated dashboard, server board creation, rename, archive,
  duplication, membership, invitations, or role enforcement.
- A production collaboration room, WebSocket sync client, presence, collaborator cursors, drag
  broadcasts, server receipts, server compaction, reconnect, or any “Saved to server” state.
- Service worker installation, offline route caching, update prompts, production-preview offline
  navigation, account switching, revocation recovery, or the full M05 offline product.
- Comments and discussion UI.
- Presentation-step authoring, presentation mode, presenter leases, and following. Step data may be
  present in the demo fixture but is not editable or displayed in Phase 2.
- Checkpoints or checkpoint restore.
- General JSON import, version 1 JSON export UX, SVG export, PNG export, or import security claims.
  A recovery download of the current strict `GraphProjection` is included only to prevent loss
  after local storage failure or before demo reset.
- The `event-processing` and `service-boundary` templates. They remain M07 work. Phase 2 includes
  only the `web-application` fixture required by `/demo`.
- Server-rendering, mobile editing, nested boundaries, semantic grouping, automatic layout,
  arbitrary drawing, rich text, HTML rendering, code execution, URL previews, or file uploads.
- Cross-browser support claims beyond browsers actually recorded in Phase 2 evidence.

## 5. Non-negotiable architecture rules

1. The Y.Doc is the only editable graph state. React Flow nodes and edges are derived render
   models, never a second durable graph store.
2. UI code dispatches exported document-model commands. It must not call `Y.Map.set`, delete entity
   map keys, clear tombstones, or replace nested entity maps directly.
3. Product text controls apply incremental edits through the approved text command/binding. They
   must not replace a complete Y.Text on every input event.
4. React Flow identifiers, measurements, selection flags, DOM nodes, and screen coordinates never
   enter the persisted graph schema.
5. Zustand owns only selection, panels, viewport preferences, drag/resize previews, dialog state,
   clipboard metadata, and other ephemeral interface state. It does not mirror editable graph
   content.
6. IDs, kinds, edge endpoints, and handle IDs remain immutable. Edge reconnection creates a fresh
   edge and tombstones the original.
7. Deletion is append-only tombstoning. Restore creates fresh IDs and never removes or clears a
   tombstone.
8. Boundaries remain independent absolute rectangles behind cards. They are not React Flow parent
   nodes and never create relative coordinates.
9. Local edits become “saved on this device” only after the IndexedDB transaction commits. A
   socket send, memory update, render, debounce, or timer is not a save.
10. Hydration and remote-origin application must not create outbound entries. The demo never opens
    a collaboration socket.
11. All numeric, text, URL, enum, count, and graph-size limits come from shared contracts. UI
    affordances may prevent invalid input, but command/schema validation remains authoritative.
12. Code, schema, note, labels, titles, and URLs are inert data. Do not use raw HTML, `eval`, code
    execution, remote preview fetching, or runtime CDN assets.
13. A second tab never becomes a hidden second writer. It stays read-only until it acquires the
    board's Web Lock after the first writer releases it.
14. Phase 2 must preserve package boundaries: `contracts` and `document-model` remain independent
    of React, React Flow, Zustand, and browser storage; `sync-client` remains independent of React.

## 6. Product surface and route states

### 6.1 Routes

| Route   | Phase 2 content                                             | Required states                                                                                                                      |
| ------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `/`     | Minimal Archboard introduction and “Open local demo” action | Ready and route-level error fallback                                                                                                 |
| `/demo` | Local-only architecture editor                              | Loading local data, seeding, ready/writable, ready/read-only, saving, saved, storage error, reset confirmation, unsupported viewport |

Unknown Phase 2 routes show a useful not-found state with a link to `/demo`. `/boards` and
authenticated editor routes are not stubbed as if they work; they belong to later phases.

### 6.2 Editor layout

- The top bar shows the Archboard/demo identity, an explicit “Local demo” badge, local save status,
  undo/redo, reset, theme, and help/recovery actions.
- The left palette contains create actions for four card kinds and boundaries. It can collapse
  without covering essential canvas controls.
- The center contains the React Flow canvas, background/grid treatment, nodes, edges, boundaries,
  selection rectangle, and empty/loading overlays.
- The right inspector shows fields and actions for the current selection. It has clear empty,
  single-selection, multi-selection, and unsupported-selection states.
- Bottom controls provide zoom in/out, fit-to-content, reset zoom, minimap visibility, and the grid
  snapping toggle.
- Dialogs are used for destructive reset and deleting more than 10 selected objects. Dialog focus
  is trapped and restored to the invoking control.

### 6.3 Truthful status labels

Phase 2 uses local-only wording:

| Label                                 | Exact condition                                                           |
| ------------------------------------- | ------------------------------------------------------------------------- |
| `Loading local board…`                | Web Lock and IndexedDB/session hydration have not completed               |
| `Preparing local demo…`               | Empty demo namespace is being seeded and durably persisted                |
| `Saving on this device…`              | At least one local update awaits IndexedDB commit                         |
| `Saved on this device`                | Hydration is complete and all local persistence work has committed        |
| `Read-only · open in another tab`     | This tab does not own the board Web Lock                                  |
| `Storage error · export your changes` | Persistence failed; editing is paused and in-memory recovery is available |
| `Recovery required`                   | Stored local data cannot be hydrated or validated safely                  |

Do not show `Connecting…`, `Syncing N changes…`, `Offline · cached copy`, or `Saved to server` in
Phase 2. Those labels require transport and server state that this milestone does not have.

## 7. Local editor session and persistence

### 7.1 Namespace and lifecycle

The demo uses a namespace separate from future authenticated data:

```text
deployment origin + local-demo user key + stable demo board ID + graph schema version
```

The board ID remains a valid application UUID. The local-demo user key is an explicit reserved
value, not a fake authenticated user. Future authenticated routes must never enumerate or open the
demo namespace as account data.

Opening `/demo` follows this order:

1. Detect whether the viewport is edit-capable and whether Web Locks are available.
2. Request the exact demo-board writer lock without stealing it.
3. Create a fresh Y.Doc and initialize its required roots.
4. Open the versioned IndexedDB database and read the newest valid local snapshot, if present.
5. Apply later local-log records in increasing local-sequence order with the hydration origin.
6. Validate the complete document and project it before enabling controls.
7. If no local state exists, instantiate the validated demo fixture with fresh IDs and wait for its
   local persistence commit before reporting ready.
8. Attach observable projection/status subscriptions and render the editor.

On unmount, route change, or page shutdown, detach Yjs observers, stop status subscriptions, close
the adapter/database connection, close the BroadcastChannel, destroy the undo manager, and release
the Web Lock. Cleanup must tolerate partial initialization.

### 7.2 Hydration and local compaction

- A local snapshot records exact Yjs state bytes and the highest included local-log sequence.
- Hydration applies at most one current-namespace snapshot and only log entries after its included
  sequence. It never reads another origin, user key, board ID, or schema version.
- Replayed updates use the hydration origin and cannot generate new outbox records.
- Snapshot creation must commit the replacement snapshot before deleting any covered log entries.
  Outbox entries are never deleted merely because a local snapshot includes their content.
- A failed or interrupted local compaction leaves either the old replay path or the new replay path
  usable. Thresholds are named constants and tested at their boundaries.
- Invalid snapshot bytes, sequence gaps, or an invalid hydrated document enter `Recovery required`.
  The tab remains non-editable; recoverable bytes and diagnostics are not silently discarded.
- Schema migration of cached boards is deferred. An unknown schema version must fail explicitly,
  leave the old namespace intact, and never initialize over it.

### 7.3 Persistence barrier and observable status

Every local command update retains the Phase 1 invariant: the exact update bytes enter
`localUpdates` and `outbox` in one IndexedDB transaction before they become transport-eligible.
Phase 2 does not drain that outbox because no transport exists yet.

The productized adapter must provide a subscription or equivalent external-store interface for
status changes. UI code must not poll or infer save completion. Command dispatch first calls the
adapter's editing guard. If persistence enters its error state, later commands are blocked even if
a stale button remains enabled for one render.

The demo interprets completed local persistence as `Saved on this device`; it does not interpret a
nonempty outbox as a failed cloud sync. The durable outbox remains available for the later sync
client architecture, and confirmed demo reset removes all records only from the exact demo
namespace.

### 7.4 Persistence failure and recovery download

On IndexedDB transaction failure:

- Keep the already-rendered in-memory projection available.
- Pause all graph mutation controls and text bindings.
- Show `Storage error · export your changes` without claiming the failed update is reload-safe.
- Offer a recovery download containing a strict, escaped JSON serialization of the current
  `GraphProjection`, a recovery format marker, creation time, and local-only status.
- Keep pan, zoom, selection, inspection, and recovery download available.
- Never clear the namespace automatically or retry in a loop.

This download is a loss-prevention artifact, not the final M07 import/export format. No Phase 2 UI
claims that it can import the recovery file.

### 7.5 One-writer lock

- The writer lock name is derived from the fully resolved storage namespace and a versioned prefix.
- A tab requests the lock without stealing or bypassing a held lock.
- The lock owner alone attaches writable command bindings and the persistence writer.
- A non-owner may hydrate and render a read-only cached view. It announces that another tab is
  editing and offers a user-triggered retry or automatically retries only after a release
  notification, without busy polling.
- When the owner closes cleanly, a waiting tab can acquire the lock, rehydrate changes written by
  the former owner, and only then enable editing.
- BroadcastChannel announces cache changes, reset, and lock-release hints. It is not a second
  Yjs-update transport and does not establish correctness.
- Browsers without Web Locks receive read-only local access and recovery export. A multi-writer
  fallback is deferred.

## 8. Projection and React Flow adapter

### 8.1 Projection subscription

The editor session exposes a read-only snapshot derived by `projectGraphDocument`. Yjs observers
invalidate that snapshot; consumers use a React-compatible external-store subscription so a
concurrent render cannot observe mismatched revisions.

Projection conversion must:

- Preserve graph IDs as React Flow element IDs.
- Map world positions and sizes without storing React Flow internals.
- Map fixed `top`, `right`, `bottom`, and `left` handles deterministically.
- Filter only through the document projection; the view adapter must not invent a separate
  tombstone or dangling-edge policy.
- Create stable node and edge render objects where unchanged inputs allow it, so selection and
  viewport interaction do not rerender the whole graph unnecessarily.
- Render boundaries in a dedicated background layer with selection affordances above their fill
  but below nodes and edges.

React Flow change callbacks are intents, not authoritative mutations. Selection and viewport
changes update ephemeral state. Completed graph changes dispatch domain commands.

### 8.2 Viewport behavior

- Space-drag and middle-button drag pan the canvas.
- Documented wheel/trackpad behavior zooms consistently; controls also expose zoom in and out.
- Fit-to-content includes live nodes and boundaries and applies bounded padding.
- Reset zoom returns to the documented default viewport without mutating graph data.
- The minimap is optional local UI state and never persisted in the graph.
- Viewport and panel preferences may use small origin-scoped local preferences, but they are not
  part of the Y.Doc, local update log, or outbox.
- Core controls have text alternatives and visible keyboard focus; zoom is not mouse-only.

## 9. Graph editing behavior

### 9.1 Card creation and rendering

The palette creates cards at the visible viewport center, offsetting subsequent creations to avoid
perfect overlap. New cards use `crypto.randomUUID()`, contract defaults, the active grid policy,
and these sizes:

| Kind      | Default size | Required editor behavior                                                                  |
| --------- | ------------ | ----------------------------------------------------------------------------------------- |
| component | 240×140      | Category icon, title, description summary, optional technology, safe external-link action |
| code      | 360×240      | Title, language, inert code body, local syntax-highlighted read view                      |
| schema    | 360×240      | Title and fixed-width plain-text body                                                     |
| note      | 240×180      | Title and plain text with preserved line breaks                                           |

All nodes enforce the shared minimum 160×100, maximum 1,600×1,200, coordinate ±100,000, text,
URL, enum, and graph-count limits. Overflow scrolls or truncates with an accessible expand/edit
action. Content measurement never silently changes persisted size.

Supported code languages are text, TypeScript, JavaScript, JSON, SQL, YAML, and shell. Syntax
highlighting uses a pinned, locally bundled, non-executing tokenizer. It does not render raw HTML,
load a runtime CDN, fetch imports, or run snippets. The implementation task must record the chosen
package, bundle impact, and escaping tests.

### 9.2 Inspector and text editing

- A single selected card exposes exactly the fields allowed by its immutable kind.
- A selected edge exposes label, protocol, direction, and style; immutable endpoints/handles are
  displayed and changed only through the reconnect gesture.
- A selected boundary exposes title, color, and numeric rectangle fields.
- Multiple selected nodes expose alignment, color when meaningful, duplicate, copy, and delete
  actions. Unsupported mixed actions are disabled with an explanation.
- Text inputs show remaining length or a clear limit error near the limit. Invalid values remain in
  a local draft only until corrected or cancelled; they never enter the Y.Doc.
- Y.Text controls bind incremental insert/delete deltas, preserve selection under supported remote
  insertions, respect composition events, and define explicit undo capture boundaries on blur or
  deliberate commit.
- Atomic enum, URL, geometry, and color edits validate before dispatch. External URLs accept only
  `http` and `https` and open with safe new-window isolation; no preview request is made.
- Escape cancels an uncommitted local draft. Enter behavior is documented per single-line or
  multiline control and does not accidentally trigger canvas shortcuts.

### 9.3 Selection

- Click selects one object. Shift-click toggles objects. Dragging an empty-area selection rectangle
  selects intersecting nodes and boundaries according to one documented containment policy.
- Edges can be selected by click or keyboard-accessible list/inspector navigation but cannot be
  moved independently.
- Selection stores only IDs and object kinds in ephemeral state. Projection changes remove missing
  IDs from selection without a graph transaction.
- `Escape` clears selection before it exits any higher-level mode.
- React Flow's internal selection is synchronized from the ephemeral selection adapter and is not
  treated as durable content.

### 9.4 Move, resize, snapping, and alignment

- Grid snapping is a local preference, enabled by default, on a 16-world-unit grid.
- Holding Alt during a drag or resize temporarily bypasses snapping.
- Dragging selected nodes previews the group without writing on every pointer move. Drag end commits
  all changed node positions in one local transaction.
- A selected boundary may move or resize independently. Selecting a boundary with nodes and moving
  them commits their absolute rectangles/positions together; containment creates no relationship.
- Resizing commits at pointer/keyboard completion, clamps to shared limits, and never stores screen
  pixels.
- Alignment supports left, horizontal center, right, top, vertical center, and bottom for at least
  two nodes. Each alignment action is one local transaction.
- UI-facing batch geometry commands must be added to `document-model` when existing commands cannot
  preserve transaction atomicity. The React adapter must not open its own Yjs transaction or write
  maps directly.

### 9.5 Connections

- Each card shows the four fixed handle IDs for both incoming and outgoing connections.
- Creating a connection dispatches one complete edge with fresh ID, forward direction, solid style,
  empty label, and empty protocol.
- Self-loops are blocked with feedback; parallel edges are allowed.
- Reconnecting creates a validated replacement edge with a fresh ID and tombstones the original in
  one structural command.
- Direction renders a forward arrow or arrows at both ends. Solid/dashed style and labels are
  visible in the canvas and inspector.
- Missing/tombstoned endpoint edges stay absent because the projection omits them. The adapter does
  not render substitute broken edges.
- Provide a keyboard-accessible alternate connection flow: choose source card and handle, choose
  target card and handle, review, then create or cancel.

### 9.6 Boundaries

- A boundary has a fresh immutable ID, title, absolute `rect`, and color token.
- Boundaries render as labeled translucent background rectangles and remain selectable without
  intercepting ordinary node/edge interaction.
- Moving a boundary alone never moves enclosed nodes. The inspector and help text state this.
- Overlap is allowed, nesting has no semantic meaning, and edges never connect to boundaries.
- Boundary geometry respects the graph coordinate range and 20,000-unit rectangle dimension limit.

## 10. Compound commands and local history

### 10.1 Duplicate, copy, and paste

- Duplicate and paste create fresh IDs for every new object.
- Copying selected nodes includes an edge only when both endpoints are selected. It may include
  explicitly selected boundaries. It never includes presentation steps, comments, permissions,
  or tombstones.
- Clipboard data is a strict, versioned Archboard selection payload validated before use. A
  session-local fallback may support browsers that deny system clipboard access, but the UI must
  disclose failure instead of claiming an OS clipboard copy succeeded.
- Each paste offsets copied geometry by 32 world units; repeated paste may apply successive offsets
  while respecting coordinate bounds.
- Paste is all-or-nothing: preflight IDs, limits, references, and geometry, then create the batch in
  one structural transaction.
- Ordinary paste while editing text retains native text behavior.
- External plain text creates a note only through an explicit `Paste as note` action. General
  canvas paste never silently converts arbitrary clipboard text into a card.

### 10.2 Delete and restore

- Delete gathers the current live selection and its internal edges into one validated capture
  before mutation.
- Deleting more than 10 selected objects requires confirmation. Smaller deletions execute directly
  and show `Restore deleted objects` feedback.
- The delete command tombstones the selected objects and internal edges atomically. External edges
  incident to a deleted node remain hidden by projection and are not recreated by restore.
- Only the most recent deletion capture is restorable, and only until reload or a demo reset.
- Restore uses `restoreDeletedObjects`, fresh IDs, remapped internal edges, and current capacity
  checks. Old tombstones remain unchanged.
- Create, delete, duplicate, paste, and restore are excluded from generic Ctrl/Cmd-Z. Help text and
  deletion feedback state this clearly.

### 10.3 Undo and redo

- Ctrl/Cmd-Z and Ctrl/Cmd-Shift-Z operate the session-local Y.UndoManager.
- Eligible history includes text/property edits, completed moves/resizes, alignment, and boundary
  property/geometry edits.
- History tracks only local edit origins. Hydration, future remote-origin updates, structural
  creation/deletion, and ephemeral previews are excluded.
- Explicit stop-capturing boundaries prevent separate completed gestures or field commits from
  collapsing into an unexpected single history item.
- Undo entries whose targets were tombstoned are skipped with feedback rather than resurrecting
  them.
- The history stack clears on reload and reset.

### 10.4 Keyboard command policy

At minimum, Phase 2 documents and implements shortcuts for selection clearing, delete, duplicate,
copy, paste, undo, redo, fit-to-content, zoom, and opening the shortcuts dialog. Commands are
inactive while focus is in an editable control except for native/editing undo, redo, copy, paste,
and explicitly scoped text commands. Shortcuts use platform-appropriate Ctrl/Cmd labels.

## 11. Demo behavior

### 11.1 Initial fixture

`/demo` instantiates a version-controlled `web-application` fixture with fresh IDs. It contains at
least:

- Browser, API service, database, and cache component cards.
- HTTPS, SQL, and cache connections.
- A named backend boundary.
- A request-payload code card.
- Four presentation-step records following a request path, retained in the document for future
  presentation work but not exposed for editing in Phase 2.

The fixture passes the same strict graph schema and hydration path as user edits. Its layout is
legible at fit-to-content. Phase 2 may add schema and note cards to the sample if useful, but the
palette and acceptance tests must independently prove all card kinds even if the sample does not
show them initially.

### 11.2 Reset

- Reset requires a dialog explaining that the exact local demo namespace will be replaced.
- The dialog offers recovery download before reset.
- Confirmation keeps the writer lock held, detaches the current document/adapter, deletes only
  records whose resolved namespace equals the demo namespace, creates a fresh Y.Doc, remaps fixture
  IDs, persists it, clears local UI/history, and then reports ready. Other tabs are notified only
  after the replacement state commits.
- Reset never touches future authenticated namespaces, unrelated origins, or other schema-version
  namespaces.
- Cancellation leaves document, persistence records, selection, and history unchanged.

## 12. Accessibility, responsive behavior, and visual quality

- Use semantic buttons, labels, field descriptions, and dialogs. Icon-only controls have accessible
  names and tooltips; color is never the only indication of selection, card category, edge style,
  validation, or save state.
- Maintain visible focus through panels, inspector fields, dialogs, viewport controls, and the
  alternate connection flow.
- Announce save-state changes, storage errors, deletion/restore results, and lock changes through a
  non-disruptive live region.
- The palette, inspector, and toolbar are keyboard reachable in logical order. Canvas objects have
  named focus targets and expose selection/edit actions without relying exclusively on drag.
- Light, dark, and system themes use design tokens and meet readable contrast. Graph color tokens
  remain semantic tokens rather than persisted CSS values.
- At narrow widths, show the board in read-only inspect mode where practical and a clear message
  that full editing requires a desktop-sized viewport. Do not expose partially working drag or
  resize controls.
- Loading uses a stable shell/skeleton rather than briefly rendering an empty editable document
  before hydration.
- Errors are actionable and preserve the current projection whenever safe.

Phase 2 includes a keyboard-only create/edit/connect workflow and screen-reader spot check for the
local editor portions of A28. Full keyboard presentation behavior remains M07; the complete A28
release assertion remains open until then.

## 13. Performance and safety budgets

Phase 2 is measured against the local portions of the plan's initial budgets:

| Scenario                             | Phase 2 target                                                                                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Cached 200-node/400-edge local board | Interactive within 2 seconds after route load on the recorded reference machine                             |
| Pan/drag at 200 nodes/400 edges      | p95 frame time at or below 32 ms on the recorded reference machine                                          |
| Ordinary drag/resize                 | No durable graph update per pointer-move event; one commit per completed gesture                            |
| Projection updates                   | Unchanged graph objects retain stable adapter identity where practical; no full document clone into Zustand |
| Live counts                          | UI and commands enforce 500 nodes, 1,000 edges, and 50 boundaries                                           |
| Local encoded state                  | 10 MiB shared limit remains authoritative, including tombstoned/history structures                          |

Use deterministic typical and limit fixtures. Record OS, CPU, memory, browser/version, build mode,
sample count, fixture counts, measurement method, and raw summary. Missing a target requires a
documented optimization or explicit proposed budget amendment; it must not be silently reported as
a pass.

Clipboard, recovery JSON, external URLs, code highlighting, and rendered text require negative
tests proving that script/HTML payloads remain inert and that opening an external URL never gives
the destination access to the editor window.

## 14. Work breakdown

Tasks are completed in dependency order. Each task owns a bounded module set and an evidence file.
Exact internal filenames may evolve, but responsibility and contracts must remain clear.

| ID    | Task                                              | Depends on          | Primary output                                                                                                                    | Completion evidence                                                                                         |
| ----- | ------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| P2-01 | Editor toolchain and package boundaries           | Phase 1             | Pinned React Flow, router, Zustand, styling/UI, component-test, and local syntax-highlighting dependencies; web feature structure | Frozen install, strict typecheck, boundary checks, and independent web build pass                           |
| P2-02 | UI-facing document commands                       | P2-01               | Atomic batch move, mixed geometry, batch create/delete, and any selector/access APIs needed by the UI                             | Command tests prove one transaction, validation-before-mutation, immutable fields, and unchanged tombstones |
| P2-03 | Productize local persistence                      | P2-02               | Deterministic hydration, snapshot/log replay, safe local compaction, observable status, exact-namespace reset, cleanup            | Real-browser reload and injected-failure tests pass; hydration emits no outbox duplicates                   |
| P2-04 | Single-writer editor session                      | P2-03               | Web Lock lifecycle, BroadcastChannel hints, writable/read-only session state, unsupported-browser behavior                        | A12 passes in two independent tabs/pages with lock transfer and rehydration                                 |
| P2-05 | Routes, shell, theme, and ephemeral store         | P2-01               | `/`, `/demo`, route errors, editor layout, theme tokens, Zustand UI slices                                                        | Component tests prove state separation and required route/layout states                                     |
| P2-06 | Projection and canvas adapter                     | P2-02, P2-04, P2-05 | External-store projection hook, React Flow adapters, viewport controls, stable boundary layer                                     | Fixture renders with correct IDs/geometry/handles; no React Flow state enters Y.Doc                         |
| P2-07 | Cards, palette, inspector, and Y.Text controls    | P2-06               | All card renderers, create controls, validated inspector, incremental text binding, safe code highlighting                        | All kinds create/edit; browser tests prove incremental text/caret behavior and inert payload rendering      |
| P2-08 | Edge creation and editing                         | P2-06, P2-07        | Fixed handles, edge renderer, reconnect, inspector, keyboard alternative                                                          | Valid create/edit/reconnect passes; self-loop, immutable endpoint, and malformed-handle cases fail safely   |
| P2-09 | Selection, geometry, alignment, and boundaries    | P2-06               | Multi-selection, preview/commit movement, resize, snap/Alt bypass, six alignments, boundary layer/editing                         | One durable transaction per completed gesture; limits and absolute boundary semantics pass                  |
| P2-10 | Clipboard, delete/restore, history, and shortcuts | P2-07, P2-08, P2-09 | Validated copy/paste/duplicate, deletion confirmation/capture, restore action, undo/redo, command routing                         | A13/A14 and clipboard fresh-ID/internal-edge assertions pass in browser tests                               |
| P2-11 | Demo seed, reset, save/recovery UX                | P2-03, P2-05, P2-10 | Fresh-ID web-application fixture flow, truthful status UI, recovery download, scoped reset                                        | A01 local assertion passes; reload/reset/failure states preserve or remove exactly the intended data        |
| P2-12 | Accessibility and performance verification        | P2-11               | Keyboard workflow, screen-reader notes, narrow-screen mode, deterministic measurements                                            | Local A28 subset passes; 200/400 fixture results are recorded against named targets                         |
| P2-13 | Phase audit and handoff                           | All prior tasks     | Final evidence matrix, exact commands/results, documented risks and later-work boundary                                           | Every Phase 2 exit criterion links to passing evidence or an explicit blocker                               |

Tasks with satisfied dependencies may be implemented in parallel only when they do not share
manifests, root configuration, or feature modules. The integrating agent owns dependency conflicts
and reruns affected checks after integration.

## 15. Verification requirements

### 15.1 Static and build checks

- Install succeeds from the committed lockfile with no floating direct dependency versions.
- Formatting and lint checks pass.
- Every package and application passes strict TypeScript checks without suppressed errors.
- The web production build succeeds independently.
- Dependency checks prove that `contracts` and `document-model` do not import React, React Flow,
  Zustand, Nest, or browser persistence, and that `sync-client` does not import React.
- A production bundle contains no backend database/auth secret names and no runtime CDN dependency.

### 15.2 Model and adapter checks

- UI-created nodes, edges, boundaries, and clipboard payloads pass shared strict schemas.
- Invalid enums, handles, URLs, sizes, coordinates, text lengths, count limits, and unknown keys fail
  before graph mutation.
- Batch commands are atomic and generate one eligible local update for one completed user action
  where this document requires a single transaction.
- Projection-to-React-Flow conversion is deterministic and preserves fixed IDs/handles/geometry.
- Text controls produce incremental Y.Text edits and retain supported selection behavior.
- Drag previews, viewport, selection, panels, dialogs, and theme never appear in graph projection or
  local graph history.

### 15.3 Browser and acceptance evidence

Phase 2 must prove these acceptance-test portions from `plan.md`:

| Test             | Phase 2 assertion                                                                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01              | In a fresh local test/demo namespace, create two component cards, connect them, wait for `Saved on this device`, reload, and preserve IDs, content, geometry, and edge endpoints |
| A12              | Two tabs open the same namespace; exactly one can mutate, the other is read-only, and lock transfer rehydrates the former writer's committed changes before enabling edits       |
| A13              | Apply a remote-origin edit in the harness, then undo a local edit; the remote contribution remains and local gesture/field boundaries are respected                              |
| A14              | Delete a selection and restore it; restored objects have fresh IDs, internal edges are remapped, external edges are not recreated, and original tombstones remain                |
| A22 regression   | Inject IndexedDB failure; no saved label appears, mutation controls pause, and the current in-memory projection can be downloaded for recovery                                   |
| A28 local subset | Complete local create, edit, alternate connect, inspect, delete/restore, and viewport operations by keyboard with named controls and visible focus                               |

A01 in this phase proves the local editor/reload portion, not authenticated server board creation.
A28 remains partially open until presentation is implemented. A06 and A25 remain open because
Phase 2 does not install or test the production service worker/offline shell.

Additional browser tests must cover:

- First-use demo seeding versus existing-state hydration.
- Direct `/demo` refresh in a served production build while online.
- All card kinds, all handles, both edge directions/styles, and boundary overlap.
- Grid snapping and Alt bypass; all six alignment actions; multi-node and mixed
  boundary/node movement.
- Copy/paste offsets, fresh IDs, internal-edge filtering, and explicit paste-as-note.
- More-than-10 deletion confirmation and cancellation.
- Reset scoping and recovery download before reset.
- Storage failure during a text edit and during a structural edit.
- Unsafe HTML/script-like text, code, clipboard, and external-URL inputs remaining inert.
- Narrow-screen editing disabled while viewing/recovery actions remain coherent.

### 15.4 Test realism

- IndexedDB checks run in a real supported browser, not a memory-only substitute.
- A12 uses two independent browser pages/contexts sharing the intended storage namespace; two React
  components in one tree do not prove locking.
- Reload tests close and rebuild the editor session from IndexedDB bytes. Reusing the existing
  in-memory Y.Doc does not prove persistence.
- Text merge/undo tests use independent Y.Docs and origin labels where remote behavior is asserted.
- Pointer/keyboard workflows exercise the rendered editor, not only document-model functions.
- Performance measurements use a production build and deterministic fixtures.
- Failure injection is deterministic and verifies unchanged durable state, not only an error toast.

## 16. Required verification commands

The repository must expose and document concrete commands for the checks below. Exact script names
may be introduced during implementation, but Phase 2 should converge on a single aggregate gate
such as `pnpm phase2:verify`.

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:browser
pnpm --filter @archboard/document-model test
pnpm --filter @archboard/sync-client test
pnpm --filter @archboard/web test
pnpm --filter @archboard/web test:browser
pnpm --filter @archboard/web build
pnpm build
pnpm phase2:verify
```

The final audit records the exact commands that exist at that point, test counts, durations when
useful, browser/runtime versions, and PASS/FAIL/UNRUN. An aggregate command does not replace
reporting the meaningful checks it invokes.

Phase 1 regression tests remain mandatory. A Phase 2 change to the document model, sync client,
fixtures, lint boundaries, or package manifests must not invalidate `pnpm phase1:verify`; tests
that require existing local database credentials are recorded honestly if unavailable, but Phase
2 cannot be closed by deleting or weakening those checks.

## 17. Deliverables

Phase 2 is complete only when these deliverables exist and agree:

1. Pinned frontend/editor dependencies and updated lockfile.
2. Routed web shell with `/` and `/demo` states.
3. React Flow projection adapter with nodes, edges, boundaries, and viewport controls.
4. Renderers and editors for component, code, schema, and note cards.
5. Palette, selection model, inspector, connection workflow, resize/move/snap/alignment behavior,
   and accessible alternate actions.
6. Command-only duplicate, copy, paste, delete, restore, undo, and redo flows.
7. Productized local adapter with hydration, status subscription, local snapshot/log handling,
   scoped reset, cleanup, and recovery behavior.
8. Web Lock single-writer session and read-only secondary-tab experience.
9. Deterministic `web-application` demo fixture instantiated with fresh IDs.
10. Truthful local-only save/error UI and recovery projection download.
11. Light/dark/system themes, shortcuts dialog, visible focus, narrow-screen behavior, and recorded
    accessibility spot checks.
12. Browser-backed A01/A12/A13/A14 evidence plus A22 regression and local A28 subset.
13. Recorded local interaction/opening performance measurements using the named fixture.
14. A root Phase 2 verification command and updated README instructions.
15. `docs/phase-2-editor.md` containing the final task/evidence matrix, measurements, limitations,
    and pass/block decision.
16. Per-task evidence under `docs/evidence/phase2/` using the handoff format below.

## 18. Exit gate

Phase 2 passes when:

- Every P2 task is complete or explicitly marked blocked with reproducible evidence.
- The lockfile reproduces a clean install and all Phase 2 static, unit, browser, and build checks
  pass.
- The Phase 1 regression gate still passes or any environment-dependent unrun portion is documented
  without weakening Phase 1 implementation guarantees.
- `/demo` opens a validated, fresh-ID local sample and never contacts a collaboration room.
- Every card kind, edge contract, boundary, inspector field, and required canvas operation works
  through domain commands.
- React Flow and Zustand are adapters/ephemeral state only; the Y.Doc remains the sole editable
  graph state.
- A01's local create/connect/reload behavior passes after a confirmed device-save state.
- A12 proves exclusive writing and correct lock transfer across two tabs.
- A13 proves local undo preserves a remote-origin contribution.
- A14 proves fresh-ID restore, internal-edge remapping, and unchanged tombstones.
- The A22 regression proves that a persistence failure never reports saved state, pauses editing,
  and leaves an in-memory recovery download available.
- Text controls use incremental Y.Text operations and pass the supported-browser caret/selection
  cases.
- Drag and resize preview locally and commit once per completed gesture; alignment is one
  transaction.
- Clipboard and code/text rendering negative tests show that untrusted content remains inert.
- The local A28 keyboard workflow is usable with named controls and visible focus, and remaining
  presentation coverage is explicitly deferred.
- Performance results are recorded honestly against the 200-node/400-edge targets.
- The final audit distinguishes local reload persistence from service-worker offline capability and
  contains no claim of authentication, server durability, collaboration, or release readiness.

If a required proof fails, Phase 2 remains open. Fix the implementation or propose a targeted
contract amendment with the failed evidence and consequences; do not relabel a missing product
behavior as a later-phase concern when it is included above.

## 19. Handoff record

Each Phase 2 task report must contain:

```text
Task: <P2-ID and title>
Implemented behavior: <observable result>
Changed files/modules: <owned scope>
Contracts used: <schemas, commands, origins, limits, and invariants>
Checks run: <exact commands>
Results: <PASS/FAIL/UNRUN with counts, browser, and measurements when relevant>
Failure injection: <failpoint and unchanged state proved, or not applicable>
Accessibility evidence: <keyboard/screen-reader result, or not applicable>
Known gaps: <honest unresolved items>
Decision or amendment: <none, or link and rationale>
Next dependency unlocked: <task ID or phase exit>
```

The final handoff links every exit criterion to a test, build result, measurement, or audit section.
Unrun checks are labeled unrun. Mocked DOM, storage, clipboard, pointer, or lock evidence is labeled
as such and cannot satisfy a gate that requires a real browser. No evidence file may contain
secrets, cookies, database URLs, private clipboard content, or full environment dumps.
