# Archboard — Phase 4: Durable Collaboration

Version: 1.0<br>
Date: 25 September 2026<br>
Status: Implementation specification<br>
Governing specification: `plan.md` version 1.1<br>
Prerequisites: Phase 1 compatibility foundations, Phase 2 local editor, and Phase 3 identity and
board lifecycle. Consult `docs/phase-1-compatibility.md`, `docs/phase-2-editor.md`, and
`docs/phase-3-identity-boards.md` for evidence and unresolved gates.

## 1. Purpose and authority

This document defines milestone M04: connect authenticated boards to durable Yjs collaboration.
It specifies the production room, protocol, client outbox, server validation, receipts, recovery,
compaction, presence, and the evidence required to call this phase complete.

`plan.md` remains the product and architecture authority. This document turns its contracts into
bounded Phase 4 work. In a conflict, follow the user's latest written instruction, then `plan.md`,
then this document, then implementation details and task handoffs. MUST means required for the
Phase 4 exit gate. DEFERRED means later milestone work, not removed from version 1.

Phase 3 is recorded as passed for its scoped identity and board work. The Phase 2 audit remains
open: pan p95 missed its target and several browser/human checks were unrun. Phase 4 may build on
the editor, but must keep those gaps visible. A Phase 4 pass does not implicitly close Phase 2.

## 2. Phase outcome

An owner or editor can open an authenticated board in the existing editor, edit with another
authorized user, and see committed changes converge. Local edits are committed to IndexedDB with
their exact outbound bytes before sending. The server validates an isolated candidate, commits an
ordered update and durable receipt in PostgreSQL, and only then acknowledges and broadcasts it.
Reload, reconnect, duplicate delivery, process restart, and compaction preserve the accepted graph
and do not turn an unsaved send into a server-save claim.

A viewer can open the graph read-only and receive committed edits but cannot write through the UI
or a forged socket. Archived boards remain readable and reject graph writes. Presence, cursors,
selection, and drag previews are transient. `/demo` stays in its separate local-only namespace.

This phase delivers a truthful connection/save state and a minimal safe recovery path: stop sending
on permanent failure, preserve local bytes, offer an export, and warn before a deliberate server
reload. Phase 5 completes offline app-shell navigation, account-switch and sign-out recovery,
service-worker behavior, and the broader offline product UX.

## 3. Completed baseline and dependencies

| Existing foundation                                                           | Phase 4 use                                                                         |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Phase 1 pinned Nest/Express/Better Auth/`ws` compatibility proof              | Implement the production room adapter while retaining real cookie and Origin checks |
| Phase 1 `assertCausallyComplete` wrapper and bounded validation worker        | Validate isolated candidate documents; rerun pinned-version gap fixtures            |
| Phase 1 commit-before-ACK harness and PostgreSQL CRDT entities                | Promote the durable transaction into the room write path                            |
| Phase 2 Y.Doc commands, projection, React Flow editor, and local undo origins | Reuse one graph authority in authenticated boards                                   |
| Phase 2 IndexedDB namespace, local log, snapshots, and one-writer Web Lock    | Add the atomic outbox, inbound log, receipt, and reconnect lifecycle                |
| Phase 3 Better Auth session boundary and board permission service             | Authenticate room joins and recheck writes inside the board transaction             |
| Phase 3 blank/duplicate board snapshots and board-row locking                 | Load committed rooms and serialize archive/access changes with graph writes         |
| Phase 3 dashboard and board route                                             | Open an authenticated board in the synchronized editor                              |

Before implementation, inspect the current modules and their tests. Preserve existing package
boundaries, migration ownership, session handling, and local demo behavior. Record any discrepancy
between a baseline claim and the actual tree in the task evidence; do not silently design around it.

## 4. Scope

### 4.1 Included

- Strict version-1 WebSocket DTOs, limits, error codes, and canonical base64 handling in shared
  contracts.
- Authenticated `/ws/boards/:boardId` with cookie, Origin, `hello`, five-second deadline, role,
  archive, connection, and room-capacity checks before disclosing graph bytes.
- A single-process room registry and per-board queue for join, committed updates, access/archive
  transitions, snapshot operations, and room teardown.
- Snapshot-plus-update reconstruction, full-state `ready`, ordered post-ready delivery, and
  sequence-gap recovery.
- Isolated candidate Y.Doc validation, causal-completeness checks, strict graph invariants,
  resource budgets, bounded worker execution, and rejection without live-room mutation.
- Transactional update/receipt persistence with board-row lock, commit-before-ACK semantics,
  duplicate-retry results, and restart recovery.
- Authenticated editor integration with atomic local update/outbox writes, ordered one-at-a-time
  sending, durable receipt removal, inbound update persistence, reconnect, and save-state labels.
- Read-only viewer/archived states and safe handling of role change, archive, session loss,
  schema mismatch, invalid local data, and persistent causal gaps.
- Transient presence, cursors, selection, and drag previews with server-supplied identity,
  expiry, sanitization, and independent rate limits.
- Bounded room admission, singleton process lock, periodic compaction, idle eviction, and useful
  operational measurements.
- Real PostgreSQL, real cookie/socket, independent-browser, crash, and recovery evidence for the
  Phase 4 portions of the acceptance matrix.

### 4.2 Deferred

- Service-worker/PWA shell caching, production offline route refresh, app-version prompts,
  account switching, and complete revocation/sign-out recovery: Phase 5. Phase 4 still preserves
  outbox data and provides export on rejection.
- Finished sharing dialogs, invite pages, role controls, comment REST/UI, and resource
  invalidation UX: Phase 6. Phase 4 must still enforce membership changes on existing sockets.
- Presenter leases/step following, checkpoint capture UI, import/export product controls,
  three-template creation, and image export: Phase 7. Phase 4 recovery export may use the existing
  validated local graph download; it is not the completed portability feature.
- Multi-process room ownership, Redis fanout, horizontal scaling, arbitrary history playback,
  and unbounded retained updates: outside version 1.
- Full release performance, backup/restore operations, deployment hardening, and broad browser
  certification: Phase 8. Phase 4 measures its own collaboration and validation budgets.

## 5. Non-negotiable architecture rules

1. Y.Doc is the only editable graph authority. React Flow renders a projection; PostgreSQL stores
   ordered Yjs state, not a parallel editable node/edge array. Board metadata and access remain
   relational. Zustand holds ephemeral interface state only.
2. The production transport uses the Nest `WsAdapter`/`@nestjs/platform-ws` and `ws` with the
   application `{ event, data }` protocol. The Phase 1 native `ws` listener is a compatibility
   harness, not a second production room.
3. The server authenticates the real Better Auth session cookie and validates Origin before board
   disclosure. Client-supplied user IDs, roles, authorship, and presence identity are untrusted.
4. REST and socket writes use the same board permission service. A board-scoped nonmember gets no
   graph or existence disclosure. Transaction-time authority decides whether an edit commits.
5. Every server update is validated on an isolated candidate before touching the accepted room.
   The accepted document changes only after the database commit succeeds.
6. The `(boardId, updateId)` receipt is durable and unique. A retry with matching actor and exact
   payload hash returns its original sequence; a mismatch returns `UPDATE_ID_REUSED`.
7. Outbound bytes and their `updateId` are persisted together locally before transmission. Never
   regenerate an ID for retry, discard an unacknowledged entry, or claim server save on socket send.
8. A full `ready` merges into the local Y.Doc; it never replaces local unacknowledged work. Remote
   application, hydration, and local edits use distinct origins to prevent echo into the outbox.
9. One tab writes a given account/board namespace. `/demo` remains separately namespaced and
   never opens a collaboration socket.
10. Room operations and board-row transactions preserve archive/access/update ordering. No graph
    update may commit after archive or revocation wins the relevant lock.
11. Encoded state, one update, frame, entity, rate, worker, room, and connection limits are enforced
    at their trust boundaries; visible no-op updates still consume resources and need validation.
12. Only the isolated compatibility wrapper may inspect version-sensitive Yjs pending-structure
    fields. A dependency change reruns its out-of-order structure and delete-set tests and fails
    closed on unknown shapes.
13. Sequences remain decimal strings on the wire. Do not coerce PostgreSQL `bigint` to JavaScript
    `number` or use it as a graph revision in browser state.
14. Presence, cursor, selection, and drag preview messages never enter the Y.Doc, update log,
    receipt table, or undo history.
15. One collaboration-capable Nest process owns rooms. A dedicated PostgreSQL advisory lock is
    held for its lifetime; losing it disables writes and terminates the process for restart.

## 6. Transport and shared protocol

### 6.1 Connection and envelope

Endpoint: same-origin `/ws/boards/:boardId`. Authenticate the cookie and Origin before accepting a
room join or sending graph state. Reject malformed board IDs, missing sessions, inaccessible
boards, unsupported protocol/schema, malformed frames, and over-capacity joins with safe errors;
do not reveal whether an inaccessible board exists. Require `hello` within five seconds. Disable
per-message compression initially. Frames are UTF-8 JSON `{ event, data }`, strict discriminated
unions, protocol version 1, and canonical base64 for stable Yjs V1 update bytes. Reject unknown
fields/events and noncanonical or oversized data before decode/apply. The WS frame bound is 16 MiB;
a decoded update is at most 1 MiB.

| Direction/event      | Required data                                                         | Phase 4 meaning                                                 |
| -------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------- |
| C→S `hello`          | `protocolVersion: 1`, `schemaVersion: 1`, `tabId` UUID                | Begin authenticated board session                               |
| S→C `ready`          | `role`, `latestSeq`, `snapshotBase64`, `connectionId`, `limits`       | Complete committed document at sequence S and current authority |
| C→S `update`         | `updateId` UUID, `updateBase64`                                       | Exact locally queued bytes; one in flight per connection        |
| S→C `ack`            | `updateId`, `seq`                                                     | Commit succeeded or matching durable receipt exists             |
| S→C `update`         | `updateBase64`, `seq`                                                 | Newly committed update for other authorized connections         |
| C→S `presence`       | `cursor`, `selectedIds`, `dragPreview`                                | Ephemeral information, never graph content                      |
| S→C `presence`       | `connectionId`, server-supplied user, sanitized presence, `expiresAt` | Bounded collaborator state                                      |
| S→C `access.changed` | `role` or null, `archived`                                            | Re-evaluate edit state and queued writes                        |
| S→C `error`          | `code`, `message`, `retryable`, optional `updateId`                   | Explicit rejection; never an ACK                                |

Reserve the remaining `presenter.*`, `presenter`, and `invalidate` events from `plan.md` for their
later feature owners. The Phase 4 protocol schemas must permit adding them without changing the
meaning of Phase 4 messages; Phase 4 does not claim those features work.

### 6.2 Join and replay order

1. The client acquires its account/board Web Lock, hydrates the local snapshot and log, and
   attaches persistence before enabling edits. A second tab is read-only and cannot enqueue.
2. The socket authenticates and sends `hello`. The server loads or joins the room under its queue,
   checks board access, and captures the complete committed document at sequence S.
3. `ready` contains that state. Updates committed after S are buffered for this connection until
   `ready` is sent, then delivered in sequence. Join must not miss an update between snapshot
   capture and registration.
4. The client merges `ready` into its Y.Doc, persists inbound state, and only then drains its
   locally durable outbox if current role and board status permit it. This merge cannot generate a
   new outbound update.
5. Drain by local sequence, one update per connection until its ACK/error. Apply later broadcasts
   in server sequence order. A sender advances its received sequence on ACK; duplicate/old ACKs
   cannot move the sequence backward. A sequence gap reconnects for full `ready`.
6. On socket loss, retain the outbox and reconnect with exponential backoff from one to 30 seconds
   plus jitter. An `online` event may start an earlier attempt; it is not proof of connectivity.

A full-state `ready` is deliberate within the 10 MiB encoded-board limit. Do not substitute a
state-vector-only diff without a reviewed deletion-data and receipt protocol amendment.

## 7. Server room and durable acceptance

### 7.1 Room lifecycle

The room registry admits at most 20 active boards per process and 10 connections per board.
Additional joins receive `SERVER_BUSY` or `ROOM_FULL` without state leakage. Opening a room
reconstructs the accepted Y.Doc from `board_snapshots` at `through_seq` plus ordered
`board_updates` above that sequence. Verify sequence continuity, schema, encoded size, and graph
validity before serving `ready`; inconsistent durable state is a readiness/recovery incident, not a
reason to serve a partial document. One queue serializes join, update acceptance, room snapshot,
and relevant archive/access transitions. Idle eviction is allowed after five minutes only when
all accepted writes are durable and no queued operation is pending.

The room must react to archive, restore, role change, and member removal committed through Phase 3
REST. The board-row lock remains the ultimate write-order authority. After a relevant transition,
send `access.changed` or disconnect as appropriate; a racing socket update still rechecks role
and archive inside its transaction. Existing connections cannot retain stale graph-write authority.

### 7.2 Update acceptance pipeline

Within the board queue:

1. Check frame/update size, canonical base64, session, current board status, and current role.
   No anonymous or unauthorized update reaches receipt lookup or candidate validation.
2. Hash the exact decoded bytes and look up `(boardId, updateId)`. A matching actor/hash returns
   the original ACK and sequence. A different actor/hash returns `UPDATE_ID_REUSED`.
3. Clone the accepted document into an isolated candidate; apply the update there. Validate the
   physical roots/types, immutable identity fields, append-only tombstones, all text (including
   tombstoned objects), enums, graph projection, finite geometry, and entity limits against the
   accepted state. Do not mutate the accepted room or broadcast during validation.
4. Require no pending Yjs structural dependencies and no pending delete sets. Reject
   `CAUSAL_GAP` before persistence. Bound candidate encoded state to 10 MiB and validation to a
   two-second worker timeout, at most two concurrent workers per process with bounded admission.
5. In one PostgreSQL transaction, lock the board row, recheck authority/archive, allocate the
   next `latest_seq`, insert `board_updates` and `update_receipts`, update
   `content_updated_at`, then commit. Preserve unique constraints and rollback on every failure.
6. Only after commit, install the validated candidate, ACK the sender, and broadcast to authorized
   peers. If commit succeeded but send failed, retry returns the prior receipt. If the process
   stopped, reconstruction from PostgreSQL produces the same accepted graph and sequence.

An entirely visible-no-op valid update with a new ID can receive a receipt, but it consumes the
normal update rate budget. A database failure yields no ACK or peer update and leaves the accepted
room unchanged. The room does not attempt to repair an invalid payload by sending later client
updates that depend on it.

### 7.3 Compaction, singleton, and health

At every 200 newly accepted updates or 60 seconds for a dirty room, compact under the room queue.
In one transaction, advance `board_snapshots.through_seq` and stored state, and remove only update
rows at or below that sequence. Preserve `update_receipts` for the life of the board and preserve
independent checkpoint rows. A crash leaves either the prior snapshot/log pair or the new
consistent pair. Never compact by projection-to-JSON roundtrip or reset a live Y.Doc.

At process startup, acquire a dedicated PostgreSQL advisory lock for the deployment before
reporting collaboration readiness. A second process must fail readiness. Losing the lock
connection disables write admission and terminates the process so an operator can restart it.
Readiness must reflect database/schema and singleton ownership. Record active rooms/sockets,
reconnects, ACK and DB-write latency, validation rejects by code, worker timeouts, snapshot bytes,
compaction time, and access-change rejects through structured logs/metrics without graph content,
cookies, tokens, or raw update bytes.

## 8. Client persistence and synchronized editor

### 8.1 Local atomicity

Reuse the deployment-origin/authenticated-user/board/schema namespace and keep `/demo` separate.
The local store has compacted snapshots, ordered local/inbound updates, an outbox containing
`updateId`, exact payload bytes/hash, local sequence, creation time and status, plus cached role,
metadata, and last received server sequence. A local document transaction inserts the exact same
update bytes into its log and outbox in one IndexedDB transaction. Only after that transaction
commits may the transport send or the UI claim device save. A storage failure pauses editing and
offers an in-memory validated JSON recovery download without claiming reload safety.

Inbound updates are logged locally and applied with a remote origin, never enqueued. Hydration has
its own origin. A server ACK records the receipt, updates the received sequence, and removes or
marks the matching outbox entry atomically. A crash before that local ACK transaction simply
retries the same ID and bytes. Local compaction never removes unacknowledged outbox entries. Do
not attach a second independent `y-indexeddb` writer.

### 8.2 Editing, authority, and recovery

`/boards/:boardId` opens the local cache first, then connects to the room. Editing becomes
available only after a writer lock and local persistence are ready and the last known role permits
it. A viewer or archived board displays the graph read-only; the UI cannot emit graph updates.
Server acceptance still decides authority. If the cache is absent while disconnected, show a
clear unavailable state. Phase 4 does not promise an offline app shell or direct-route refresh.

On access downgrade/removal, archive, or permanent validation/schema failure, pause the outbox and
freeze editing as appropriate. Keep local content and queued bytes. Explain the failure and offer
the existing local graph export. A deliberate “Reload server version” must warn that unsynced
changes will be lost and require explicit user action before clearing only that account/board
namespace. `CAUSAL_GAP` reconnects once and retries the same queued bytes after fresh `ready`;
if repeated, enter recovery without sending later queue entries. Do not silently copy pending
edits to another board. Phase 5 makes the full offline revocation/account-switch UX.

### 8.3 Save and connection states

| Label                                    | Required condition                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Saving on this device…                   | Local update awaits IndexedDB commit                                                            |
| Saved on this device · offline           | Local commit complete, no usable connection, outbox nonempty                                    |
| Connecting…                              | Socket/handshake underway; no server-persistence claim                                          |
| Syncing N changes…                       | Authorized connection; persisted outbox awaits ACKs                                             |
| Saved to server                          | Handshake/hydration complete, local writes complete, all local updates ACKed, no recovery error |
| Offline · cached copy                    | Disconnected with no pending local edits; remote freshness unknown                              |
| Storage error · export your changes      | Local persistence failed                                                                        |
| Access changed · local changes preserved | Server denied queued writes or access                                                           |
| Recovery required                        | Permanent validation/schema failure; automatic sending paused                                   |

An accepted edit can lose a visible atomic-property conflict under Yjs rules. “Saved to server”
means a durable receipt for the update, not a promise that every conflicting local value remains
visible. Clear the server-save claim on connection loss, new local work, sequence gap, or recovery
error. The dashboard metadata cache must not masquerade as graph sync state.

## 9. Presence and transient collaboration

Presence carries an optional world-coordinate cursor, at most 100 selected IDs, and at most one
drag preview with 100 object positions. Larger selections publish a count rather than all IDs.
Rate-limit presence to 15 messages/second/connection; durable content updates have a separate
20/second sustained, burst-40 budget. The server attaches user ID, display name/color, and
connection ID from the authenticated session; it sanitizes coordinates, IDs, and size before
broadcast. Presence expires after 30 seconds. Ping/pong every 15 seconds detects dead sockets;
disconnect after 45 seconds without pong.

Drag previews are visible to peers while dragging, but the final position is one durable edit at
drag end. A crash mid-drag reverts to the last committed geometry. Presence and selection do not
change graph sequence, local outbox, undo history, or `content_updated_at`. A second read-only tab
may view presence but cannot become another local writer while its namespace lock is held.

## 10. Security and failure handling

| Failure or attack                                     | Required Phase 4 result                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| Missing/expired cookie, bad Origin, other-board ID    | No graph bytes or existence leak; safe close/error                      |
| Viewer sends raw update                               | No accepted bytes, receipt, sequence, or peer broadcast                 |
| Editor removed or board archived during send          | Board-row commit order decides; no post-change unauthorized write       |
| Invalid type, immutable-field edit, tombstone removal | Isolated candidate rejected; accepted room stays usable                 |
| Missing structural predecessor or delete set          | `CAUSAL_GAP`; no commit; one fresh-ready retry, then preserved recovery |
| Frame/update/state/worker budget exceeded             | Explicit rejection and bounded work; room remains responsive            |
| IndexedDB commit fails                                | Editing pauses; no reload-safe/save claim; in-memory export offered     |
| Socket drops or server unavailable                    | Queued bytes survive reload; reconnect never changes update IDs         |
| DB commit fails                                       | No ACK or broadcast; candidate discarded                                |
| DB commits, ACK is lost or process crashes            | Retry returns original receipt/sequence without second effect           |
| Process dies during compaction                        | Transactional old or new snapshot/log reconstructs the same graph       |
| Singleton lock lost or second process starts          | No second writer becomes ready; writes stop on lock loss                |

Errors use safe, stable codes and do not expose stack traces, session data, tokens, raw updates, or
other boards. Permanent codes include `DOCUMENT_INVALID`, `DOCUMENT_LIMIT`,
`SCHEMA_UNSUPPORTED`, `UPDATE_ID_REUSED`, `FORBIDDEN`, and `BOARD_ARCHIVED`; repeated
`CAUSAL_GAP` is also permanent for that outbox until user recovery. Temporary database/network
errors retry with bounded backoff. Never retry a permanent error indefinitely or skip a failed
entry and send its causal descendants.

## 11. Limits and performance budgets

| Area                             | Phase 4 budget                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| Live graph                       | 500 nodes, 1,000 edges, 50 boundaries, 50 steps                                            |
| Encoded accepted Yjs state       | 10 MiB, including tombstoned/history structures                                            |
| Decoded client update / WS frame | 1 MiB / 16 MiB                                                                             |
| Connections / active rooms       | 10 per board / 20 per process                                                              |
| Durable updates / presence       | 20 per second sustained, burst 40 / 15 per second per connection                           |
| Worker                           | Two seconds per update, at most two concurrent workers, bounded queue                      |
| Compaction                       | Each 200 updates or 60 seconds for a dirty room                                            |
| Liveness / expiry                | Ping every 15 seconds, close after 45 seconds without pong; presence expires at 30 seconds |
| Collaboration target             | Same-region staging, five users, simulated 100 ms RTT: p95 durable edit visibility ≤500 ms |
| Cached opening target            | 200-node board interactive within two seconds on recorded reference hardware               |

Centralize limits shared by protocol, server validation, and UI. Use deterministic typical and
limit fixtures. Record machine, browser, database, network simulation, sample count, timings, and
failure rates. A missed budget is an open issue or a reviewed plan amendment, never an unmeasured
performance claim. Phase 2's existing pan p95 failure remains separately open.

## 12. Work breakdown

Complete tasks in dependency order. Parallel implementation is allowed only for disjoint module
sets; one integrating owner resolves conflicts and reruns affected checks. Exact filenames may
change, but each task has an observable boundary and evidence file.

| ID    | Task                                | Depends on          | Primary output                                                            | Completion evidence                                                     |
| ----- | ----------------------------------- | ------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| P4-01 | Protocol and invariant contracts    | Phase 3             | Strict WS unions, base64/sequence/limit schemas, safe codes               | Boundary and negative contract tests pass                               |
| P4-02 | Room reconstruction and singleton   | P4-01               | Registry, queue, snapshot/log loader, advisory lock, capacity             | Real-DB restart, second-process, corrupt-sequence, and admission proofs |
| P4-03 | Authenticated production gateway    | P4-01, P4-02        | Nest `ws` adapter, cookie/Origin/hello/ready, liveness                    | Real cookie/socket no-disclosure and join-order tests                   |
| P4-04 | Candidate validator                 | P4-02               | Isolated clone, worker budgets, causal wrapper, graph/immutability checks | A23/A30 and valid conflict fixtures leave room healthy                  |
| P4-05 | Durable acceptance and receipts     | P4-03, P4-04        | Transactional seq/update/receipt, post-commit ACK/broadcast, retry        | A08/A09/A11 and crash-boundary real-DB tests                            |
| P4-06 | Board lifecycle integration         | P4-05               | Archive/access notification, room/write ordering                          | A10/A27 socket and transaction races pass                               |
| P4-07 | Snapshot compaction and eviction    | P4-05               | Atomic compaction, retained receipts, bounded idle rooms                  | A15 and crash-during-compaction reconstruction pass                     |
| P4-08 | Client local outbox and inbound log | P4-01               | Atomic log/outbox, receipt transaction, origins, sequence cache           | Browser IndexedDB crash/reload and A22 regressions pass                 |
| P4-09 | Transport and reconnect client      | P4-03, P4-08        | Full-ready merge, ordered drain, gaps, retry, save states                 | A06/A07/A08 client-side replay and failure tests pass                   |
| P4-10 | Authenticated editor route          | P4-06, P4-09        | Live `/boards/:boardId`, viewer/archive states, `/demo` isolation         | Two-browser edit/viewer and route-state evidence                        |
| P4-11 | Presence and drag previews          | P4-03, P4-10        | Ephemeral bounded messages and UI                                         | Expiry/rate/no-durable-write tests plus browser observation             |
| P4-12 | Recovery and operational limits     | P4-07, P4-09, P4-10 | Freeze/export/reload warning, admission, metrics/readiness                | Permanent-error, storage failure, singleton-loss evidence               |
| P4-13 | End-to-end acceptance and audit     | All prior tasks     | Phase gate, measured budgets, regressions, handoff                        | Matrix links every claim to exact real-boundary evidence                |

## 13. Verification requirements

### 13.1 Contracts, units, and builds

- Strict protocol schemas reject unknown events/keys, noncanonical base64, invalid UUIDs, unsafe
  numbers, unsupported versions, excess selection/preview data, and size/rate boundary cases.
- Yjs fixtures prove independent field/text merge, deterministic atomic conflict handling,
  deletion/tombstone filtering, and rejected physical removal or immutable-field changes.
- Pinned-version out-of-order struct and pending-delete-set fixtures exercise the sole
  `assertCausallyComplete` wrapper. Unknown internal shape fails closed.
- No frontend import of server auth/database modules, no server secret in bundles, no second Y.Doc
  store, no independent React Flow graph mutation path, and no demo WebSocket.
- Format, lint, strict typecheck, unit/browser packages, API/web/workspace builds, migrations,
  auth-schema checks, and boundary checks pass.

### 13.2 Real database and socket acceptance

Phase 4 must complete these `plan.md` acceptance cases at the actual protocol boundary:

| Test    | Required proof                                                                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A02–A05 | Independent authenticated replicas converge on field/text conflicts, same-field moves, and delete-versus-edit/edge                                            |
| A06–A07 | Locally committed queued changes survive reload and reconcile with independent remote edits when app assets are available; Phase 5 proves offline route shell |
| A08     | Kill after DB commit before ACK; same ID/bytes returns original receipt and one logical effect                                                                |
| A09     | Fail DB commit; no peer observes candidate and no ACK is sent                                                                                                 |
| A10     | Pending writes after role removal/revocation cannot commit; local outbox is preserved/exportable                                                              |
| A11     | Raw viewer update and cross-board join/resource attempts disclose no accepted state or existence                                                              |
| A15     | Compaction followed by delayed duplicate retry returns original sequence and reconstructs the same graph                                                      |
| A23     | Invalid/oversized payload and worker timeout leave accepted room responsive                                                                                   |
| A27     | Archive/update transaction race has defined order and no post-archive write, including socket notification                                                    |
| A30     | Missing struct and delete-set predecessors reject before commit; a legitimate later room update works                                                         |

Retest A01 for an authenticated board, A12 for one-writer lock transfer, A13 for remote-edit-safe
local undo, A14 for fresh-ID restore, and A22 for local persistence failure where integration
touches those paths. A19 was proved in Phase 3; A16–A18 and A21 belong to Phase 7, A20 to
Phase 6, and A24/A25 to Phase 5. A26's full release report remains Phase 8; Phase 4 still
measures the collaboration target in section 11.

Use real PostgreSQL with independent connections for transaction/lock races, real Better Auth
cookies for socket tests, and a served production build in independent browser profiles for live
editing. A mocked guard, in-memory repository, single serialized mock connection, or component
render cannot satisfy those gates. Inject failure immediately before commit, immediately after
commit/before ACK, during compaction, and during local IndexedDB write. Compare snapshot, update,
receipt, sequence, live room, and peer observations after each failure.

### 13.3 Browser and performance evidence

- Owner/editor edit in two independent profiles; viewer and archived board remain read-only in UI
  while raw socket attempts are denied separately.
- Ready/hydration does not overwrite a queued local edit; received updates do not echo back into
  the outbox; gaps trigger a new full ready.
- Save labels transition only after their stated local or server durability boundary. A lost ACK
  never produces a false server-save state; retry eventually drains the queue.
- Presence, cursor, selection, and drag preview appear and expire, are attributable to the
  authenticated user, and do not change durable graph sequence.
- Permanent rejection freezes dependent sends, preserves bytes, and offers export; explicit
  server reload warns before clearing the exact namespace.
- The served `/demo` remains local-only after sign-in and sign-out. Authenticated board caches are
  namespaced by account, board, origin, and schema.
- Report p95 durable edit visibility for five users at simulated 100 ms RTT, validation latency
  on typical/limit fixtures, opening time, and the recorded Phase 2 pan gap without conflation.

Evidence files use synthetic content and redact cookies, OAuth codes, database URLs, update
payloads containing private content, and invitation tokens/hashes. State PASS, FAIL, or UNRUN for
each required boundary; a missing external environment is not a mock-backed pass.

## 14. Required verification commands

Preserve the repository's existing checks and add focused Phase 4 scripts as needed. The final
audit records the exact commands implemented and their results; the intended aggregate is
`pnpm phase4:verify`.

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:browser
pnpm test:integration
pnpm auth:schema:check
pnpm db:migration:show
pnpm --filter @archboard/contracts test
pnpm --filter @archboard/document-model test
pnpm --filter @archboard/sync-client test
pnpm --filter @archboard/api test
pnpm --filter @archboard/api test:integration
pnpm --filter @archboard/api build
pnpm --filter @archboard/web build
pnpm build
pnpm boundary:check
pnpm phase1:verify
pnpm phase2:verify
pnpm phase3:verify
pnpm phase4:verify
```

Focused crash/socket/browser/measurement commands may have names introduced during
implementation; document them rather than treating this proposed list as proof they exist now.
Rerun earlier gates after changes to their shared modules. A passing regression script does not
erase open manual/performance findings in prior phase audits.

## 15. Deliverables

Phase 4 deliverables are:

1. Strict shared version-1 WebSocket protocol contracts and central limits.
2. Production authenticated, Origin-checked Nest room gateway and bounded singleton room registry.
3. Snapshot/log reconstruction and full-ready join with ordered post-ready updates.
4. Isolated, bounded candidate validation including causal completeness and physical invariants.
5. Real-PostgreSQL commit-before-ACK update, sequence, and retained receipt path.
6. Archive/access integration that removes stale write authority from live sockets.
7. Transactional compaction, restart reconstruction, idle eviction, singleton-lock/readiness rules.
8. Atomic IndexedDB outbox/inbound log/ACK handling and ordered reconnect client.
9. Authenticated synchronized editor with truthful save states and read-only viewer/archive modes.
10. Ephemeral, bounded presence and drag previews.
11. Preserved-outbox permanent-error recovery, local export, and explicit server reload warning.
12. Real socket/DB/browser/crash acceptance evidence and measured collaboration budgets.
13. A root Phase 4 verification command and updated local run/configuration documentation.
14. `docs/phase-4-collaboration.md` audit plus per-task evidence under
    `docs/evidence/phase4/`.

## 16. Exit gate

Phase 4 passes only when:

- Every P4 task is complete with linked evidence, or a required failure leaves the phase open.
- A real Better Auth cookie and valid Origin are required before `ready`; viewers and nonmembers
  cannot persist or obtain unauthorized graph data through forged WS frames.
- Two independent authorized browsers converge on supported concurrent edits; the authenticated
  editor persists locally before sending and never replaces queued local work with `ready`.
- A committed update has exactly one sequence and receipt, duplicate retry returns it, and no ACK
  or broadcast occurs before a successful DB commit.
- Invalid, oversized, causally incomplete, or timed-out updates leave the accepted room unchanged
  and usable; permanent failures preserve recoverable local data.
- Archive and access mutations prevent later unauthorized commits at the board-row boundary and
  update or terminate affected live sessions.
- Snapshot/log reconstruction and compaction preserve graph and receipts across crashes and
  delayed retries; the singleton lock prevents simultaneous collaboration writers.
- Save labels match local and server durability facts; viewer/archive, reconnect, storage-error,
  and recovery states are usable in the served browser build.
- The Phase 4 acceptance matrix, relevant regressions, measurements, security checks, builds, and
  real-PostgreSQL/socket/browser evidence are recorded honestly. Any missed budget or unrun required
  proof is an open gate unless the governing plan is explicitly amended.
- The audit clearly separates this milestone from Phase 5 offline-shell completion, Phase 6
  discussion/sharing UX, Phase 7 presentation/portability, Phase 8 release hardening, and the
  still-open Phase 2 audit items.

## 17. Handoff record

Each P4 task report uses this format:

```text
Task: <P4-ID and title>
Implemented behavior: <observable result>
Changed files/modules: <owned scope>
Contracts used: <events, roles, sequences, locks, limits, invariants>
Checks run: <exact commands>
Results: <PASS/FAIL/UNRUN with counts and runtime details>
Database/socket evidence: <real connection, transaction, race, crash, or not applicable>
Browser evidence: <profiles, served build, origin, actions, result, or not applicable>
Security/recovery evidence: <negative cases and preservation result, or not applicable>
Performance evidence: <fixture, conditions, samples, result, or not applicable>
Known gaps: <honest unresolved items>
Decision or amendment: <none, or link and rationale>
Next dependency unlocked: <task ID or phase exit>
```

The final audit maps each exit criterion to a real-boundary result. It records commands, test
counts, PostgreSQL/browser/runtime versions, measured timings, migrations, limitations, and a
PASS/OPEN decision. Mocked authorization, fake ACKs, in-memory-only durability, and synthetic
browser graphs are explicitly labeled and cannot substitute for the required proof.
