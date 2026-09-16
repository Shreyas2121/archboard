# Archboard — Product and Implementation Specification

Version: 1.1<br>
Date: 16 September 2026<br>
Status: Implementation baseline; architecture choices require the verification spikes defined below.<br>
Working name: Archboard. Naming and domain availability have not been checked.

Version 1.1 records the already-approved TypeORM implementation decision and distinguishes the
native `ws` Phase 1 compatibility spike from the later production room adapter. Product behavior
and data contracts are unchanged; the [Phase 1 audit](./docs/phase-1-compatibility.md) records the
evidence and remaining limitations.

## 1. Purpose and authority

This document specifies a developer architecture editor with offline editing and live collaboration. It is intended to be sufficient context for smaller AI models to derive implementation tasks, build individual modules, and verify the integrated product.

The user selected the developer architecture product, offline plus live collaboration, React Flow, and NestJS. The remaining choices below are explicit design decisions made for this project. They are not claims that the user separately requested every feature.

MUST means required for the completed version 1 release. DEFERRED means excluded from version 1. Milestones divide delivery; they do not silently remove requirements. This document authorizes planning only; implementation, deployment, paid services, and account creation are separate work.

An implementing model MUST preserve this document's contracts. If a dependency cannot support a contract, record the evidence and propose a targeted amendment before substituting architecture. Routine component names and internal helper design may be chosen locally. Never replace offline synchronization with periodic whole-board REST saves.

## 2. Product definition

### 2.1 Product promise

Developers can model a software system, attach its important technical details, discuss it with collaborators, and walk an audience through its architecture. Previously opened boards remain editable without a connection and reconcile when connectivity returns.

The unit of work is a **board**: a diagram containing typed cards, labeled connections, visual boundaries, and an ordered presentation. The application is a diagram authoring tool. It does not execute code, deploy systems, infer architecture correctness, or run workflows represented by connections.

### 2.2 Target users and jobs

| User | Job | Successful outcome |
| --- | --- | --- |
| Individual developer | Explain a project or prepare a system-design discussion | A clear board and a guided presentation that can be exported |
| Small engineering team | Review an architecture together | Concurrent edits, attributable discussion, and a saved checkpoint |
| Technical presenter | Explain a request or event flow | An ordered sequence of views with selected components highlighted |

Primary target: an individual developer collaborating with a small group. Enterprise administration is deferred. Design the completed release for up to 10 simultaneously connected participants per board; performance targets are specified in section 16.

### 2.3 Core example

A developer creates a board from the “Web application” template. They connect a browser, API, worker, queue, and database; add a code card for a request payload and a schema card for a table; and place the backend inside a boundary. A collaborator adds a note while the developer edits a connection. The developer disconnects, changes the diagram, reloads it offline, and later reconnects. Both sets of supported changes converge. They save a checkpoint and present the request path in four steps.

### 2.4 Success criteria

- A new user can create a board, add two components, and connect them without reading documentation.
- Two users can edit different objects and the same text field without lost independent edits.
- Offline changes survive a browser reload after the interface reports local persistence complete.
- A “Saved to server” state corresponds to a committed database write, not a socket send or receipt.
- Viewers cannot write graph data through either the interface or a forged WebSocket message.
- A presenter can explain a system through named steps without moving everyone else's editor viewport unexpectedly.
- A checkpoint can create a new board without modifying the original board or its offline clients.
- A new developer can run the project locally and reproduce the documented failure scenarios.

These are acceptance goals, not current implementation claims or evidence of commercial demand.

## 3. Release scope

### 3.1 Required feature inventory

| ID | Capability | Version 1 requirement |
| --- | --- | --- |
| P01 | Identity | GitHub sign-in, session lifecycle, sign-out, current-user endpoint |
| P02 | Board management | Create, list, search titles, rename, duplicate, archive, restore archived board |
| P03 | Diagram editing | Typed cards, pan/zoom, select, move, resize, connect, copy/paste, alignment |
| P04 | Technical content | Component, code, schema, and note cards; plain text editing and code highlighting |
| P05 | Boundaries | Named visual system boundaries without nested coordinate systems |
| P06 | Collaboration | Live committed edits, presence, cursors, selection, transient drag previews |
| P07 | Offline | Cached app shell, cached boards, durable local changes, reconnect synchronization |
| P08 | Authorization | Board owner, editor, viewer; invite links, role changes, revocation |
| P09 | Discussion | Online comment threads anchored to a node, edge, or canvas point; resolution |
| P10 | Presentation | Named ordered steps, highlighting, optional live following |
| P11 | Checkpoints | Explicit named checkpoints; inspect and restore as a new board |
| P12 | Portability | Versioned JSON import/export; SVG and PNG export |
| P13 | Templates | Three bundled examples, instantiated with fresh identifiers |
| P14 | Quality | Keyboard access, clear states, limits, recovery, tests, deployment documentation |

### 3.2 Explicitly deferred

AI diagram generation; repository ingestion; code-to-architecture inference; code execution; automatic infrastructure discovery; arbitrary freehand drawing; image/file uploads; rich HTML content; nested boundary groups; automatic graph layout; executable API clients; UML completeness; Mermaid import/export; PDF export; public anonymous board links; email delivery; billing; organizations; enterprise SSO; mobile editing; audio/video chat; plugins; Kubernetes; horizontal collaboration-server scaling; arbitrary historical time travel.

AI features can be a later product extension. The version 1 graph schema must not depend on an AI provider. Imported snippets are always inert text.

### 3.3 Release versus early demo

The first vertical slice is one locally persistent board with two editable component cards and a connection. It proves foundations but is not the completed release. The release requires all P01–P14 capabilities and the release gate in section 20.

## 4. Product behavior

### 4.1 Boards and navigation

- A signed-in user creates a board online; the creator becomes its immutable owner in version 1.
- Board creation, title changes, access management, archive/restore, and duplication require connectivity. Offline creation of new server boards is deferred.
- Board title: trimmed, 1–120 characters. Description: plain text, maximum 2,000 characters. The default title is “Untitled architecture”.
- The dashboard lists boards the user owns or has membership in. Search matches titles case-insensitively. Sort by server content-update time, descending, then ID for stable ordering.
- Archived boards are excluded by default and appear through an explicit filter. They are read-only for all roles; only the owner can restore them.
- Hard deletion and ownership transfer are deferred. Archiving never immediately destroys local or server content.
- Duplicating a board creates a new private board owned by the caller, with fresh object IDs. Comments, memberships, invites, and checkpoint history are excluded.
- The offline dashboard lists only locally cached boards for the current local account namespace. Show that this is a cached list.

### 4.2 Canvas operations

- Pan by space-drag or middle mouse; zoom by controls and trackpad/wheel with a consistent documented modifier policy. Provide fit-to-content and reset zoom.
- Select one object by click and multiple objects by shift-click or selection rectangle. Drag selected nodes together. An edge cannot be moved as a free object.
- Grid snapping is a local preference, on by default, with a 16-world-unit grid. Holding Alt while dragging temporarily bypasses snapping.
- Node placement and resizing use world coordinates. Store finite numeric values, never screen pixels or React Flow internal measurement objects.
- Alignment supports left, horizontal center, right, top, vertical center, and bottom across at least two selected nodes. Apply the alignment in one local transaction.
- Copy/paste and duplicate generate fresh node/edge IDs. Copy internal edges only when both endpoints are selected. Paste offsets objects by 32 world units. Do not copy comments or presentation steps.
- Pasting external text creates a note only through an explicit “Paste as note” command; ordinary text editing keeps native paste behavior.
- Delete asks for confirmation when more than 10 objects are selected. Small deletes expose a “Restore deleted objects” action described in section 9.
- Command shortcuts are inactive while typing in editable controls, except text-editing shortcuts handled by the editor.

### 4.3 Card types

All nodes have an immutable ID and kind, position, size, title, and theme color token. Card kinds cannot be changed in place; conversion is deferred.

| Kind | Fields | Behavior |
| --- | --- | --- |
| component | category, title, description, technology, externalUrl | Category is client, service, database, queue, cache, external, or generic; display category icon and optional technology label |
| code | title, language, body | Languages: text, TypeScript, JavaScript, JSON, SQL, YAML, shell; syntax highlight without executing anything |
| schema | title, body | Plain-text table definition with a fixed-width editor; one field per line by convention; no SQL parsing or migrations |
| note | title, body | Plain text with preserved line breaks; no HTML or rich-text formatting |

Title maximum: 120 characters. Description maximum: 2,000. Technology maximum: 80. Code/schema/note body maximum: 20,000. External URL maximum: 2,048; permit only https/http, open using a safe external-link action, and never fetch previews server-side.

Every kind can participate in connections. Expose four handles, `top`, `right`, `bottom`, `left`, allowing incoming and outgoing edges. A connection uses fixed handle IDs rather than generated indices.

Default size: component 240×140, code/schema 360×240, note 240×180. Minimum size: 160×100; maximum: 1,600×1,200 world units. Coordinates are bounded to ±100,000. Text overflow scrolls or truncates with an accessible expand action; it must not silently mutate node dimensions on every collaborator's machine.

### 4.4 Connections

An edge has an immutable ID, immutable endpoint IDs and handle IDs, a label, a protocol string, a line style, and a direction. Reconnecting creates a replacement edge and tombstones the original.

- Direction: forward or bidirectional. Style: solid or dashed. Default: forward/solid.
- Label maximum 160 characters; protocol maximum 40, with suggestions such as HTTPS, SQL, and events. Suggestions do not restrict valid plain text.
- Parallel edges are allowed. Self-loops are excluded from version 1.
- Edges whose endpoints are absent or deleted are omitted by the graph projection, not rendered as broken references.
- A missing handle on an imported edge is an import validation error. Runtime unknown handle values are a document validation error.

### 4.5 Boundaries

A boundary is a labeled rectangular background with its own ID, rectangle, and color token. It is separate from nodes, never a React Flow parent node. Nodes retain absolute world coordinates.

Boundaries are visual only: moving one does not move enclosed objects. Multi-select a boundary and nodes to move them together. The UI must communicate this behavior. Boundary overlap is permitted; nesting has no semantic meaning. Connections do not attach to boundaries.

This decision avoids a hidden dependency on concurrent reparenting, cycles, and relative-coordinate conversion. True semantic grouping is a future extension requiring its own contract.

### 4.6 Comments

Comments are online-only, server-owned records. Owners and editors can create/reply; viewers can read. No separate commenter role.

- A thread anchors to a node ID, edge ID, or world point. Record the anchor's label and position at creation as a fallback.
- Thread messages are plain text, maximum 4,000 characters. Server supplies author ID and timestamp.
- Authors can edit their own messages; deleting one's message replaces its body with a deletion marker. Owners may moderate any message. Other editors may not edit someone else's message.
- Owners and editors can resolve/reopen threads. Preserve message history metadata (`editedAt`, `deletedAt`); full previous body history is deferred.
- If an anchor disappears, show the thread in the discussion panel with “Original object deleted” and its fallback context.
- Offline users may read a cached thread list marked with its fetch time. Posting, editing, and resolution are disabled. Do not pretend drafts were sent; drafts may remain local.
- Graph CRDT edits cannot modify authorship, permissions, or comment records.

### 4.7 Presentation

A board may contain up to 50 presentation steps. Each step has an ID, title, notes, world-coordinate viewport rectangle, highlighted node/edge IDs, and an integer order value.

- Editors arrange steps with drag/drop; final order sorts by `(order, id)` to break concurrent ties deterministically. Reordering rewrites affected order values in one transaction. Concurrent reorders may produce a different order than either author's local intention; all clients must show the same result.
- Deleted highlight targets are ignored. A step is still usable through its rectangle and notes.
- Presentation mode hides editing controls. Keyboard left/right changes steps; Escape exits. Local presentation works offline.
- In a live session, an owner/editor can become presenter. The server grants one ephemeral presenter lease per board. It expires on disconnect or after 30 seconds without heartbeat.
- Other participants explicitly choose “Follow presenter”. Their viewport is not controlled until they opt in. Panning or leaving presentation exits follow mode.
- Presenting and following never write participants' viewport positions into the durable graph document.

### 4.8 Checkpoints and exports

- A checkpoint captures the server's last committed graph state with a name (1–120 characters), creator, timestamp, and server sequence number.
- Creation requires an owner/editor, online state, and an empty acknowledged outbox on the requesting client. Other participants may still edit; the server sequence defines exactly what was captured.
- Checkpoints are immutable. Inspect them read-only. “Restore as new board” creates a new private board, fresh IDs, and no discussion/access history. Never replace the live Y.Doc with checkpoint JSON.
- JSON export captures the current projected local diagram, including locally persisted unsynchronized edits, and labels `syncStatusAtExport`. It excludes comments, memberships, credentials, presence, and CRDT history.
- JSON import always creates a new board online. It does not overwrite or merge into an existing board. Validate the entire file before creation and remap all IDs/references together.
- SVG export uses a purpose-built renderer over the projected graph, with escaped text and no scripts, remote images, or `foreignObject`. PNG rasterizes that SVG in-browser. This guarantees a controlled export format, although editor and export text wrapping may differ slightly.
- Export controls include entire diagram versus current selection, background on/off, and PNG scale 1× or 2×. Bound output to 8,192 pixels per side and 32 megapixels total; ask the user to reduce scope/scale if exceeded.
- Include only the currently rendered graph, boundaries, and labels in images. Exclude comments, cursors, selection handles, and editor controls. Long code is clipped to the card's viewport with an overflow indicator; JSON preserves full content.

### 4.9 Bundled templates

Templates are version-controlled GraphProjection fixtures, not records fetched from an external service. Each uses the same validation and fresh-ID remapping as import.

| Template ID | Required example content |
| --- | --- |
| `web-application` | Browser, API service, database, cache; HTTPS/SQL/cache connections; backend boundary; request payload code card; four presentation steps following a request |
| `event-processing` | Producer service, queue, worker, database, external notification service; labeled event/persistence connections; retry-behavior note; three presentation steps |
| `service-boundary` | API gateway, identity service, application service, database; two named boundaries; example schema card; note explaining ownership; three presentation steps |

Place objects so labels and edges are legible at fit-to-content. The `/demo` route uses `web-application`. Blank-board creation has no objects or steps. Templates populate a new board only; inserting a template into an existing board is deferred.

## 5. Screens and interaction states

| Route | Content | Required states |
| --- | --- | --- |
| `/` | Product introduction, sign-in, local demo action | Authenticated redirect, signed-out, network unavailable |
| `/boards` | Board list, search, archive filter, create/import | Loading, empty, error/retry, cached offline, forbidden |
| `/boards/:boardId` | Editor shell | Loading local data, connecting, live, offline, viewer, archived, recovery required |
| `/boards/:boardId/checkpoints/:checkpointId` | Read-only checkpoint | Loading, ready, unavailable, restore-as-new action |
| `/invite/:token` | Invitation review and acceptance | Sign-in required, valid, expired/revoked, exhausted, already a member |
| `/demo` | Bundled sample with local-only editing | No sign-in; explicit local demo label; reset with confirmation; export |

Editor layout: top bar for board title, save status, collaborators, sharing, presentation, export; left palette for cards/boundaries/templates; center canvas; right inspector for selection, discussion, or presentation steps; bottom zoom/minimap controls. Panels can collapse. Keep only one primary right-panel tab active.

The demo never connects to a shared server board. Its storage namespace is separate from authenticated data. Offer JSON export before reset. The demo is useful for portfolio visitors without credentials and must not bypass real board authorization.

Provide light/dark/system themes, loading skeletons, inline field errors, accessible dialogs, and a keyboard shortcuts dialog. Color is not the only indicator of connection, permission, or save state. Narrow screens offer read/present capability and a message that full editing requires a desktop-sized viewport.

## 6. Technology decisions

| Layer | Chosen technology | Responsibility and rationale |
| --- | --- | --- |
| Language/package management | TypeScript strict mode, pnpm workspace | Shared contracts and predictable module boundaries |
| Frontend | React + Vite | Client-heavy editor; no server rendering dependency for canvas/offline shell |
| Routing/server state | TanStack Router and TanStack Query | Typed routes; REST metadata/comment caching |
| Local interface state | Zustand | Selection, panels, preferences, transient previews; never a second durable graph store |
| UI | Tailwind CSS + shadcn/ui primitives; Lucide icons | Consistent accessible controls with custom editor composition |
| Diagram | `@xyflow/react` (React Flow) | Node/edge interaction and viewport rendering |
| Shared document | Yjs, stable update format | Concurrent shared values and text, using an explicit product data model |
| Local persistence | IndexedDB through `idb`, custom small Yjs adapter | Atomically persist local updates and outbound queue entries; exact save-state semantics |
| Offline shell | Vite PWA integration/Workbox | Cache versioned static assets and serve editor routes offline |
| Backend | NestJS with Express adapter, ESM build | User-requested framework; modular REST, auth, persistence, collaboration services |
| Transport | Nest `WsAdapter` / `@nestjs/platform-ws`, `ws` | Explicit JSON-envelope protocol with base64 Yjs updates; durable acknowledgments |
| Identity | Better Auth mounted through Express integration; GitHub OAuth | Library-managed sessions; avoid custom password and OAuth protocols |
| Database | PostgreSQL + TypeORM and committed migrations | Board access, metadata, comments, binary CRDT snapshots/updates, receipts |
| Validation | Zod shared schemas | Wire messages, REST DTOs, import data, and graph projection checks |
| Testing | Vitest for shared/frontend; Jest + Supertest for Nest; Playwright end-to-end | Domain semantics, real DB boundaries, independent browser contexts |
| Deployment | Docker Compose, Caddy reverse proxy, one Nest process, PostgreSQL | Same-origin frontend/API/WS and an understandable initial operating model |

Resolve current mutually compatible stable versions during M00, pin direct versions and the lockfile, and record the matrix. Do not copy versions from this document's date or use floating `latest` ranges. Use a supported Node LTS satisfying all selected engines.

React Flow is the rendering adapter, not the persisted document schema. Its official multiplayer guide distinguishes durable and ephemeral data. Yjs supplies synchronization primitives; it does not supply the app's authorization, database acknowledgments, or graph integrity rules. [React Flow multiplayer guide](https://reactflow.dev/learn/advanced-use/multiplayer)

Nest supports `ws` through an adapter. Use its `{ event, data }` message envelope; this is a custom app protocol, not a drop-in `y-websocket` endpoint. [Nest WebSocket adapter source](https://github.com/nestjs/nest/blob/master/packages/platform-ws/adapters/ws-adapter.ts)

The Phase 1 authentication compatibility spike uses a native `ws` HTTP upgrade listener to prove
cookie and Origin checks before graph disclosure. This does not select the final production room
adapter or change the version 1 application envelope.

Mount Better Auth before Express JSON body parsing, preserve its response headers/cookies, and integrate its session lookup behind a Nest service. Configure ESM deliberately. This uses Better Auth's Express integration rather than making the project depend on an unverified community Nest wrapper. [Better Auth Express integration](https://better-auth.com/docs/integrations/express)

Redis, S3, queues, microservices, and paid canvas examples are unnecessary for this scope. No hosting provider or recurring purchase is selected. Local development must work without paid services; production GitHub OAuth requires the operator's OAuth app configuration.

## 7. Architecture and ownership

```text
React UI / React Flow
  | commands                 | REST queries
  v                          v
document-model          Nest controllers
  |                          | auth + board permissions
  v                          v
Y.Doc <-> local adapter   PostgreSQL relational records
  |       |                  ^
  |       +-> IndexedDB      |
  v                          |
sync-client <-> Nest collaboration room service
                  | validate -> DB commit -> apply -> acknowledge/broadcast
                  +-> PostgreSQL CRDT snapshots, updates, receipts
```

### 7.1 Sources of truth

| Data | Authoritative location | Other representations |
| --- | --- | --- |
| Board title/archive/access | PostgreSQL | Query cache; timestamped offline metadata |
| Accepted shared graph | Durable Yjs snapshot + ordered updates in PostgreSQL | In-memory room document; browser document |
| Unsynchronized local edits | IndexedDB update log + outbound queue | Browser Y.Doc |
| Comments/invites/checkpoint metadata | PostgreSQL | Query cache; optional read-only offline cache |
| Presence/drag previews/presenter | Room memory with expiry | Local interface state |
| Selection/viewport/theme | Local client state/preferences | Never graph history |

Never persist independent editable node arrays in PostgreSQL alongside Yjs. A JSON projection is derived for export, validation, or checkpoint preview; it is not another write path for a live board.

### 7.2 Repository layout for future implementation

```text
apps/
  web/src/
    app/                       routes, providers, app shell
    features/boards/           dashboard and metadata
    features/editor/           canvas, palette, inspector, command bindings
    features/collaboration/    presence UI and connection status
    features/discussion/       comments and drafts
    features/presentation/     step editor and following
    features/portability/      import/export/checkpoint UI
    features/auth/             sign-in/session UI
  api/src/
    auth/ boards/ membership/ invites/ comments/ checkpoints/
    collaboration/             gateway, room queue, validation, persistence
    database/ health/ config/
packages/
  contracts/                   Zod DTOs, protocol union, errors, limits
  document-model/              Yjs schema, commands, projection, migrations
  sync-client/                 IndexedDB adapter, outbox, transport, recovery
  export/                      pure SVG/JSON transformations
  fixtures/                    canonical sample boards and conflict scenarios
```

`document-model`, `contracts`, and `export` must not import React or Nest. `sync-client` may depend on browser APIs but not React. Backend authorization always runs in Nest services even if frontend controls are hidden. REST and WS share the same permission service.

## 8. Data contracts

### 8.1 Shared conventions

Application IDs are UUID strings. Yjs internal client IDs are library-generated and must not be overwritten or reused as user IDs. Timestamps are server-generated ISO 8601 UTC strings in APIs and `timestamptz` in PostgreSQL. Graph content does not trust client-supplied authorship or security metadata.

Sequences are PostgreSQL `bigint`, encoded as decimal strings in JSON. Do not parse them into JavaScript `number`. Color values are enum tokens: gray, blue, teal, green, amber, red, violet. Reject arbitrary CSS and unknown enum values.

### 8.2 Logical graph DTO

The following defines the JSON projection. Implement strict runtime schemas for every object, discriminated by kind.

```ts
type Point = { x: number; y: number };
type Rect = Point & { width: number; height: number };
type Handle = 'top' | 'right' | 'bottom' | 'left';
type NodeKind = 'component' | 'code' | 'schema' | 'note';

type GraphNode = {
  id: string; kind: NodeKind; position: Point;
  size: { width: number; height: number };
  title: string; color: ColorToken;
  // Exactly the fields defined for its kind in section 4.3.
  content: ComponentContent | CodeContent | SchemaContent | NoteContent;
};
type GraphEdge = {
  id: string; sourceId: string; targetId: string;
  sourceHandle: Handle; targetHandle: Handle;
  label: string; protocol: string;
  direction: 'forward' | 'bidirectional'; style: 'solid' | 'dashed';
};
type Boundary = { id: string; title: string; rect: Rect; color: ColorToken };
type PresentationStep = {
  id: string; title: string; notes: string; order: number; rect: Rect;
  nodeIds: string[]; edgeIds: string[];
};
type GraphProjection = {
  schemaVersion: 1;
  nodes: GraphNode[]; edges: GraphEdge[];
  boundaries: Boundary[]; steps: PresentationStep[];
};
```

ComponentContent fields: `category`, `description`, `technology`, `externalUrl` (nullable). CodeContent: `language`, `body`. SchemaContent and NoteContent: `body`. No hidden arbitrary metadata bag. Step notes maximum 4,000 characters; order is an integer in ±1,000,000. References in a step are unique and at most 500 total. Boundary title maximum 120. Boundary/step rectangles share node coordinate limits but permit dimensions up to 20,000.

### 8.3 Physical Yjs schema

One Y.Doc per board, with these fixed top-level maps:

| Root | Value |
| --- | --- |
| `meta` | Immutable `schemaVersion: 1`; no title, owner, or permission fields |
| `nodes` | ID -> Y.Map holding immutable `kind`, Y.Text title, atomic position/size objects, color, and kind-specific fields |
| `edges` | ID -> Y.Map holding immutable endpoint/handle fields, Y.Text label/protocol, direction/style |
| `boundaries` | ID -> Y.Map with Y.Text title, atomic rect object, color |
| `steps` | ID -> Y.Map with Y.Text title/notes, order, atomic rect, atomic arrays of reference IDs |
| `deletedNodes`, `deletedEdges`, `deletedBoundaries`, `deletedSteps` | ID -> literal `true`, append-only tombstones |

Textual content fields use Y.Text except enum fields and externalUrl (atomic scalar). Each node's fields live in its existing nested Y.Map. Never replace the whole map to edit one property. Position and size are separate atomic values so a concurrent rename and move do not overwrite each other; x/y remain one atomic pair.

Entity IDs are map keys and are not editable fields inside the Y.Map. New objects are initialized completely in one transaction. Do not physically remove an entity map during ordinary deletion. Tombstoned objects are filtered by the projection. Tombstones cannot be cleared through normal editing or import into a live board.

The shared package validates roots, types, enums, bounds, immutable fields, and append-only tombstones. All previously accepted entity keys must remain present; physical map deletion or replacement of an existing entity's identity is forbidden. Structurally valid missing references caused by concurrency are tolerated and filtered by projection; malformed field types are rejected. Missing graph references and missing Yjs structural dependencies are different: the latter are rejected under section 11.4.

### 8.4 Relational schema

Use migrations, foreign keys, unique constraints, and indexes. Better Auth owns its generated user/session/account/verification tables; map its user ID type consistently rather than assuming it is a UUID.

| Table | Required columns and constraints |
| --- | --- |
| boards | id PK, owner_user_id FK, title, description, archived_at nullable, metadata_version integer, latest_seq bigint default 0, content_updated_at, created_at, updated_at |
| board_members | board_id FK, user_id FK, role editor/viewer, created_at; composite PK; owner role derived from boards |
| board_invites | id PK, board_id FK, token_hash unique, role editor/viewer, created_by FK, expires_at, revoked_at nullable, accepted_by nullable, accepted_at nullable |
| board_snapshots | board_id PK/FK, schema_version, through_seq bigint, update_bytes bytea, byte_length, updated_at |
| board_updates | board_id FK, seq bigint, update_id UUID, actor_user_id FK, update_bytes bytea, created_at; PK(board_id,seq), unique(board_id,update_id) |
| update_receipts | board_id FK, update_id UUID, actor_user_id FK, payload_hash, seq bigint, created_at; PK(board_id,update_id) |
| checkpoints | id PK, board_id FK, name, created_by FK, through_seq bigint, schema_version, update_bytes bytea, created_at |
| comment_threads | id PK, board_id FK, anchor JSONB, resolved_at nullable, resolved_by nullable, version integer, created_by FK, created_at |
| comments | id PK, thread_id FK, author_user_id FK, body, version integer, edited_at nullable, deleted_at nullable, created_at |
| api_idempotency | actor_user_id, operation, key UUID, request_hash, response_status, response_json, expires_at; unique(actor_user_id,operation,key) |

Indexes: board memberships by user; active owned boards by owner/content_updated_at; comments by thread/created_at/id; threads by board/created_at/id; invites by board; checkpoints by board/created_at/id; board updates by board/seq. Store plain-text comment bodies, not rendered HTML.

`metadata_version` protects board metadata writes only; it is not a CRDT revision. `latest_seq` advances only on a newly accepted update, not on a duplicate retry or presence event.

## 9. Concurrent editing rules

| Concurrent actions | Required result |
| --- | --- |
| Different fields on a node | Both survive |
| Same text field | Y.Text merges edits; no whole-string replacement per keystroke |
| Same atomic position/size/color | Yjs deterministic conflict resolution; do not promise wall-clock last-writer behavior |
| Move and resize | Both survive because the values use separate keys |
| Delete versus edit | Tombstone hides the object on all clients; stale edits do not resurrect it |
| Delete node versus add incident edge | Node and any edge to it are omitted from projection |
| Two new objects | Both survive because IDs are unique |
| Boundary move versus node move | Independent changes; no implicit parent relationship |
| Concurrent presentation reorders | All replicas sort by final `(order,id)` |
| Access revoked versus pending write | Authorization at server commit decides; unauthorized update is not accepted |

Use transient presence for active drag previews (maximum 15 messages/second). Commit durable positions at drag end. A browser crash mid-drag returns to the last committed position. Other participants see a “being moved” preview; previews expire and never create authoritative edits.

Undo/redo applies to this tab's text/property edits, completed moves/resizes, alignment, and presentation property/reorder edits. Use Y.UndoManager scoped to local command origins, and separate history groups with explicit boundaries. Do not undo remote transactions. The stack is session-local and clears after reload. [Yjs undo manager](https://docs.yjs.dev/api/undo-manager)

Version 1 deliberately excludes create/delete from generic Ctrl/Cmd-Z. Explain this in shortcuts/help and through deletion feedback. “Restore deleted objects” recreates the captured local selection with fresh IDs and remaps its internal edges; it never clears tombstones. It is available until reload for the most recent deletion. Unrelated external connections are not recreated. Undo entries targeting tombstoned objects are skipped with feedback. This restriction prevents a simple undo implementation from violating delete-wins behavior.

An accepted edit may be hidden by another concurrent edit according to these rules. “Saved” means durable receipt of the update; it does not guarantee every conflicting local value will be the visible winner.

## 10. Local durability and offline behavior

### 10.1 Local database

Namespace by deployment origin, authenticated user ID, board ID, and schema version. Demo uses a separate namespace. Stores:

- `localSnapshots`: compacted Yjs state plus included local-log sequence.
- `localUpdates`: ordered incoming and outgoing Yjs updates.
- `outbox`: updateId, payload bytes, hash, local sequence, creation time, status.
- `boardCache`: last known role, metadata, cache timestamp, last received server sequence.

For a local transaction, write its update to `localUpdates` and enqueue the exact same bytes in `outbox` in one IndexedDB transaction. Only after that transaction commits may the transport send it. On persistence failure, show an error, pause further editing, and offer JSON export of the in-memory content. Never claim reload safety for uncommitted memory.

For remote updates, append to the local log and apply without generating an outbound entry. Hydration, remote application, and local edits use distinct origins. For a server ACK, persist the receipt locally and remove/mark the matching outbox entry atomically. A crash before local ACK persistence causes a safe retry.

Yjs offers IndexedDB integration, but this project uses a custom adapter to put updates and outbox records in the same transaction. Do not also attach y-indexeddb to the same document as an independent writer. [Yjs offline support](https://docs.yjs.dev/getting-started/allowing-offline-editing)

### 10.2 Multiple tabs

Only one tab may edit a given account/board namespace at a time. Acquire a Web Lock before enabling edits. A second tab displays a read-only view and “This board is being edited in another tab”; it may acquire the lock after the first releases it. Use BroadcastChannel for cache-change notifications and sign-out notification, not for an independent unacknowledged write stream. Do not steal a held lock.

This does not restrict collaboration across different users or different browser/device profiles. Unsupported Web Locks environments get read-only cached access with JSON export; multi-writer fallback is deferred. [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)

### 10.3 Offline permissions and cached access

An offline editor can continue editing a previously opened board using its last known role. Server authorization is rechecked before any upload. The product cannot retract data already downloaded to a device; do not promise remote erasure.

On reconnect with revoked access or a viewer downgrade, freeze the old local editor, preserve its outbox, and offer export of the local graph. Do not push queued edits or automatically copy them into another user's board. An explicit import by a signed-in user creates a new private board.

Offline sign-out is local-only until the server is reachable; explain that server session invalidation is pending. Online sign-out invalidates the session. Before clearing local storage, detect unsynchronized edits and offer export or cancel. Broadcast the local sign-out to other tabs. A new account never opens the previous account's caches by default.

### 10.4 Save-state labels

| Label | Exact condition |
| --- | --- |
| Saving on this device… | A local update awaits IndexedDB commit |
| Saved on this device · offline | Local commit complete, no usable connection, outbox nonempty |
| Connecting… | Socket/handshake underway; do not imply server persistence |
| Syncing N changes… | Authorized connection; locally durable outbox awaits ACKs |
| Saved to server | Hydration/handshake complete, local writes complete, all local updates ACKed, no recovery error |
| Offline · cached copy | Disconnected, no pending local edits; remote freshness unknown |
| Storage error · export your changes | Local persistence failed |
| Access changed · local changes preserved | Server denied queued writes or access |
| Recovery required | Permanent validation/schema failure; automatic sending paused |

Cache app assets for offline navigation; never cache arbitrary authenticated API responses through a blanket service-worker rule. Use explicit account-scoped IndexedDB caches. Prompt for a new app version rather than forcing reload during editing. Browser storage eviction remains possible; provide export and explain local storage status in settings.

## 11. Synchronization protocol and server durability

### 11.1 Transport

Endpoint: `/ws/boards/:boardId`, same origin as the application. Authenticate the session cookie and validate Origin before room access. Enforce a five-second handshake deadline. Anonymous connections receive no graph bytes.

Use UTF-8 JSON envelopes `{ event: string, data: object }`, protocol version 1, and canonical base64 for Yjs update bytes. Use Yjs stable V1 update APIs, not experimental formats. Set WebSocket per-message compression off initially. All DTOs are strict discriminated unions in `contracts`.

### 11.2 Message contract

| Direction/event | Required data | Meaning |
| --- | --- | --- |
| C→S `hello` | protocolVersion:1, schemaVersion:1, tabId UUID | Begin authenticated board session |
| S→C `ready` | role, latestSeq, snapshotBase64, connectionId, limits | Complete accepted server state and authority; generated under room queue |
| C→S `update` | updateId UUID, updateBase64 | Exact locally persisted update; one in flight per connection |
| S→C `ack` | updateId, seq | Bytes have committed or matching previous receipt exists |
| S→C `update` | updateBase64, seq | Newly committed server update; sender normally receives ACK instead |
| C→S `presence` | cursor Point/null, selectedIds array, dragPreview/null | Ephemeral bounded information; identity supplied by server |
| S→C `presence` | connectionId, user:{id,name,color}, presence, expiresAt | Sanitized presence broadcast |
| C→S `presenter.acquire` | empty object | Request single presenter lease |
| C→S `presenter.step` | stepId | Broadcast active step while lease holder |
| C→S `presenter.release` | empty object | Release lease |
| S→C `presenter` | connectionId/null, stepId/null, expiresAt/null | Current presenter state |
| S→C `invalidate` | resource:comments/members/metadata/checkpoints | Re-fetch the relevant REST resource |
| S→C `access.changed` | role or null, archived:boolean | Freeze writes/reconnect as appropriate |
| S→C `error` | code, message, retryable, updateId optional | Explicit failure; never equivalent to ACK |

WebSocket ping/pong every 15 seconds detects dead connections; disconnect after 45 seconds without pong. Presence expires after 30 seconds unless refreshed. Presenter uses the same liveness mechanism plus lease rules. Presence is limited to 100 selected IDs and one drag preview containing up to 100 object positions. Bigger selections show selection count only in presence.

### 11.3 Join and reconnect ordering

1. Acquire local write lock; hydrate snapshot/log; attach local persistence before enabling editing.
2. Authenticate/connect and send `hello`.
3. Server serializes room loading and registration. `ready` includes the complete committed document at sequence S; later committed updates are buffered for this socket until ready is sent.
4. Client merges `ready` into its local Y.Doc without discarding local history/outbox and persists the received state.
5. If authorized to edit and active, drain the persisted outbox in local sequence order, one ACK at a time. Do not synthesize new update IDs for retries.
6. Apply later server updates in delivery order. Advance the received sequence on both broadcasts and ACKs for the sender's already-applied updates. Older duplicate ACKs do not move it backward. Sequence gaps trigger reconnect/full ready instead of declaring the view current.
7. If the socket closes, preserve the queue and reconnect with exponential backoff from 1 to 30 seconds plus jitter. Browser online events may trigger an earlier attempt; they do not prove connectivity.

Full-state `ready` intentionally trades bandwidth for simpler recovery within the board size limit. Future state-vector optimization must include deletion data; a state vector alone is not a durable acknowledgment or a reliable test that deletion changes were saved. Yjs updates merge idempotently; server ACK semantics are an additional application contract. [Yjs document updates](https://docs.yjs.dev/api/document-updates)

### 11.4 Accepting an update

All update acceptance, metadata archival/access mutations affecting a board, checkpoint capture, and room snapshot operations use the same per-board server queue. Within that queue:

1. Validate transport size, base64, session, board status, and current role; never trust cached client roles.
2. Hash the exact bytes. Check receipt for `(boardId, updateId)`. A matching actor/hash returns the original ACK. Different actor/hash is `UPDATE_ID_REUSED`.
3. Create an isolated candidate Y.Doc from the accepted room document, apply the update, and validate the candidate plus immutable/tombstone invariants against the accepted state. An untrusted update must not first mutate the live document.
4. Require causal completeness: the candidate must have no pending Yjs structural dependencies or pending delete sets. Reject `CAUSAL_GAP` before persistence if any remain. Then enforce bounds on encoded state size, live entity counts, all stored text values (including tombstoned objects), and decoding/validation work. An apparently empty visible change is not evidence that its payload is safe.
5. In a PostgreSQL transaction, lock the board row, recheck authority/archive status, increment latest_seq, insert the update and receipt, and update content_updated_at. Commit.
6. Only after commit, replace/apply the validated accepted room state, ACK the sender, and broadcast the update to authorized peers.

If step 5 fails, discard the candidate and send a retryable error; no ACK or peer broadcast. If commit succeeds but sending fails, retry returns the receipt. If the process crashes after commit, restart reconstructs the accepted document from PostgreSQL.

An unauthorized duplicate request does not receive graph data; authorization checks precede receipt lookup. A no-op valid update with a new ID may get a committed receipt, but rate limiting prevents unbounded no-op traffic.

**Compatibility boundary:** detecting pending Yjs dependencies is a version-sensitive validation requirement. Implement a single server-side `assertCausallyComplete` wrapper, prefer a supported API if available in the pinned version, and otherwise inspect and narrowly wrap the pinned library's pending-structure/delete-set fields. Yjs source currently represents these as `store.pendingStructs` and `store.pendingDs`; they are internal, not a promised stable API. M00 must prove this check with generated out-of-order struct and delete-set fixtures, pin the exact library version, and fail closed if the expected shape changes. No other application module may access these internals. A dependency upgrade requires rerunning those tests. [Yjs structural store source](https://github.com/yjs/yjs/blob/main/src/utils/StructStore.js)

This exception is deliberate: persisting an unresolved malicious update could make a later legitimate update reveal invalid content and poison the room. Ordered local outbox delivery, one local writer, and broadcasting only committed remote updates mean legitimate clients should provide their causal predecessors. On `CAUSAL_GAP`, reconnect once and retry the same queued bytes after receiving current server state; if it repeats, enter recovery and preserve/export the local graph. Do not send later queue entries to try to force integration.

### 11.5 Server topology and compaction

Version 1 runs exactly one collaboration-capable Nest process. At startup acquire a dedicated PostgreSQL advisory lock for this deployment; failure prevents readiness. Do not scale the container to multiple instances. Board row locks still protect database transactions. Losing the advisory-lock connection immediately disables writes and terminates the process for restart.

The graph is reconstructed from the snapshot at through_seq and updates with higher sequence. Every 200 accepted updates or 60 seconds for a dirty room, create a compacted snapshot under the room queue. Atomically advance the snapshot and delete only update rows at or below its through_seq. Keep update receipts for the lifetime of the board so delayed offline retries remain identifiable.

Checkpoint rows are independent immutable snapshots. Compaction never removes them. Local compaction folds logs into a local snapshot transactionally but does not delete unacknowledged outbox entries. Do not reset a live document through JSON roundtripping; that discards CRDT identities and can break reconnects.

Room eviction after five idle minutes is allowed only after all accepted writes are durable. Limit in-memory rooms and apply load admission rather than allowing memory exhaustion. Horizontal scaling requires a later room-ownership/fencing design and is not achieved by merely adding Redis pub/sub.

### 11.6 Permanent rejection

Codes `DOCUMENT_INVALID`, `DOCUMENT_LIMIT`, `SCHEMA_UNSUPPORTED`, `UPDATE_ID_REUSED`, `FORBIDDEN`, and `BOARD_ARCHIVED`, plus repeated `CAUSAL_GAP`, pause the outbox and freeze editing as appropriate. Keep rejected bytes and local content. Explain the cause; offer JSON export and an explicit “Reload server version” action that warns about unsynchronized content before clearing that local namespace. Never endlessly retry permanent failures, drop a failed update and send causally dependent ones, or silently overwrite the local document.

## 12. Authorization and sharing

| Operation | Owner | Editor | Viewer |
| --- | --- | --- | --- |
| Read active/archived board, comments, checkpoints | Yes | Yes | Yes |
| Edit active graph/presentation | Yes | Yes | No |
| Comment, resolve, create checkpoint | Yes | Yes | No |
| Export/duplicate readable content | Yes | Yes | Yes |
| Rename/describe board | Yes | Yes | No |
| Archive/restore, manage members/invites | Yes | No | No |
| Restore checkpoint as a new private board | Yes | Yes | Yes |
| Edit/delete another person's comment | Yes | No | No |

Archived boards allow reading/export/duplication only; metadata editing, comments, checkpoints, and invites are blocked until restored. Owners cannot be removed or demoted. Nonowners can leave a board; unsynchronized local edits require the same preservation flow as revocation.

Invite links use 32 random bytes encoded base64url; store only SHA-256 token hashes. They are bearer invitations, valid for seven days, single-use, and require sign-in before acceptance. An owner selects editor/viewer and manually shares the link; no email service. Acceptance is atomic. It never demotes an existing member; consuming an editor invitation can upgrade a viewer. An owner's acceptance is a no-op and does not create a membership. Repeated acceptance by the recorded accepting user returns success; another user sees exhausted. Provide expiry and revocation UI.

Check permissions on every REST request and before every persistent WS update. Session expiry/sign-out and role changes also stop ongoing reads: reevaluate socket sessions at least every 30 seconds and close immediately on local server revocation events. Membership/archive operations serialize with board writes, update DB first, notify/disconnect affected sockets before allowing further broadcasts. Updates accepted before a revocation's transaction remain accepted; later ones fail.

Membership data, token hashes, author identity, and session data never enter Y.Doc. Presence display names and user IDs come from the authenticated session, not the payload. For nonmembers return 404 for board-scoped resources to avoid existence disclosure; known members with insufficient role get 403.

## 13. REST contracts

Prefix: `/api/v1`. Auth library routes remain `/api/auth/*`. Successful objects return `{ data: ... }`; paginated collections return `{ data: [...], nextCursor: string|null }`. Page size defaults to 30, maximum 100, stable cursor ordering by timestamp/ID. All schemas live in `contracts`; Nest Swagger documents these exact DTOs.

Errors: `{ error: { code, message, fieldErrors?: Record<string,string[]>, requestId } }`. Messages are safe for users; logs hold internal context without content/secrets.

| Method/path | Request | Result and role |
| --- | --- | --- |
| GET `/me` | none | Current user; 401 if unauthenticated |
| GET `/boards` | search?, archived?, cursor?, limit? | Accessible board summaries |
| POST `/boards` | title, description?, templateId? | Board summary; any signed-in user; 201 |
| GET `/boards/:id` | none | Metadata, effectiveRole, latestSeq, member summary |
| PATCH `/boards/:id` | title?, description?, expectedVersion | Updated metadata; owner/editor; 409 stale version |
| POST `/boards/:id/archive` | expectedVersion | Owner; updated metadata |
| POST `/boards/:id/restore` | expectedVersion | Owner; updated metadata |
| POST `/boards/:id/duplicate` | title | New board from committed source; any reader |
| GET `/boards/:id/members` | none | Members and owner; any reader |
| PATCH `/boards/:id/members/:userId` | role editor/viewer | Owner; updated member |
| DELETE `/boards/:id/members/:userId` | none | Owner removes member or member removes self; 204 |
| GET `/boards/:id/invites` | cursor?, limit? | Invite metadata without token hashes; owner |
| POST `/boards/:id/invites` | role | Owner; invite URL once plus metadata; 201 |
| DELETE `/boards/:id/invites/:inviteId` | none | Owner revoke; 204 |
| POST `/invites/preview` | token | Signed-in user; board title, inviter name, role, expiry only |
| POST `/invites/accept` | token | Signed-in user; board ID and effective role |
| GET `/boards/:id/threads` | cursor?, limit?, resolved? | Threads with message count and latest-message summary |
| GET `/boards/:id/threads/:threadId/comments` | cursor?, limit? | Paginated messages |
| POST `/boards/:id/threads` | anchor, body | Owner/editor; thread plus first message; 201 |
| POST `/boards/:id/threads/:threadId/comments` | body | Owner/editor; message; 201 |
| PATCH `/boards/:id/comments/:commentId` | body, expectedVersion | Author or owner; updated message |
| DELETE `/boards/:id/comments/:commentId` | expectedVersion | Author or owner; deletion marker |
| PATCH `/boards/:id/threads/:threadId` | resolved:boolean, expectedVersion | Owner/editor; updated thread |
| GET `/boards/:id/checkpoints` | cursor?, limit? | Checkpoint metadata |
| POST `/boards/:id/checkpoints` | name, expectedSeq | Owner/editor; 409 if server advanced; retry after refresh |
| GET `/boards/:id/checkpoints/:checkpointId` | none | Metadata and GraphProjection, any reader |
| POST `/boards/:id/checkpoints/:checkpointId/duplicate` | title | New private board; any reader |
| POST `/imports` | title, file:ExportEnvelope | Validate/remap/create new private board; 201 |

All subordinate IDs must be resolved together with the path board ID; possessing another board's comment/checkpoint ID grants no access. `anchor` is a strict union: `{type:'node',id,label,position}`, `{type:'edge',id,label,position}`, or `{type:'point',position}`. Validate IDs against committed graph on thread creation; server captures trustworthy fallback context from that graph where applicable.

Creation POSTs require `Idempotency-Key` UUID, including board creation, duplicate/import, invite creation, thread/reply creation, and checkpoint creation/duplication. Scope to authenticated actor and operation; store request hash and response transactionally with the effect for 24 hours. Reusing a key with different content returns 409. A client does not automatically retry a creation after expiry; it first checks visible results. Invite acceptance has its own durable single-use record. Archive/restore and other PATCH/DELETE operations use version checks or naturally idempotent state transitions.

Common codes: VALIDATION_ERROR (400), UNAUTHENTICATED (401), FORBIDDEN (403), NOT_FOUND (404), VERSION_CONFLICT / IDEMPOTENCY_CONFLICT / INVITE_EXHAUSTED (409), INVITE_EXPIRED (410), PAYLOAD_TOO_LARGE (413), RATE_LIMITED (429), TEMPORARILY_UNAVAILABLE (503). Missing/revoked invite tokens return INVITE_UNAVAILABLE (404). Do not log raw invitation tokens or route URLs containing them.

Duplicate uses committed content. If the caller has pending local edits, UI offers local JSON export/import or waits for synchronization before duplication. Do not quietly imply pending content was copied.

## 14. Import/export and schema evolution

Export envelope:

```ts
type ExportEnvelope = {
  format: 'archboard'; formatVersion: 1;
  exportedAt: string;
  syncStatusAtExport: 'server-saved' | 'local-only';
  board: { title: string; description: string };
  graph: GraphProjection;
};
```

Validate MIME/extension only as hints; parse and validate content. Reject unknown format versions, unknown fields, duplicate IDs, nonfinite coordinates, unsupported enums, self-loops, missing endpoints, and dangling step references in import. Live projection filters legitimate concurrent dangling references before export, so exported files should satisfy these stricter rules.

Limit JSON imports to 5 MiB UTF-8. Validation is all-or-nothing. Generate a single mapping for all node, edge, boundary, and step IDs, then remap references. Commit board metadata, initial Yjs snapshot, and initial owner relationship together. Imported data cannot set owner, members, credentials, sequence, or arbitrary Yjs bytes.

Version 1 supports only schemaVersion 1. A newer unsupported server schema makes older clients read-only with an update prompt; pending local edits remain exportable. Future schema migrations need fixtures for old offline clients and a versioned upgrade procedure. Implementing models may not casually rename Yjs keys or change node field types after M01 without updating schemas, fixtures, and migration design.

## 15. Security and operational behavior

- Serve frontend, auth, REST, and WS under the same HTTPS origin. Restrict trusted origins; use secure HttpOnly session cookies in production and the auth library's CSRF/origin protections. Validate Origin on WebSocket upgrade as well.
- GitHub OAuth client secret, session secret, and database URL exist only on the backend. Use a maintained auth adapter; never store OAuth tokens in localStorage or graph exports. Request only identity scopes needed for sign-in.
- Escape graph/comment text and export XML. Do not use raw HTML rendering, eval, code execution, database connections from schema cards, or remote URL preview fetching.
- Apply board/session-level rate limits and decoded byte limits before document processing. Expensive Yjs candidate decoding/validation runs in a bounded worker with a timeout; return candidate state/results to the room queue. Terminate a timed-out worker and reject without mutating accepted state.
- Security enforcement must validate the complete candidate, not only the currently visible projection. Hidden/tombstoned content still counts toward size and field constraints. Editors are authorized to alter diagram content, never server metadata.
- Log request IDs, actor/board IDs, update IDs, byte counts, timings, and safe error codes. Exclude source snippets, comment bodies, cookies, OAuth data, and invitation tokens.
- Configure CSP compatible with the implemented editor and bundled workers; avoid third-party scripts and CDN runtime dependencies for the offline shell. Configure `Referrer-Policy: no-referrer` on invite pages.
- Expose `/health/live` for process health and `/health/ready` for database connectivity, schema compatibility, and singleton ownership. An unhealthy writer is not ready.
- On shutdown stop accepting new writes, finish/abort queued transactions within a bounded interval, close sockets for reconnect, and release the singleton lock. Do not ACK uncommitted work.
- Daily database backups and a documented restore drill are required for a hosted release. Demonstrate restoring into an isolated database and reopening a board/checkpoint. Browser caches are not backups.

## 16. Limits and performance targets

Limits are centralized constants shared by validation and UI. These initial values are engineering budgets to verify, not measured capabilities.

| Area | Initial limit/target |
| --- | --- |
| Live graph | 500 nodes, 1,000 edges, 50 boundaries, 50 steps |
| Accepted encoded Yjs state | 10 MiB per board, including historical/tombstoned structures |
| One client update | 1 MiB decoded; reject oversized updates before decode/apply |
| WS frame | 16 MiB encoded maximum, sufficient for bounded full ready snapshot |
| Collaborators | 10 connections per board; additional joins get ROOM_FULL |
| Rooms | 20 active rooms per process initially; bounded admission with SERVER_BUSY |
| Content updates | 20/sec/connection sustained, burst 40; separate presence budget 15/sec |
| Comments | 2,000 threads/board, 500 messages/thread |
| Checkpoints | 100/board; at cap disable creation with a clear message; deletion deferred |
| Owned boards | 100 active boards/user; archived boards still subject to deployment storage budget |
| Interactive performance | On recorded reference laptop: pan/drag p95 frame time ≤32 ms at 200 nodes/400 edges |
| Collaboration | Same-region staging, 5 users, 100 ms simulated RTT: p95 durable edit visibility ≤500 ms |
| Opening board | Cached 200-node board becomes interactive within 2 seconds on reference hardware |
| Validation | Worker timeout 2 seconds/update; at most 2 concurrent workers/process, bounded queue |

Use deterministic fixtures at typical and limit sizes. Record hardware, browser, network conditions, sample count, and measured results. Missing a target requires optimization or an explicit documented budget revision; never turn the target into a performance claim without measurement.

Monitor database write latency, ACK latency, failed updates by code, reconnect count, active rooms/sockets, worker timeouts, snapshot sizes, compaction duration, and rejected writes after access changes. Provide a simple structured-log/metrics setup; a large observability stack is unnecessary.

## 17. Failure and recovery matrix

| Failure | Required behavior |
| --- | --- |
| Network lost during text editing | Local persistence continues; queue survives reload; offline label |
| Crash after local commit before send | Outbox drains after reload |
| Crash after server commit before ACK | Retry returns same receipt/seq; no duplicate logical effect |
| PostgreSQL unavailable | No ACK or peer broadcast; local editing stays available within limits |
| Another user deletes an offline-edited node | Tombstone wins visibility; no resurrection |
| Viewer crafts graph update | Reject; accepted bytes, seq, and document remain unchanged |
| Permission revoked while offline | Preserve local edits; refuse upload; export/recovery flow |
| Board archived while client offline | Reject writes until owner restores; keep queue |
| Local quota exhausted | Pause edits, show storage error, allow in-memory JSON export |
| Invalid CRDT payload | Candidate isolated, reject, freeze causal queue; healthy room remains usable |
| Oversized document/history | Explain limit, preserve local export; new private import resets history explicitly |
| New app/schema unavailable offline | Run compatible cached app or show explicit unsupported state; never discard cache |
| Duplicate invite acceptance | Same accepting user succeeds idempotently; another user cannot consume it |
| Presenter disappears | Lease expires; followers regain local control |
| Process dies during compaction | Transaction leaves either old snapshot/log or new consistent pair |
| Second server instance starts | Singleton lock fails; instance never becomes ready |

## 18. Acceptance tests

Implement meaningful tests against the behavior below. Mocking PostgreSQL is insufficient for transaction/durability tests. Browser offline tests require service worker enabled and independent browser contexts/profiles; two components in one React tree do not demonstrate collaboration.

| Test ID | Given / action | Required assertion |
| --- | --- | --- |
| A01 | Create board, two components, connect, reload | IDs/content/geometry preserved |
| A02 | Two replicas rename and move same node independently | Both changes retained after exchanging all updates |
| A03 | Two replicas insert text concurrently | Same final text on all replicas; no whole-field loss |
| A04 | Two replicas move same node | Same final position; no assertion of wall-clock winner |
| A05 | Delete node while another replica edits it/adds edge | Node/incident edge absent from all projections |
| A06 | Disconnect, edit, wait for local-save label, close and reopen offline | App shell loads and all locally committed edits exist |
| A07 | Reconnect A06 while another user edited a different node | Both independent edits retained; queue reaches zero |
| A08 | Kill server after DB commit but before ACK | Retry keeps one receipt and original seq for update ID |
| A09 | Fail DB commit | No peer sees candidate and no ACK is sent |
| A10 | Revoke editor role while offline changes are pending | No queued update commits after revocation; export offered |
| A11 | Viewer sends raw update; user requests another board's resource ID | Rejected without state/data leakage |
| A12 | Two tabs open same cached board | One writer only; lock transfer after close works |
| A13 | Apply remote edit then undo local edit | Remote contribution remains; local undo boundaries respected |
| A14 | Delete and use Restore deleted objects | Fresh IDs, internal edges remapped, tombstones unchanged |
| A15 | Compaction then delayed duplicate retry | Reconstructed graph matches; original receipt ACK returned |
| A16 | Create checkpoint and keep editing original | Checkpoint immutable; restore-as-new isolated |
| A17 | Export/import fixture containing all card kinds | Semantic content equivalent after ID remap; permissions absent |
| A18 | Malicious import/URL/text/XML payloads | No execution/fetch; unsafe format rejected or text escaped |
| A19 | Two users accept same single-use invite concurrently | Exactly one new accepting user wins |
| A20 | Comment edit with stale version | 409 and original newer content preserved |
| A21 | Follow presenter, pan locally, then presenter changes step | Local user remains unfollowed |
| A22 | Simulate IndexedDB failure | No “saved” label; editing paused; export available |
| A23 | Inject invalid/oversized update and worker timeout | Accepted room unchanged and remains responsive |
| A24 | Account switch after pending edits | Preservation choice shown; other account does not load old cache |
| A25 | Production preview direct-route refresh/offline refresh | Correct route shell; no accidental API caching |
| A26 | Typical/limit-size fixtures, 5-user session | Recorded performance report against section 16 |
| A27 | Archive versus in-flight update | Defined transaction order; no post-archive writes accepted |
| A28 | Keyboard-only create/edit/connect/present and screen reader spot check | Named controls, visible focus, usable alternate connection UI |
| A29 | Restart after backup restore in isolated DB | Board, membership, checkpoint, and receipt data consistent |
| A30 | Send update/delete set with missing causal predecessors, then legitimate room update | Incomplete payload rejected before commit; legitimate room stays usable; pinned compatibility wrapper fails closed on unknown shape |

Also use randomized replica tests with duplicate/reordered update delivery and deterministic seeds. Validate convergence after all accepted updates are exchanged. Library convergence tests complement, not replace, product semantics and permission tests.

## 19. Implementation milestones and AI handoffs

### 19.1 Execution rules for implementing models

1. Read sections 1–3, 6–11, the selected milestone, and its linked acceptance tests before editing.
2. Implement one bounded task at a time. Each task states dependencies, owned files/modules, contracts used, expected outputs, non-goals, and verification commands.
3. Use shared schemas/types. Do not create slightly different role enums, graph DTOs, error shapes, or protocol envelopes in each application.
4. Domain commands are the only local graph mutation entry points. Components dispatch commands and render selectors; they do not directly write Y.Map fields.
5. Do not expand deferred features, introduce paid dependencies, or substitute mock persistence to claim completion.
6. If a contract changes, update this specification and affected tests together with a clear reason. Do not silently resolve contradictions differently in separate modules.
7. End each task with implemented behavior, changed files, checks run/results, known gaps, and the exact next dependency. Label unrun checks honestly.
8. Do not build every milestone in one prompt. Derive small task files later from this document; creating those files is not part of the present planning request.

### 19.2 Milestone table

| Milestone | Depends on | Deliverable | Exit gate |
| --- | --- | --- | --- |
| M00 — compatibility and risk spikes | This specification | Pinned stack; Nest ESM/auth handler/WS spike; Yjs field/delete behavior; atomic IndexedDB/outbox prototype; bounded validator worker | Real proof of auth cookie on WS, DB-before-ACK, A02–A05/A08/A22 prototype evidence |
| M01 — shared foundation | M00 | Monorepo, contracts, limits, graph schema/projection/commands, sample fixtures, migrations | Strict typecheck; malformed DTO tests; pure model convergence tests |
| M02 — local editor | M01 | All card kinds, edges, boundaries, inspector, selection/geometry, local adapter, demo | A01/A12/A13/A14; reload-safe local editing; no fake cloud status |
| M03 — identity and board lifecycle | M01, M00 auth result | Better Auth, Nest permission service, boards, archive/restore, members, invites | A11/A19/A27; real DB migrations and transaction tests |
| M04 — durable collaboration | M02, M03 | Room queue, custom protocol/client, candidate validation, receipts, compaction | A02–A10/A15/A23/A30; process crash/retry evidence |
| M05 — offline product completion | M04 | PWA shell, cache UX, revocation recovery, account switching, update prompts | A06/A07/A10/A22/A24/A25 using production preview |
| M06 — discussion and sharing UX | M03, M04 | Share dialog, invite pages, role controls, comments, invalidation | A11/A19/A20; role matrix enforced end-to-end |
| M07 — presentation and portability | M04, M05 | Steps/following, checkpoints, JSON/SVG/PNG, three templates | A16–A18/A21; fresh-ID import/duplicate proofs |
| M08 — release hardening | M05–M07 | Accessibility, performance, rate/size limits, operational packaging, backups, docs | All A01–A30 as applicable; section 20 release gate |

Do not postpone synchronization modeling until after designing the entire UI around mutable node arrays. M00/M01 define the shared document first; M02 renders that model.

### 19.3 M00 questions to resolve through executable evidence

- Does the selected Nest/Express/Better Auth combination preserve session cookies and work with the intended ESM build and test tooling?
- Can the WS adapter authenticate upgrades and enforce the exact envelope/frame limits without leaking unauthorized state?
- Do candidate cloning, field-level merging, tombstones, and rejection of incomplete causal dependencies behave as specified with the pinned Yjs version and its isolated compatibility wrapper?
- Can local update+outbox insertion be atomic, and can crash/retry tests distinguish local persistence from server persistence?
- Can worker validation stay within the typical fixture latency target while bounding malformed input work?
- Does the chosen text control correctly bind Y.Text edits and preserve selection under remote inserts? Use a tested text-binding strategy; full-string assignment is not acceptable.

Record results and any required specification amendments. Failure is a reason to fix or revise an exact contract, not to skip offline durability or server authorization.

### 19.4 Task prompt template

```text
Implement task <ID> from Archboard plan.md version <version>.
Read required sections: <sections>.
Goal: <one observable behavior>.
Dependencies already complete: <IDs with evidence>.
Allowed modules/files: <scope>.
Use these contracts unchanged: <DTOs, commands, invariants>.
Explicit non-goals: <list>.
Acceptance: <Axx tests plus task-specific assertions>.
Run: <relevant targeted checks>.
Report changes, evidence, unresolved issues, and next dependency.
Do not claim completion if persistence/authorization is mocked where real behavior is required.
```

## 20. Release gate and demonstration

Version 1 is complete only when:

- All required product capabilities work together against PostgreSQL and authenticated independent browsers.
- Shared schemas, migrations, API documentation, and implementation agree.
- Unit, integration, browser, security-negative, crash/recovery, and required production-preview checks pass; exact commands and results are recorded.
- Performance measurements and any deviations from the budgets are documented.
- Local setup, GitHub OAuth setup, environment variables, migrations, backup/restore, and single-instance deployment limitations are documented.
- A production build serves direct editor routes correctly, supports offline cached routes, and upgrades without silently discarding pending edits.
- No fabricated hosted URL, usage metrics, uptime, performance numbers, or production-readiness claims appear in the case study.

Suggested five-minute demo: open a bundled architecture, edit concurrently in two independent profiles, disconnect one and reload offline, make separate edits, reconnect and show save states, demonstrate delete-versus-edit, create a checkpoint, present four steps, and export the diagram. Show one rejected viewer write and one durable retry in the engineering walkthrough.

Portfolio explanation should distinguish library capabilities from personal implementation: React Flow handles diagram interaction; Yjs handles shared-data merging; this project adds the domain model, access enforcement, durable protocol, offline outbox, recovery UX, presentation, export, and verification evidence.

## 21. Decision record and references

| Decision | Reason |
| --- | --- |
| Developer architecture editor | User-selected; concrete audience and workflow |
| React Flow foundation | User-selected; concentrate custom work on product behavior |
| NestJS backend | User-selected; fits modular APIs and collaboration services |
| Offline plus live collaboration | User-selected; core acceptance requirement |
| Yjs with field-level shared types | Concurrent text and independent-field editing |
| Custom IndexedDB outbox and WS protocol | Explicit local durability and database-backed acknowledgment |
| PostgreSQL snapshot/update log/receipts | Recoverable accepted state and idempotent retries |
| One Nest process initially | Enforceable room serialization without pretending distributed ownership is solved |
| Metadata/comments outside CRDT | Authoritative permissions, attribution, and simpler online workflows |
| Boundaries without parent relationships | Explicit visual scope without concurrent reparenting complexity |
| Immutable tombstones; recreate on restore | Delete-wins semantics with no stale resurrection |
| Checkpoint restore creates new board | Preserve active/offline replica histories |
| No AI requirement | The selected product works independently of inference services |

Reference links were consulted on 12 September 2026. They support library capabilities/integration facts; all application contracts and numerical budgets above are project design choices.

- [React Flow multiplayer](https://reactflow.dev/learn/advanced-use/multiplayer): rendering state and collaboration guidance.
- [React Flow node API](https://reactflow.dev/api-reference/types/node): adapter properties; internal fields must not become the storage schema.
- [Yjs shared types](https://docs.yjs.dev/getting-started/working-with-shared-types): nested shared data structures.
- [Yjs document updates](https://docs.yjs.dev/api/document-updates): stable update/state primitives and idempotent merging.
- [Yjs Y.Doc](https://docs.yjs.dev/api/y.doc): transaction origins and session-specific internal client IDs.
- [Yjs undo manager](https://docs.yjs.dev/api/undo-manager): scoped local undo building blocks.
- [Yjs offline support](https://docs.yjs.dev/getting-started/allowing-offline-editing): browser-local persistence foundation.
- [Nest ws adapter](https://github.com/nestjs/nest/blob/master/packages/platform-ws/adapters/ws-adapter.ts): native WS integration and message handling.
- [Better Auth Express integration](https://better-auth.com/docs/integrations/express): auth-handler mounting and ESM integration.
- [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API): exclusive same-origin browser resource access.

No product-selection questions remain blocking this specification. Compatibility spikes, measured performance, implementation details, final naming, and eventual hosting configuration remain future execution work.
