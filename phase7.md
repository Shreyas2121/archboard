# Archboard — Phase 7: Presentation and Portability

Version: 1.0<br>
Date: 1 October 2026<br>
Status: Implementation specification<br>
Governing specification: `plan.md` version 1.1<br>
Prerequisites: Phase 4 durable collaboration and committed-state access; Phase 5 offline,
account, and recovery lifecycle. Integrate with Phase 3 board permissions/creation and Phase 6
resource invalidation. Read `docs/phase-4-collaboration.md`, `docs/phase-5-offline.md`,
`docs/phase-3-identity-boards.md`, and `docs/phase-6-discussion-sharing.md` before deriving tasks.

## 1. Purpose and authority

This document defines milestone M07: named presentation steps and optional live following,
immutable checkpoints restored as new boards, versioned JSON import/export, controlled SVG/PNG
export, and three bundled templates. These features turn the collaborative editor into a tool
for explaining, preserving, and sharing architecture content without introducing another graph
write path or copying access/discussion history.

`plan.md` is the product and architecture authority. This file translates its requirements into
bounded work, dependency order, observable evidence, and an exit gate. In a conflict, use the
user's latest written instruction, then `plan.md`, then this document, then implementation
details. MUST means required for Phase 7. DEFERRED means later milestone work, not removed from
version 1. This document is a plan, not implementation evidence, deployment authorization, or a
claim that any acceptance case passes. It does not authorize implementation or database changes.

M07 depends on M04 and M05. Phase 3 supplies identity, permissions, and transactional board
creation; Phase 6 supplies compatible relational invalidation and discussion/access exclusions.
The Phase 4, Phase 5, and Phase 6 audits retain OPEN gates. Implementation can continue against
those foundations while required evidence remains deferred; Phase 7 does not certify them.

### Version 1 implementation verification pause

All database checks/tests are deferred until the entire Version 1 implementation, M00–M08, is
complete. This includes PostgreSQL/Neon integration, database-backed HTTP/auth/session/socket
tests, schema/migration inspections, diagnostics used for verification, and aggregates with
database children, including `--non-browser` modes. Completing Phase 7 does not resume them.

Browser checks remain independently paused until the user explicitly resumes them. Do not run
Playwright, native browser package tests, served preview flows, `pnpm test`, `pnpm test:browser`,
`pnpm phase4:quick`, or full phase verifiers that launch browsers.

Run focused database-free, non-browser formatting, lint, types, builds, static scans, boundaries,
and meaningful unit/Node tests. Implement needed database/socket/browser tests without executing
them. Record database boundaries as **UNRUN (deferred by user — until Version 1 implementation
is complete)** and browser boundaries as **UNRUN (deferred by user)**. The shared
[verification policy](docs/verification-policy.md) overrides check execution instructions below.
Tasks and later milestones may proceed with OPEN acceptance gates. Historical observations stay
attached to their original builds; substitute checks cannot close phase or release gates.

## 2. Phase outcome

An owner/editor adds named steps, captures a world-coordinate view and highlights, writes notes,
and orders the walkthrough. Any reader can present the available steps locally, including a
cached board offline. Local navigation changes only that participant's viewport. In an active
live board, one owner/editor acquires the presenter lease; other participants explicitly choose
to follow. Panning or leaving presentation stops following, and subsequent presenter messages
do not take control again. Disconnect or lease expiry returns followers to local control.

An online owner/editor with locally persisted changes fully acknowledged creates a named
checkpoint at an exact committed server sequence. Readers inspect that immutable graph and can
restore it as a new private board with fresh IDs. Editing either board cannot change the other,
the checkpoint, or offline clients of the original board.

A reader exports current local projected content as versioned JSON, SVG, or PNG. JSON retains
full technical text and truthfully labels synchronization state. Image export renders the graph
through a controlled renderer, supports scope/background/PNG scale options, and enforces output
bounds. JSON import validates the entire file before creating a new private board online. Three
bundled templates use the same validation/remapping path and populate new boards only.

## 3. Consumed baseline and open dependencies

| Existing foundation                                          | Phase 7 use and verification                                                             |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Shared graph/HTTP/protocol schemas and limits                | Reuse strict step types, presenter events, envelopes, IDs, decimal sequences, and bounds |
| Document-model step commands, projection, remapping, undo    | Complete missing behavior through domain commands; keep Yjs roots and delete-wins rules  |
| Phase 2 canvas, inspector, geometry, and local demo          | Add presentation and export controls using world-coordinate selectors                    |
| Phase 3 Better Auth, permissions, board creation/duplicate   | Reuse current-role checks, private ownership, caps, and creation idempotency             |
| TypeORM migrations and checkpoint table                      | Inspect source before adding a forward migration for a real gap                          |
| Phase 4 room queue, committed-state reader, singleton writer | Serialize checkpoint capture with graph/access/archive writes                            |
| Phase 4 transport/liveness and presenter contract            | Complete the ephemeral lease and authorized fanout without graph updates                 |
| Phase 5 local persistence, outbox, cache, recovery           | Distinguish local export from committed copying; preserve account-scoped pending work    |
| Phase 6 invalidation and query lifecycle                     | Re-fetch checkpoint metadata after commits/reconnect; isolate late responses             |
| Fixtures and `/demo` sample                                  | Finish all template contents and instantiate with fresh IDs                              |

Begin with a source inventory, not a replacement implementation. Step commands and ID remapping
already have package entry points; inspect their semantics, strict validation, reference
filtering, and test coverage. Inventory presenter protocol/client handling, checkpoint entities,
board initialization, the existing web-application fixture, and export package availability.
Do not infer an integrated feature from a DTO or a placeholder route.

Read `apps/web/AGENTS.md` before frontend work and `apps/api/AGENTS.md` before API work. Preserve
package boundaries: `contracts`, `document-model`, and `export` import neither React nor Nest;
`sync-client` has no React dependency. Use existing feature layouts where suitable.

Carry inherited findings from current audits into task evidence. Historical collaboration
visibility, presence fanout, configured migrations, package boundaries, and missing offline
proof remain attached to their original evidence. Resolve a binding ordering/access/schema
failure in its owning layer before passing the dependent criterion. Source inspection during
the pause does not prove configured database state; do not run diagnostics to update that claim.

## 4. Scope

### 4.1 Included

- Step creation, title/notes editing, rectangle/highlight capture, reorder, deletion, local undo
  for supported property/reorder edits, and deterministic concurrent projection.
- Local presentation with named step navigation, highlights, notes, keyboard controls, and
  truthful empty/deleted-target/offline states.
- Single ephemeral presenter lease, authorized step broadcasts, explicit follow/unfollow,
  liveness expiry, disconnect/access handling, and current-state delivery on join.
- Checkpoint list/create/read/restore-as-new APIs and UI, immutable committed snapshots,
  decimal sequence checks, transaction-safe cap/idempotency, and resource invalidation.
- Versioned JSON export/import, strict full-file validation, all-ID remapping, and reuse of
  committed duplicate initialization without copying permissions/discussion/history.
- Pure SVG renderer, in-browser PNG rasterization, scope/background/scale choices, dimensions,
  XML escaping, clipping, and clear download/failure states.
- `web-application`, `event-processing`, and `service-boundary` fixtures, dashboard creation,
  blank-board distinction, and local-only `/demo` integration.
- Security, account/offline/recovery behavior, focused accessibility, A16–A18/A21 evidence,
  verifier interfaces, final audit, and Phase 8 handoff.

### 4.2 Excluded

- PDF, Mermaid, arbitrary historical time travel, checkpoint editing/deletion, automatic
  checkpoints, live-board rollback, and replacing a live Y.Doc from imported JSON.
- Offline server-board creation/import/duplication/checkpoint mutation, inserting templates
  into existing boards, or merging imports into live collaborative documents.
- Presenter ownership transfer, durable presenter identity, shared viewport persistence,
  forcing participants to follow, multiple presenters, audio/video, and presentation recording.
- Rich HTML/Markdown, remote images/fonts, screenshots of the editor DOM, file uploads,
  external template catalogs, executable snippets, arbitrary CSS, and paid dependencies.
- Copying comments, memberships, invitations, checkpoint history, credentials, CRDT history,
  or presence to exports/new boards.
- Release-wide accessibility/performance/backup/deployment acceptance: Phase 8. Phase 7 still
  requires keyboard access, bounded work, inert content, and honest evidence for its features.

## 5. Non-negotiable architecture rules

1. Steps belong to the existing Y.Doc `steps` map. Text uses Y.Text; rect and reference arrays
   are atomic values. Only domain commands mutate graph fields; never maintain a second
   editable presentation array or rename the physical schema.
2. Presentation viewport, selected step, follow preference, and presenter lease are transient
   state. Durable graph edits occur only when explicitly authoring a step, not when presenting.
3. Only the server grants the lease. Current session/role/archive checks and board ordering
   apply to control events; cached UI roles and client identity fields grant no authority.
4. Checkpoints capture the last committed graph through the same board queue as updates,
   archive/access mutations, and room snapshots. Their sequence is a decimal string, not a
   JavaScript number or metadata version.
5. PostgreSQL owns checkpoint bytes/metadata and creation receipts. Client graph state or a
   REST JSON save cannot define a checkpoint or overwrite the accepted live graph.
6. Restore, import, templates, and duplicate create new private boards through a shared validated
   initialization/remapping path. Source identity/history and offline namespaces remain intact.
7. JSON export captures the current projected local graph, including pending edits, with an
   honest sync label. Committed duplicate and checkpoints do not silently include pending edits.
8. Strict import validation is stronger than live-reference tolerance. Reject a malformed file
   completely before creating records; never partially accept or repair it silently.
9. All new objects get fresh application UUIDs with one complete mapping and remapped references.
   Do not reuse Yjs internal client IDs, source object IDs, tombstones, or snapshot history.
10. SVG is generated from the projection using controlled primitives and escaped XML. No scripts,
    event handlers, remote resources, arbitrary markup, or `foreignObject` are permitted.
11. Failed/uncertain REST requests, rasterization, or downloads never become success states.
    Preserve source content and exact retry context; export never clears or acknowledges an outbox.
12. Every read/restore is board-scoped and currently authorized. Account/access transitions cancel
    or isolate in-flight results; recovery bytes remain in their original account namespace.
13. Discussion/access data remains server-owned and absent from portable graphs and new-board
    copies. Authenticated checkpoint responses are not service-worker runtime cache entries.

## 6. Presentation authoring and local playback

### 6.1 Step data and commands

Use the `PresentationStep` and physical schema from `plan.md` sections 8.2–8.3:

```ts
type PresentationStep = {
  id: string;
  title: string;
  notes: string;
  order: number;
  rect: { x: number; y: number; width: number; height: number };
  nodeIds: string[];
  edgeIds: string[];
};
```

Enforce shared title/text/rectangle limits: notes at most 4,000 characters, integer order within
±1,000,000, at most 500 unique highlight references per step in total, and at most 50 live steps.
Rectangles use finite world coordinates within ±100,000 and positive dimensions up to 20,000.
Use shared string-counting/validation conventions; do not introduce a different UI limit.

Capture a step's rectangle by converting the current visible canvas to world coordinates.
Highlight capture uses selected live node/edge IDs; boundaries are not highlight targets. A
step may have no highlights. Title/notes bind to Y.Text and preserve concurrent inserts.
Rect edits update the atomic rect only; reference edits update their own arrays only.
Initialize a new step completely in one local transaction.

Sort every list and playback view by `(order, id)`. Reorder affected order values in one command
transaction, staying within bounds. Drag/drop has keyboard move-earlier/move-later alternatives.
Concurrent reorders need convergence, not a promise that either author's intended order wins.
Preserve property/reorder local undo boundaries and remote contributions; generic undo excludes
creation/deletion under the existing policy. Deletion adds `deletedSteps` tombstones and never
physically removes a map or clears a tombstone.

Authoring requires current owner/editor permission on an active board; offline authoring uses
Phase 5 cached-authority, local writer-lock, and durability rules. Viewers/archived boards can
read/present existing steps but cannot change them. Storage failure pauses authoring while
available local content stays exportable.

### 6.2 Local presentation behavior

Presentation hides editing controls and exposes named previous/next/exit controls, current
step/title/count, and readable plain-text notes. Left/right changes steps and Escape exits.
Do not hijack native typing shortcuts in editable controls. Preserve visible focus and return
focus to the invoking control on exit. An empty board explains that no steps exist.

Fit the active step's world rectangle to the available viewport without writing viewport state
to Y.Doc. Highlight referenced live objects; ignore targets deleted concurrently. Notes and
the captured rectangle keep a step usable without highlights. React Flow selection/edit handles
are not presentation highlights and do not appear in exports.

If the active step disappears, clear its active highlight and provide an explicit remaining-step
choice or empty state. Do not silently recreate it or write an automatic durable reorder. Pure
local presentation works offline on available cached content and in `/demo`. Local playback
does not acquire a lease or move anyone else's viewport.

## 7. Live presenter lease and following

### 7.1 Existing protocol and server authority

Complete the existing version 1 events; do not invent a parallel presentation socket:

| Direction/event         | Data                                                 | Required behavior                                                    |
| ----------------------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| C→S `presenter.acquire` | Empty object                                         | Current owner/editor of active board requests the single lease       |
| C→S `presenter.step`    | `stepId`                                             | Lease holder selects a live committed step                           |
| C→S `presenter.release` | Empty object                                         | Holder releases; nonholder cannot release another connection's lease |
| S→C `presenter`         | `connectionId/null`, `stepId/null`, `expiresAt/null` | Server-derived current lease/step or cleared state                   |

Lease identity is the authenticated connection, not just the user; another tab of the same user
does not share control. Serialize acquisition, release, expiry, and access changes with room
operations so simultaneous acquire requests yield one holder. A competing request receives a
safe explicit error/current state and cannot steal the lease. Repeated acquisition by the same
holder is harmless. Malformed, unauthorized, nonholder, or missing/deleted-step requests do not
change lease state or graph bytes.

Lease expires on disconnect or after 30 seconds without heartbeat. Reuse the existing transport
liveness/ping-pong mechanism, with activity tracked for the holder, and prove expiry independently
of the 45-second dead-socket timeout. Do not let an unrelated peer renew it. If the pinned
transport needs an explicit heartbeat DTO, document the targeted protocol amendment before
changing the shared version 1 contract.

Role downgrade, removal, session expiry, archive, or room shutdown clears a holder's authority
and notifies authorized readers. A deleted active step clears the active step while the lease
may remain available for selecting another. Initial join/reconnect sends current presenter state
after authenticated `ready`; later events preserve ordering and never disclose protected content
to removed readers. Process restart has no persisted presenter lease.

Presenter events do not create Yjs updates, receipts, ACKs, checkpoint rows, `latest_seq`
increments, content timestamps, or outbox entries. Apply strict DTO bounds and suitable transient
rate limiting using the existing transport protections; do not introduce an undocumented product
rate target. Pending local steps must synchronize before they can be broadcast as committed IDs.

### 7.2 Explicit follow and release of local control

Participants see presenter availability and explicitly choose **Follow presenter**. Merely
receiving a `presenter` frame, joining the room, or entering local presentation does not opt in.
Only a followed live lease can update the local active step/viewport.

Panning locally, leaving presentation, or selecting an explicit unfollow action immediately
leaves follow mode. Subsequent step messages leave that viewport untouched: this is A21. Lease
loss/expiry also clears follow mode and restores local navigation without writing graph data.
Require a fresh explicit opt-in after reconnect, account/board change, or a new presenter lease;
do not automatically reacquire presentation or reinstate following from a previous connection.

Unknown or not-yet-available step IDs must not select arbitrary content. Reconcile against the
current projected graph, expose a waiting/unavailable state if needed, and fit only a valid
available step while the same opted-in lease remains current. Stale lease frames or responses
from a prior connection/board cannot move the new view. Viewers may follow/read; they cannot
acquire the lease or broadcast a step.

## 8. Checkpoints and committed-state capture

### 8.1 Records, queue, and transaction

Reuse the existing `checkpoints` table: UUID ID, board FK, name, server creator, decimal
`through_seq`, schema version, immutable Yjs `update_bytes`, and server creation time. Index
lists by `(board_id, created_at, id)`. Inspect entities and migrations by source; add a committed
forward migration only for a real gap. Never modify applied migrations, enable schema sync, or
create a parallel JSON source of truth.

Checkpoint creation requires connectivity, current owner/editor role, active board, a trimmed
name of 1–120 characters, and `expectedSeq`. The requesting client must have no pending local
persistence or unacknowledged outbox entries; an empty in-flight send alone is insufficient.
Disable creation until the actual durability state is settled and explain why. The server can
validate the sequence and authority, but cannot prove that the client has no undisclosed edits.

Within the shared board queue, load/read the committed document, use a transaction/board lock
to recheck authority/archive/current sequence, enforce 100 checkpoints per board, capture the
complete committed state at that sequence, insert immutable metadata/bytes, and store the
creation idempotency result atomically. Concurrent update/archive/capture ordering determines
the result. `expectedSeq` mismatch returns 409 without a checkpoint; refresh and let the user
explicitly retry the newly selected committed sequence. Never capture an in-memory candidate,
unacknowledged client projection, or an inconsistent snapshot/log pair.

Other participants may continue editing before/after capture. The returned `throughSeq` defines
what was captured. Checkpoint creation does not advance graph sequence or produce a graph ACK.
Only after commit emit `invalidate` for `checkpoints` to authorized readers. Rollback/cap/error
emits no successful hint. At cap show a clear disabled creation state; deletion is deferred.

### 8.2 Read-only inspection and restore as new

List metadata with stable REST pagination; display name, creator, time, and captured sequence.
GET detail derives a validated GraphProjection from checkpoint bytes without mutating them.
Resolve checkpoint ID together with the path board and current membership. Viewers and readers
of archived boards may list/inspect/restore; archive blocks new checkpoint creation.

The `/boards/:boardId/checkpoints/:checkpointId` route is a read-only snapshot view with
loading, ready, unavailable/error/retry, and restore-as-new states. No connection or domain
command can write into the live source board from that view. Fresh offline checkpoint fetching
is unavailable; optional previously fetched inspection must be account-scoped and visibly stale,
without caching authenticated API responses in the service worker.

**Restore as new board** creates a new private board owned by the caller online, for any current
reader. Validate/project the captured content, remap every live entity/reference, construct a
fresh Y.Doc, and atomically initialize the new board using the same path as import/duplicate.
Do not clone checkpoint Yjs bytes into a new board as history or replace the original Y.Doc.
Exclude comments, invites, memberships, prior checkpoints, old receipts/sequences, and tombstones.
Old offline clients continue addressing the original board/namespace. Navigate only after a
committed creation result; uncertain responses preserve the original idempotency context.

## 9. JSON portability and fresh-board initialization

### 9.1 Export envelope and synchronization truth

Use the exact `ExportEnvelope` from `plan.md` section 14:

```ts
type ExportEnvelope = {
  format: 'archboard';
  formatVersion: 1;
  exportedAt: string;
  syncStatusAtExport: 'server-saved' | 'local-only';
  board: { title: string; description: string };
  graph: GraphProjection;
};
```

`GraphProjection.schemaVersion` is 1. Capture graph, board metadata, and synchronization state
consistently at export time. `exportedAt` describes file creation, not trusted server authorship.
Use `server-saved` only when the exported view is covered by the established durable server-save
state; pending, offline, demo, or recovery content uses `local-only` conservatively. A socket
send, local commit, REST success for another resource, or empty queue before local persistence
settles does not establish server durability.

JSON retains complete text, live boundaries, steps, and references. Projection removes tombstones,
hidden incident edges, and deleted highlight references so export satisfies strict import rules.
Exclude security data, comments, access, presence, view preferences, Yjs bytes, and CRDT history.
Export works from available local content offline and in recovery, including in-memory content
after local storage failure, without discarding local updates or marking them acknowledged.

Full-board JSON is the portability/recovery format. Entire-diagram/current-selection and
background/scale controls apply to image export; they must not silently truncate a recovery JSON.
If a valid local export exceeds the 5 MiB import limit, disclose that it cannot be reimported
unchanged; preserve the download and do not truncate content to make it fit.

### 9.2 Strict import and error handling

JSON import is an online creation action for a signed-in user. Parse UTF-8 with a 5 MiB byte cap
and bounded work before creation. MIME/extension are hints; validate content on both the client
for feedback and the server for authority. Configure request-envelope overhead separately so a
valid maximum-size file is not accidentally rejected by an unrelated JSON body parser limit.

Reject unknown envelope/object fields, format/schema versions, invalid IDs, duplicate entity
IDs, unsupported enums, nonfinite/out-of-range geometry, invalid handles, self-loops, missing
endpoints, dangling step references, repeated highlight references, invalid order, unsafe URLs,
oversized text/counts, and attempts to inject ownership/sequence/credentials/Yjs bytes. Treat
prototype-related keys as ordinary untrusted input and reject them through strict schemas;
never merge parsed objects into application configuration or execute content.

Validate the complete graph and metadata before creating any board. An invalid file yields
safe field/path feedback and no partial board, snapshot, receipt, or access record. Imported
sync label/timestamp do not grant authority or set new-board server durability. Final title
comes from the validated creation request; metadata cannot set source owner or timestamps.

Keep file/input and useful error feedback available after validation/network/cap failure.
No preview may execute code or fetch external URLs. Imports create a private board; they cannot
target an existing board. After uncertain creation, retry the same exact request/key within its
receipt lifetime; do not silently mint another key or automatically retry after expiry.

### 9.3 Shared remapping and committed duplicate

Use one mapping covering nodes, edges, boundaries, and steps. Allocate a fresh UUID for every
live entity, remap edge endpoints and step highlight references together, preserve geometry,
content, style, and deterministic step order, and validate the result. Build a new Y.Doc through
shared initialization helpers with schema version 1, new Yjs identity, and empty tombstone maps.
Never call live-board import to clear tombstones or physically remove existing entities.

Commit board metadata, initial graph snapshot, derived owner authority, board-cap enforcement,
and actor/operation-scoped idempotency result together. Owner role remains derived from the
new board; do not create a mutable owner membership row. Use the existing initial sequence
convention consistently; source sequence/metadata version/receipts are never inherited.

Existing duplicate uses committed source content and is available to any current reader,
including archived sources. If local edits are pending, offer waiting for acknowledgment or
local JSON export/import, with an explicit content-source explanation. Do not imply pending
changes were duplicated. Prove this shared path for duplicate, import, template creation, and
checkpoint restore, rather than maintaining four subtly different reference-remapping copies.

## 10. SVG and PNG export

### 10.1 Pure controlled renderer

Implement/reuse `packages/export` for pure projection-to-SVG/JSON transformations with no React,
Nest, DOM screenshot, or live Y.Doc mutation. Render all card kinds, labels/protocols, edge
direction/style, and named background boundaries from world geometry. Use controlled theme
tokens, fixed handles, deterministic edge geometry/text layout, and bundled/system typography.
Rendering may wrap text differently from the editor; document that limitation without claiming
pixel-identical output.

Use purpose-built SVG primitives, escaped text/attributes, renderer-generated safe IDs for
markers/clips, and predictable layer order. Export no script, raw HTML, event attributes,
`foreignObject`, external href/image/font references, or arbitrary CSS. ExternalUrl remains
inert display content, never a renderer resource fetch. Handle XML-invalid characters through
a documented safe display policy or clear error; retain full source text in JSON.

Clip long code/schema/note content to the exported card viewport with an overflow indicator.
Bound rendering work; do not lay out unbounded hidden text merely to clip it afterward. Image
exports include graph objects, boundaries, and labels only, excluding comments, cursors,
presentation highlights/notes overlays, selection handles, inspector, and editor controls.

### 10.2 Scope, backgrounds, and dimensions

Offer entire diagram or current selection and background on/off. Selection export contains
selected live nodes/boundaries and internal edges whose endpoints are included; an explicit
edge selection must include its endpoints or explain why it is omitted. Freeze one coherent
projection/selection when export starts; later edits must not mix into the same file. Empty
scope has a clear no-content state. Compute bounds including labels/strokes and document padding.

PNG scale is exactly 1× or 2×. Before allocation/rasterization, calculate finite output
dimensions, enforce 8,192 pixels per side and 32 megapixels total, and ask for reduced scope or
scale when exceeded. Apply bounded image-output geometry to SVG as well; never silently crop
or shrink content to evade the chosen scope/scale. Transparent background remains transparent
through PNG generation.

### 10.3 Browser adapter and failure states

Rasterize only the generated controlled SVG in-browser with a bounded canvas, then encode PNG.
Keep browser APIs in the web adapter, outside the pure renderer. Decode/encode/download failures
retain the source board and offer retry or SVG/JSON. Revoke object URLs and release canvases/
temporary buffers on success, failure, cancellation, and unmount. Sanitize download filenames;
titles cannot become paths or markup.

Expose preparing/downloading/error states truthfully, with keyboard-accessible controls. Offline
image export must use available bundled resources. A pure SVG string test cannot prove browser
PNG decoding, transparency, CSP compatibility, actual download, or resource cleanup; prepare
served-browser evidence for those boundaries and defer its execution.

## 11. Templates and product integration

Templates are version-controlled GraphProjection fixtures, never remote-service records or
arbitrary HTML. Finish the exact required contents:

| Template ID        | Required graph and walkthrough                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web-application`  | Browser, API service, database, cache; HTTPS/SQL/cache connections; backend boundary; request payload code card; four request-following steps     |
| `event-processing` | Producer service, queue, worker, database, external notification service; labeled event/persistence connections; retry-behavior note; three steps |
| `service-boundary` | API gateway, identity service, application service, database; two named boundaries; schema card; ownership note; three steps                      |

Validate fixtures with the same strict projection/import schemas. Arrange geometry so cards,
labels, and edges are legible at fit-to-content; use stable fixture IDs but fresh IDs on every
instantiation. Resolve `templateId` from the fixed server-side registry, never a client-supplied
module path. Use the same all-ID mapping and private-board transaction as import/duplicate.

The dashboard supports blank creation, template selection, and import with explicit online,
pending, success, error, and active-board-cap states. A blank board has no objects or steps.
Templates populate new boards only; switching a template cannot overwrite an existing board.
`/demo` uses `web-application` in its isolated local namespace, supports local presentation/
export, and has no fake presenter, checkpoint, comment, or server creation status. Demo content
can become a server board only through explicit authenticated online creation/import.

Integrate presentation and portability controls into the editor top bar/inspector without
duplicating graph state. Readers can export and present; authoring/lease/capture controls reflect
current role, connectivity, archive, and durability. Checkpoint queries are account/board scoped,
refresh on `checkpoints` invalidation and authorized reconnect/focus recovery, and ignore late
results from an old namespace. Protected reads stop on session/access failure.

## 12. REST, permissions, security, and failures

### 12.1 Shared REST contracts

Use `/api/v1`, strict `contracts` DTOs, existing success/error envelopes, and matching Swagger.
Paginated lists default to 30, maximum 100, with stable timestamp/ID cursors. Server supplies
creator, timestamps, IDs, and sequences; never accept them as writable security metadata.

| Method/path                                            | Request                                | Result and authority                                               |
| ------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------ |
| GET `/boards/:id/checkpoints`                          | `cursor?`, `limit?`                    | Metadata list; any current reader                                  |
| POST `/boards/:id/checkpoints`                         | `name`, `expectedSeq`                  | Immutable checkpoint; active owner/editor; 409 if advanced         |
| GET `/boards/:id/checkpoints/:checkpointId`            | None                                   | Metadata and GraphProjection; any current reader                   |
| POST `/boards/:id/checkpoints/:checkpointId/duplicate` | `title`                                | New private board from checkpoint; any current reader              |
| POST `/imports`                                        | `title`, `file: ExportEnvelope`        | Fully validate/remap/create new private board; signed-in user; 201 |
| POST `/boards/:id/duplicate`                           | `title`                                | New private board from committed content; any current reader       |
| POST `/boards`                                         | `title`, `description?`, `templateId?` | Blank/template new private board; signed-in user; 201              |

Creation POSTs require UUID `Idempotency-Key`, scoped to authenticated actor/operation, with
request hash and response/status committed atomically for 24 hours. A same-key changed request
returns 409; a matching successful retry returns the original result even if source content has
advanced, subject to current authorization before disclosing protected results. Cap/retry races
must not create additional boards/checkpoints. An expected-sequence refresh changes the capture
request and needs an explicit new submission/key after a definitive conflict, not a blind retry.

Use existing safe error codes for validation, authentication, authorization, not found, version/
idempotency conflict, payload size, rate limit, and temporary unavailability. Document any
additional cap/presenter code centrally; do not invent inconsistent client/server strings.
Nonmembers get 404 for board resources; known members lacking required role get 403. Checkpoint
IDs are resolved with the path board. Archive blocks source mutations, while authorized reading,
export, duplicate, and restore-as-new do not alter the source and remain available.

### 12.2 Failure matrix

| Scenario                                                         | Required behavior                                                          |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Two presenter acquisitions or nonholder control                  | Exactly one holder; safe denial; no durable graph effect                   |
| Presenter disconnects, expires, loses role, or board archives    | Lease cleared; authorized followers regain local control                   |
| Follower pans, then receives another step                        | Remains unfollowed; local viewport preserved                               |
| Step/target deleted while presenting                             | Ignore absent highlights; unavailable active-step state; no resurrection   |
| Pending local edits or pending persistence during capture        | Creation disabled; preserve queue; wait or local export                    |
| Server advances before checkpoint transaction                    | 409; no checkpoint; refresh and explicit next action                       |
| Capture versus update/archive/revocation                         | One defined queue/transaction order; no unauthorized post-change capture   |
| DB failure or lost creation response                             | No partial effect/hint on failure; committed retry returns original result |
| Concurrent creation at checkpoint/active-board cap               | Cap enforced transactionally; no excess or orphan snapshots                |
| Cross-board checkpoint ID or viewer capture request              | No protected data/state leakage; role-correct denial                       |
| Invalid/oversized/unsafe import                                  | Whole file rejected; no board; safe feedback; no execution or fetch        |
| Import/restore/duplicate/template invoked offline                | Server creation disabled; local file/export content preserved              |
| Oversized image, empty selection, rasterization/download failure | Clear error/reduce-scope choice; no board/outbox mutation                  |
| Sign-out/account switch/access loss during fetch/export/create   | Old results cannot populate new account; preserved recovery stays scoped   |
| New schema unsupported or local storage unavailable              | Existing read-only/recovery policy; no fake saved state; export available  |

Render all graph text, notes, filenames, and metadata inertly. Test malicious XML/text/URL values
as raw input, including attribute-breaking strings, `javascript:`/`data:` URLs, unknown fields,
prototype keys, and forged sequence/owner/creator data. Do not log files, checkpoint bytes,
snippets, cookies, tokens, or database URLs. Evidence uses synthetic content and safe IDs/errors.
Public bundles must contain no backend secrets; CSP/offline/cache compatibility needs actual
browser evidence later. Builds or source scans cannot establish those runtime boundaries.

## 13. Work breakdown

Implement one bounded task at a time in dependency order. Each task records owned modules,
contracts, non-goals, exact checks, and evidence under `docs/evidence/phase7/`. Internal names
follow the repository layout. Creating task prompt files, implementation audits, or verifiers
is not part of writing this specification.

| ID    | Task and primary ownership                                          | Depends on               | Primary output                                                                                         | Completion evidence                                                                      |
| ----- | ------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| P7-01 | Baseline and contracts; shared packages/API schemas                 | M04, M05 implementations | Existing-service map, gaps, strict portability/checkpoint contracts, limits, source migration decision | Contract negatives/types/source review; inherited gates recorded                         |
| P7-02 | Step model and authoring commands; document-model                   | P7-01                    | Y.Text/property/capture/reorder/delete commands and deterministic projection                           | Seeded replica reorder/text/delete convergence, undo and bounds units                    |
| P7-03 | Step authoring and local playback; web presentation/editor          | P7-02                    | Step list/notes/highlights, keyboard reorder/navigation, world view capture, offline/demo playback     | State/geometry checks; later rendered role/offline/keyboard proof                        |
| P7-04 | Presenter lease and transport; API collaboration/sync-client        | P7-01, P7-02             | Single authorized lease, liveness expiry, ordered state delivery, transient controls                   | Clock/state units; later real session/socket acquisition/access/expiry races             |
| P7-05 | Follow presenter UX; web presentation/lifecycle                     | P7-03, P7-04             | Explicit opt-in, A21 panning exit, disconnect/reconnect/account handling                               | State checks; later independent authenticated browser A21                                |
| P7-06 | JSON envelope/remapping/initialization; export/model/API boards     | P7-01, P7-02             | Pure full-content export, strict import validation, shared fresh-board copy path                       | Semantic fixture negatives/remap proof; later real transaction/idempotency rollback      |
| P7-07 | Checkpoint service/routes; API checkpoints/room queue               | P7-06                    | Immutable expected-sequence capture/list/detail/restore, caps, post-commit invalidation                | API units; later A16 PostgreSQL ordering, immutability, retry/cap/access proof           |
| P7-08 | Checkpoint and JSON UX; web portability/queries/recovery            | P7-06, P7-07             | Read-only route, settled-outbox capture, restore/import/export and truthful failures                   | State checks; later served A16/A17, pending-work and account isolation                   |
| P7-09 | SVG renderer and PNG adapter; export/web portability                | P7-06                    | Controlled escaped SVG, bounded scope/background/scale, rasterization/download states                  | Pure XML/geometry/security checks; later browser PNG/transparency/offline/download proof |
| P7-10 | Three templates and creation/demo; fixtures/API/web boards          | P7-03, P7-06, P7-08      | Exact bundled contents, validated fresh IDs, blank/template/import creation                            | Fixture validation/remap units; later rendered fit/demo/create flows                     |
| P7-11 | Integrated acceptance/verifier; scripts/API tests/browser harnesses | P7-05, P7-08–P7-10       | A16–A18/A21, duplicate/import matrix, security and pause-aware verification modes                      | Exact PASS/FAIL/UNRUN boundaries with recoverable deferred commands                      |
| P7-12 | Phase audit and handoff; documentation                              | All prior tasks          | Final criterion/evidence matrix, API/run guidance, unresolved dependencies, Phase 8 handoff            | Every deliverable mapped to proof or explicit deferred/open boundary                     |

Presentation and portability can progress independently after shared prerequisites. Do not
combine all feature paths into an unreviewable implementation task. Task implementation handoff
may proceed while required DB/browser proof is deferred;
completion evidence in the table describes the eventual acceptance requirement.

## 14. Verification requirements

### 14.1 Database-free and non-browser coverage

- Strict envelope/graph/checkpoint/protocol negatives, byte/text/entity limits, decimal sequences,
  and contract/Swagger alignment by source inspection.
- Seeded independent Y.Doc replicas for concurrent step text/property/reorder/delete, deterministic
  `(order,id)`, projection reference filtering, local undo isolation, and unchanged tombstones.
- All-kind semantic round trip after normalized ID mapping, preserving geometry/content/steps
  while excluding security/history. Every new entity ID differs from the source and every
  internal reference resolves; multiple instantiations are mutually disjoint.
- Lease state tests with controlled time/connection identity, acquisition contention, expiry,
  access/archive loss, stale frames, and no graph sequence/outbox side effects. Mocks prove
  state logic only, not real transport authorization or heartbeat timing.
- Pure SVG output inspection for escaping, fixed allowed primitives, absence of script/resource
  references/`foreignObject`, clipping, layer order, empty scope, negative coordinates, bounds,
  and 1×/2× dimensions. Test each pixel/area limit separately and at their boundaries.
- Canonical templates and malformed/typical/limit fixtures. A fixture check cannot prove visual
  legibility, actual offline playback, local durability, PNG output, or download behavior.

### 14.2 Required acceptance cases

| Test | Phase 7 assertion and evidence boundary                                                                                                                                                                                             |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A16  | Capture exact committed sequence, keep editing original, inspect immutable checkpoint, restore fresh private board; prove original/offline clients and new board remain isolated through real PostgreSQL plus later served browsers |
| A17  | Export/import all card kinds, edges, boundaries, steps, text, and geometry; normalize fresh-ID mapping and prove semantic equivalence/absent permissions through pure tests, real creation transaction, and later actual file UI    |
| A18  | Malicious import/URL/text/XML rejected or escaped; no execution/fetch through strict/pure tests, raw server requests, and later actual SVG/PNG/editor rendering under served CSP                                                    |
| A21  | Independent authenticated presenter/follower; opt in, pan locally, then broadcast another step; follower stays unfollowed and viewport unchanged; also exercise lease loss and reconnect                                            |

Retest A11 for raw presenter/capture denials and cross-board checkpoint IDs; A13 for step undo;
A10/A22 for recovery export; A24 for account/late-result isolation; A25 for direct checkpoint
route/offline shell and API cache exclusion; A27 for capture/lease/archive ordering. Exercise
Phase 7 keyboard presentation/export paths for A28 without claiming release-wide completion.
A29 checkpoint backup/restore remains Phase 8; exporting JSON is not a database backup.

### 14.3 Deferred real database and socket proof

After M00–M08 implementation, use isolated migrated PostgreSQL schemas/databases and independent
connections for capture/update/archive/revoke ordering, expected-sequence conflicts, concurrent
caps, idempotency/response-loss retries, rollback, cross-board reads, and immutable bytes.
Check graph sequence/receipts/snapshot state before and after denied or transient actions.
Verify restore/import/template/duplicate commit all required records or none and never copy
discussion/access/checkpoint history. Test source changes after capture and after keyed retry.

Use real Better Auth sessions and sockets for competing acquisitions, holder-only control,
viewer denial, current-state join/reconnect, heartbeat expiry within the 30-second lease rule,
disconnect/session/role/archive release, and protected fanout cutoff. Checkpoint invalidation
occurs only after commit; missed hints recover through authorized REST refresh. A captured hint
alone does not prove the reader UI fetched committed metadata.

Configured migration state is a separate boundary from migrations in an isolated test schema.
Prepare tests and migration sources now, but do not run schema inspections or database diagnostics
during the pause. Apply forward migrations only to a verified intended target under existing
implementation authorization; this specification grants no migration/deployment permission.

### 14.4 Deferred browser product proof and evidence realism

When explicitly resumed, use a served production build, real independent authenticated browser
contexts, active service worker, and actual offline mode where claimed. Prove local step
durability after reload, opt-in/A21/expiry UX, checkpoint read-only route and restore isolation,
file import/download, image controls/PNG decoding/transparency, offline bundled resources, and
account-scoped cache/recovery behavior. Check accessible names, focus, keyboard reorder/navigation,
notes, errors, and dialogs with keyboard and screen-reader spot checks.

Record output file dimensions/type and parsed content, not just that a button was clicked.
Observe network requests for hostile SVG/text payloads and actual cache surfaces for authenticated
checkpoint responses. Mocked React states, Node canvas substitutes, and screenshots of an
unconnected editor cannot prove collaboration, PostgreSQL capture, browser downloads, or PWA
behavior. Keep partial unit/API/socket/browser results separate with PASS, FAIL, or UNRUN.

## 15. Required verification commands

Add a fail-propagating `pnpm phase7:verify` with documented `--implementation` and `--non-browser`
modes during implementation. These are intended new interfaces, not current scripts at
specification time. Inspect child commands: a non-browser label does not imply database-free.

Implementation mode runs only database-free/non-browser checks and reports deferred requirements
as UNRUN with the full gate OPEN. Non-browser mode retains real PostgreSQL/session/socket
coverage for final verification, never launches browsers, and remains deferred until all Version 1
implementation is complete. Full mode includes database and served-browser acceptance and is
deferred until both resumption conditions hold. Missing required cases cannot silently pass;
failures propagate, and partial-mode success is never full phase PASS.

Run relevant checks for owned changes; use frozen install only when dependency setup requires it.
An aggregate should run shared checks once and select meaningful Node/API units with no hidden
database/browser children:

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @archboard/api test -- <focused database-free suites>
pnpm --filter @archboard/web build
pnpm --filter @archboard/api build
pnpm build
pnpm boundary:check
pnpm phase7:verify --implementation  # once implemented; no DB/browser children
```

Document actual Node-only model/export/fixture and presentation-state commands discovered during
inventory; do not assume a package `test` command excludes browser projects. Placeholders above
require concrete selected suite names in task evidence, not literal execution.

Database commands remain **UNRUN (deferred by user — until Version 1 implementation is complete)**:

```text
pnpm test:integration
pnpm --filter @archboard/api test:integration
pnpm auth:schema:check
pnpm db:migration:show
pnpm phase5:verify --non-browser
pnpm phase6:verify --non-browser
pnpm phase7:verify --non-browser  # once implemented; real DB/session/socket children
direct Node/Jest database-backed checkpoint/import/auth/socket/migration wrappers
```

Browser commands remain **UNRUN (deferred by user)**:

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
pnpm phase7:verify             # future full mode
served production-preview presentation/checkpoint/import/image/offline harnesses
```

Record exact commands, selected suites, test counts, durations, child results, and runtime/build
versions. Final consolidated verification restores deferred database checks after M00–M08;
browser verification still requires explicit user resumption. Document manual checks and inherited
failures separately. This planning task requires only document consistency and formatting checks.

## 16. Deliverables

Phase 7 implementation and eventual acceptance cover:

1. Shared portability/checkpoint/presenter schemas, centralized limits, consistent source
   migrations, and matching REST/WS documentation.
2. Complete step commands/projection/undo and authoring UI with deterministic concurrent order,
   world-coordinate capture, highlights, notes, deletion, and keyboard reorder alternatives.
3. Local/offline/demo presentation with navigation, usable missing-target states, and local
   viewport control independent of durable graph state.
4. Authorized single presenter lease and optional following with 30-second expiry, A21 panning
   exit, current-state join, reconnect/access handling, and no persistence side effects.
5. Immutable committed checkpoints with transactional cap/idempotency/expected-sequence behavior,
   paginated inspection, read-only route, and post-commit resource invalidation.
6. One validated fresh-ID initialization path for restore, import, templates, and committed
   duplicate; private ownership and no copied discussion/access/history.
7. Full-content versioned local JSON export, honest sync label, strict all-or-nothing 5 MiB
   import, and preserved recovery/uncertain-request context.
8. Controlled pure SVG renderer and bounded browser PNG adapter with required scope/background/
   scale choices, inert text, clipping, offline resources, and clear failure states.
9. Three complete validated templates, blank creation, dashboard integration, and local-only demo.
10. A16–A18/A21 coverage, raw role/security negatives, inherited regressions, and honest deferred
    database/browser evidence with full/non-browser/implementation verifier interfaces.
11. `docs/phase-7-presentation-portability.md`, run/API/verification guidance, and per-task
    evidence/index under `docs/evidence/phase7/`, with a concrete Phase 8 handoff.

These audit/evidence/verifier files are later implementation deliverables; creating them is not
part of writing this specification. Implementation handoff can proceed with explicitly OPEN
acceptance; deliverable presence alone does not prove a feature's runtime acceptance.

## 17. Exit gate

Phase 7 passes only when:

- Every P7 task has required proof and every deliverable agrees with shared contracts and API docs.
- Steps retain independent concurrent text/property changes, deterministic order, supported local
  undo, and delete-wins behavior; offline authoring obeys actual local durability rules.
- Local presentation is keyboard accessible and never writes participant viewports into Y.Doc.
- Real owner/editor sessions acquire one lease; viewers/nonholders cannot forge control; expiry,
  disconnect, archive, and authority loss return followers to local control.
- A21 proves explicit opt-in and persistent unfollow after local panning across subsequent frames.
- A16 proves exact committed-sequence capture, immutable checkpoint bytes/content, and fresh-board
  restore isolation from the original board and its offline clients.
- A17 proves semantic all-kind round trip and complete fresh-ID/reference remapping across import,
  committed duplicate, checkpoint restore, and templates with no copied access/discussion/history.
- Invalid files, expected-sequence conflicts, cap/idempotency/rollback races, cross-board IDs,
  and role/archive failures cannot create partial or unauthorized effects.
- A18 proves inert imported/rendered text and controlled XML with no execution or external fetch;
  SVG/PNG controls, transparency, limits, download, and offline resources have real browser proof.
- Pending local changes, storage/session/account/access failures, direct routes, cache exclusions,
  and uncertainty states preserve truthful synchronization and original recovery namespaces.
- All three templates contain the specified objects/connections/steps and render legibly; blank
  creation is empty and `/demo` remains local-only.
- Binding inherited blockers are resolved; unrelated earlier findings remain visible in their
  own audits. Phase 7 does not certify Phase 8, deployment, or the Version 1 release gate.

While checks are deferred, report implementation/fast-check progress and keep the full gate
**OPEN** with the exact UNRUN labels and deferred case/command inventory. M08 implementation may
continue; Phase 7 completion does not resume databases or browsers. Once all M00–M08 implementation
is complete, run consolidated database verification; browser checks retain their independent
resumption condition. Fix failures or propose a targeted contract amendment with evidence and
consequences. A visible presentation button, valid SVG string, or mock checkpoint is not
integrated acceptance.

## 18. Handoff record

Each Phase 7 task report contains:

```text
Task: <P7-ID and title>
Implemented behavior: <observable result>
Changed files/modules: <owned scope>
Contracts used: <steps/order, lease, sequences, envelopes, IDs, scope/limits, recovery>
Schema/API impact: <existing table/routes reused; forward migration/Swagger changes or none>
Checks run: <exact commands and selected suites>
Results: <PASS/FAIL/UNRUN with counts, durations, build/runtime versions>
Document/export evidence: <semantic remap, all-kind fixture, XML safety, dimensions>
Database/socket evidence: <capture/race/stored state/lease/denial; real or mocked; deferred list>
Browser/UI evidence: <independent sessions, served build, follow/viewport/file/offline or deferred>
Security/account evidence: <role/scoping, cache isolation, no execution/fetch, secret exclusion>
Draft/recovery evidence: <pending outbox, sync label, uncertainty, preserved local graph>
Known gaps: <missing proof, inherited audit status, blockers>
Decision or amendment: <none, or exact link and rationale>
Next dependency unlocked: <task ID or phase exit>
```

The final audit maps every deliverable and exit criterion to focused tests, real database/socket
results, served-browser proof, source inspection, or an explicit deferred/blocking boundary.
Record build hash, Node/pnpm/PostgreSQL/browser versions where relevant, commands, timings,
counts, and PASS/FAIL/UNRUN. Distinguish historical evidence, current fast checks, mock state
checks, and eventual integrated acceptance.

The Phase 8 handoff includes the consolidated deferred verification inventory, typical/limit
fixtures, controlled export limitations, checkpoint storage/cap behavior, lease lifecycle,
direct-route/cache requirements, and open inherited findings. M08 owns release-wide A01–A30,
performance/accessibility/backup/deployment hardening, and `plan.md` section 20. Neither this
specification nor a Phase 7 implementation handoff claims Version 1 release readiness.
