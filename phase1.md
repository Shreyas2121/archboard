# Archboard — Phase 1: Foundation and Risk Validation

Version: 1.1<br>
Date: 16 September 2026<br>
Status: Passed by the C15 foundation audit; product milestones remain open<br>
Source of truth: `plan.md` version 1.1

## 1. Purpose

Phase 1 establishes the technical foundation for Archboard before product UI work begins. It combines the compatibility and risk work described as M00 in `plan.md` with the shared foundation described as M01.

The phase must answer the high-risk architecture questions with executable evidence, pin a compatible stack, create the monorepo and shared packages, define the durable graph model, provide database migrations, and prove the core collaboration semantics through automated tests.

Phase 1 does not deliver an end-user editor. Its output is a stable platform on which the editor, identity, board management, collaboration, offline UX, discussion, presentation, and export features can later be built without changing the core data contracts.

## 2. Phase outcome

At the end of Phase 1, the repository must contain:

- A working pnpm monorepo using TypeScript strict mode.
- Mutually compatible, pinned dependency versions and a committed lockfile.
- Minimal React/Vite and NestJS/Express applications that build successfully.
- Shared runtime contracts, limits, protocol envelopes, and error types.
- A framework-independent Yjs document model with validated commands and projection.
- Deterministic graph and conflict fixtures.
- PostgreSQL schema migrations for the version 1 relational model.
- Executable spike evidence for authentication, WebSocket authorization, durable acknowledgements, local persistence, Yjs convergence, causal completeness, and bounded worker validation.
- A written compatibility report recording results, constraints, rejected approaches, and any approved amendments to `plan.md`.

No item is complete solely because its API appears plausible. Risk items require a running proof or an automated test.

## 3. Scope

### 3.1 Included

Phase 1 includes only the following work:

1. Resolve and pin the technology stack.
2. Establish the repository, build, lint, typecheck, and test structure.
3. Prove the NestJS ESM, Express, Better Auth, PostgreSQL, and native WebSocket integration path.
4. Define shared Zod contracts and centralized limits.
5. Implement the logical graph projection and physical Yjs schema.
6. Implement framework-independent document commands, selectors, projection, validation, and local undo boundaries needed to test the model.
7. Prove field-level collaboration, text merging, deterministic atomic conflicts, and delete-wins behavior.
8. Prototype atomic IndexedDB persistence of a local Yjs update and its matching outbox record.
9. Prototype database-before-ACK update persistence and idempotent retry receipts.
10. Isolate and prove the version-sensitive Yjs causal-completeness check.
11. Prototype bounded worker validation.
12. Create PostgreSQL migrations for the planned relational schema.
13. Add deterministic typical, limit, malformed, and concurrency fixtures.
14. Record the evidence required to authorize the next implementation phase.

### 3.2 Excluded

Phase 1 excludes all product-facing feature implementation, including:

- The usable React Flow editor, palette, inspector, canvas tools, and demo route.
- Complete authentication and account screens.
- Board dashboard and board lifecycle APIs.
- Production collaboration rooms, presence, cursors, and reconnect UX.
- The production offline application shell and service worker.
- Membership, invitations, comments, checkpoints, presentation, import, and export.
- Deployment, release hardening, accessibility certification, and performance claims.
- Any capability marked deferred in `plan.md`.

Minimal spike interfaces and test harnesses are allowed only when they directly prove a Phase 1 risk. They must not grow into incomplete product features.

## 4. Required architecture rules

The following rules are fixed for Phase 1 unless executable evidence proves that a targeted amendment to `plan.md` is necessary:

- Use a pnpm workspace with TypeScript strict mode.
- Use React with Vite for the web application and NestJS with the Express adapter and an ESM build for the API.
- Mount Better Auth using its Express integration before Express JSON body parsing. Preserve its response headers and cookies.
- Use PostgreSQL with TypeORM, explicit committed migrations, and `synchronize: false` in every environment. Better Auth retains its official PostgreSQL adapter and its own bounded `pg.Pool`.
- Use a native `ws` HTTP upgrade listener for the Phase 1 cookie/Origin spike with the application JSON envelope `{ event, data }`; do not adopt `y-websocket` as the product protocol. The final production room adapter remains later work.
- Use Yjs stable version 1 update APIs for shared graph data.
- Use Zod for strict runtime validation of shared contracts.
- Use `idb` for the custom IndexedDB persistence prototype.
- Keep `contracts` and `document-model` independent of React and NestJS.
- Treat React Flow as a rendering adapter. React Flow node and edge objects are not the persisted graph schema.
- Treat PostgreSQL Yjs snapshots plus ordered updates as the authoritative accepted graph.
- Never create a second mutable graph store from editable node arrays.
- Route all graph mutations through domain commands.
- Keep board metadata, access, identity, comments, invitations, and checkpoint metadata outside Y.Doc.
- Use one Y.Doc per board and preserve Yjs identities; never reset a live document through JSON round-tripping.
- Never acknowledge or broadcast a server update before its PostgreSQL transaction commits.
- Never mutate the accepted room document with an untrusted update before isolated candidate validation succeeds.

## 5. Repository baseline

Create the following Phase 1 structure. Empty feature directories for later work are unnecessary.

```text
apps/
  web/                         minimal React/Vite application and browser spike harnesses
  api/                         minimal NestJS application and server spike modules
packages/
  contracts/                   Zod DTOs, protocol union, errors, limits
  document-model/              Yjs schema, commands, projection, validation
  sync-client/                 IndexedDB/outbox prototype without React dependencies
  fixtures/                    graph, limit, malformed, and conflict fixtures
database/
  migrations/                  committed SQL migrations
docs/
  phase-1-compatibility.md     pinned matrix, evidence, decisions, and open risks
```

The root workspace must provide consistent scripts for formatting, linting, typechecking, unit tests, integration tests, and builds. Package boundaries must be enforced through TypeScript/project configuration or lint rules.

## 6. Technology compatibility gate

Resolve current mutually compatible stable releases during implementation. Do not copy package versions from the date of this document and do not use floating `latest` ranges. Select a supported Node.js LTS version that satisfies every chosen package's engine requirements.

The compatibility report must record:

| Item | Required evidence |
| --- | --- |
| Runtime and package manager | Exact Node.js and pnpm versions; engine compatibility |
| Frontend | React and Vite production builds complete under strict TypeScript |
| Backend | NestJS Express ESM build starts and shuts down cleanly |
| Authentication | Better Auth handler works through Express and preserves a secure session cookie |
| WebSocket | The authenticated cookie is available during same-origin upgrade and Origin is checked |
| Database | TypeORM connects to PostgreSQL through `pg` and applies committed migrations over the direct connection |
| Yjs | Exact version, stable V1 update behavior, convergence results, and compatibility-wrapper assumptions |
| IndexedDB | Exact `idb` version and atomic update/outbox transaction evidence in a real browser |
| Test tools | Unit, API integration, browser, and real PostgreSQL tests run in the selected module system |

Any failed compatibility check must result in either a corrected integration or a narrowly documented proposal to amend `plan.md`. It must not be bypassed with a mock and reported as complete.

## 7. Shared contracts

### 7.1 Conventions

- Application IDs are UUID strings.
- Yjs client IDs remain library-generated and are never reused as application user IDs.
- API timestamps are server-generated ISO 8601 UTC strings; PostgreSQL stores them as `timestamptz`.
- PostgreSQL `bigint` sequences are serialized as decimal strings and are never parsed into JavaScript `number`.
- Color tokens are limited to `gray`, `blue`, `teal`, `green`, `amber`, `red`, and `violet`.
- Unknown fields and unknown enum values are rejected at external contract boundaries.
- Client-supplied graph data never controls authorship, permissions, server sequence numbers, or other security metadata.

### 7.2 Logical graph projection

The `contracts` package must define strict runtime schemas and inferred TypeScript types equivalent to the following model:

```ts
type Point = { x: number; y: number };
type Rect = Point & { width: number; height: number };
type Handle = 'top' | 'right' | 'bottom' | 'left';
type ColorToken = 'gray' | 'blue' | 'teal' | 'green' | 'amber' | 'red' | 'violet';
type NodeKind = 'component' | 'code' | 'schema' | 'note';

type ComponentContent = {
  category: 'client' | 'service' | 'database' | 'queue' | 'cache' | 'external' | 'generic';
  description: string;
  technology: string;
  externalUrl: string | null;
};

type CodeContent = {
  language: 'text' | 'typescript' | 'javascript' | 'json' | 'sql' | 'yaml' | 'shell';
  body: string;
};

type SchemaContent = { body: string };
type NoteContent = { body: string };

type GraphNode = {
  id: string;
  kind: NodeKind;
  position: Point;
  size: { width: number; height: number };
  title: string;
  color: ColorToken;
  content: ComponentContent | CodeContent | SchemaContent | NoteContent;
};

type GraphEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  sourceHandle: Handle;
  targetHandle: Handle;
  label: string;
  protocol: string;
  direction: 'forward' | 'bidirectional';
  style: 'solid' | 'dashed';
};

type Boundary = {
  id: string;
  title: string;
  rect: Rect;
  color: ColorToken;
};

type PresentationStep = {
  id: string;
  title: string;
  notes: string;
  order: number;
  rect: Rect;
  nodeIds: string[];
  edgeIds: string[];
};

type GraphProjection = {
  schemaVersion: 1;
  nodes: GraphNode[];
  edges: GraphEdge[];
  boundaries: Boundary[];
  steps: PresentationStep[];
};
```

The schema must use a discriminated union so each node kind accepts exactly its own content fields. It must not contain an arbitrary metadata bag.

### 7.3 Core validation limits

Centralize these values in `contracts`; UI and server code must consume the same definitions later.

| Field or entity | Limit |
| --- | --- |
| Node title | 120 characters |
| Component description | 2,000 characters |
| Technology | 80 characters |
| Code, schema, or note body | 20,000 characters |
| External URL | 2,048 characters; `http` or `https` only |
| Edge label | 160 characters |
| Edge protocol | 40 characters |
| Boundary title | 120 characters |
| Step title | 120 characters |
| Step notes | 4,000 characters |
| Step order | Integer from -1,000,000 through 1,000,000 |
| Step references | At most 500 unique node and edge IDs combined |
| Node coordinates | Finite values bounded to ±100,000 |
| Node dimensions | 160–1,600 wide and 100–1,200 high |
| Boundary/step dimensions | Positive and at most 20,000 |
| Live document | 500 nodes, 1,000 edges, 50 boundaries, 50 steps |
| Encoded Yjs state | 10 MiB, including tombstoned/history structures |
| One decoded client update | 1 MiB |
| WebSocket frame | 16 MiB |

Validation must cover all stored values, including tombstoned objects, rather than only the visible projection.

### 7.4 Protocol and error contracts

Define a strict, versioned WebSocket discriminated union using UTF-8 JSON envelopes and canonical base64 for Yjs bytes. The Phase 1 schemas must cover the messages needed by the spikes:

- Client to server: `hello`, `update`, and `presence`.
- Server to client: `ready`, `ack`, `update`, `presence`, `error`, `access.changed`, and `invalidate`.
- Protocol version: `1`.

At minimum, define stable error codes for `UNAUTHENTICATED`, `FORBIDDEN`, `BOARD_ARCHIVED`, `ROOM_FULL`, `SERVER_BUSY`, `PAYLOAD_TOO_LARGE`, `DOCUMENT_INVALID`, `DOCUMENT_LIMIT`, `SCHEMA_UNSUPPORTED`, `UPDATE_ID_REUSED`, `CAUSAL_GAP`, and retryable persistence failure.

Phase 1 validates the schemas and uses the minimum subset required by spike harnesses. It does not implement the complete production synchronization client or room lifecycle.

## 8. Yjs document model

### 8.1 Physical schema

Use one Y.Doc per board with these fixed top-level maps:

| Root | Stored value |
| --- | --- |
| `meta` | Immutable `schemaVersion: 1`; no title, owner, or permission data |
| `nodes` | ID to nested Y.Map containing node fields |
| `edges` | ID to nested Y.Map containing edge fields |
| `boundaries` | ID to nested Y.Map containing boundary fields |
| `steps` | ID to nested Y.Map containing presentation-step fields |
| `deletedNodes` | ID to literal `true` |
| `deletedEdges` | ID to literal `true` |
| `deletedBoundaries` | ID to literal `true` |
| `deletedSteps` | ID to literal `true` |

Text fields use Y.Text, except enum values and `externalUrl`, which are atomic scalars. Position, size, and rectangle values are atomic objects. Position and size use separate keys. Step reference arrays are atomic arrays.

Entity IDs are map keys and are never mutable fields inside entity maps. Entity kind, edge endpoints, and handle IDs are immutable after creation. New entities must be initialized completely in one transaction.

Deletion appends a tombstone and never physically removes the entity map. Normal commands cannot clear tombstones. Projection filters tombstoned entities and filters edges whose endpoints are absent or tombstoned.

### 8.2 Required commands

Implement commands as the only mutation entry points. Phase 1 must provide enough commands to construct and verify every entity and concurrency rule:

- Create each node kind.
- Edit node title and each kind-specific editable field.
- Move and resize a node.
- Set a node color.
- Create and edit an edge.
- Replace an edge when reconnecting; tombstone the original.
- Create and edit a boundary.
- Create and edit a presentation step.
- Reorder presentation steps in one transaction.
- Tombstone nodes, edges, boundaries, and steps.
- Restore captured deleted objects as newly created entities with fresh IDs and remapped internal edges.
- Apply alignment to a set of nodes in one transaction.

Command origins must distinguish local commands, hydration, and remote application. Define origins so Y.UndoManager can track this tab's eligible local edits without tracking remote transactions. Generic undo excludes entity creation and deletion.

### 8.3 Projection and validation

The projection layer must:

- Return a deterministic `GraphProjection` with stable ordering.
- Validate required root types, nested types, enums, strings, numeric bounds, immutable fields, and append-only tombstones.
- Reject physical deletion of a previously accepted entity key.
- Reject replacement or mutation of an existing entity's identity fields.
- Tolerate structurally valid missing graph references caused by concurrent edits, while omitting invalid visible edges and missing step targets.
- Keep malformed Yjs structure distinct from a valid graph reference that currently has no live target.
- Avoid importing React, NestJS, or React Flow.

### 8.4 Required concurrency semantics

Executable replica tests must prove:

| Concurrent operation | Required result |
| --- | --- |
| Edit different fields on one node | Both edits survive |
| Insert concurrently into the same text field | Y.Text merges both inserts without whole-field loss |
| Move the same node from two replicas | Every replica converges; no wall-clock winner is asserted |
| Rename and move the same node | Both changes survive |
| Move and resize the same node | Both changes survive because they use separate keys |
| Delete an entity while another replica edits it | The tombstone hides it everywhere; it is not resurrected |
| Delete a node while another replica adds an incident edge | The node and incident edge are absent from every projection |
| Create two objects concurrently | Both survive because IDs are unique |
| Reorder steps concurrently | Every replica produces the same `(order, id)` ordering |
| Undo a local change after a remote edit | The remote contribution remains |

Run randomized convergence tests with deterministic seeds, duplicate updates, and reordered delivery. Every replica must converge after receiving the same complete set of accepted updates.

## 9. Persistence and transport spikes

### 9.1 Authentication and WebSocket upgrade

Build a minimal same-origin test path that:

1. Creates or obtains a real Better Auth session through the mounted Express handler.
2. Preserves the session cookie and response headers.
3. Opens `/ws/boards/:boardId` with that cookie.
4. Validates the request Origin before admitting the connection.
5. Resolves the authenticated session during the upgrade or connection path.
6. Rejects anonymous or invalid-origin connections before sending graph bytes.
7. Parses only valid protocol envelopes and applies the configured frame limit.

The spike may use a minimal test identity provider or supported test setup. It must exercise the real auth session integration rather than replacing session validation with a hard-coded user.

### 9.2 Atomic local update and outbox

Prototype the browser-local database with these stores:

- `localSnapshots`: compacted Yjs state and included local-log sequence.
- `localUpdates`: ordered incoming and outgoing updates.
- `outbox`: update ID, exact payload bytes, hash, local sequence, creation time, and status.
- `boardCache`: last known role, metadata, cache timestamp, and last server sequence.

For a local Yjs transaction, the exact same update bytes must be written to `localUpdates` and `outbox` in one IndexedDB transaction. Transport eligibility begins only after that transaction commits.

Tests must inject a transaction failure and prove that:

- No saved state is reported.
- The transport cannot send the failed update.
- Editing is paused by the adapter's failure state.
- The current in-memory projection remains available to an export callback.

Do not attach `y-indexeddb` as a second independent writer.

### 9.3 Database-before-ACK and idempotency

Build a narrow server persistence harness using real PostgreSQL. For a proposed update it must:

1. Authenticate and authorize before receipt lookup.
2. Hash the exact update bytes.
3. Check `(boardId, updateId)` for an existing receipt.
4. Return the original sequence for an identical actor and payload retry.
5. Reject reuse by a different actor or with a different payload hash.
6. Apply the update to an isolated candidate document.
7. Validate the candidate without mutating the accepted document.
8. In one transaction, lock the board row, recheck write authority and archive state, increment `latest_seq`, insert the update and receipt, and update `content_updated_at`.
9. Make ACK and peer-broadcast eligibility available only after commit.

The test harness must provide a deterministic failpoint after database commit and before ACK. A retry after that failpoint must receive the original receipt and sequence without creating a second logical update.

A second failpoint must force database commit failure and prove that no ACK or peer broadcast is emitted and the accepted in-memory document remains unchanged.

### 9.4 Causal-completeness compatibility boundary

Implement one isolated server-side wrapper named `assertCausallyComplete` or an equivalently explicit name. Prefer a supported public Yjs API if the pinned version provides one. If no public API exists, narrowly inspect the pinned version's pending-structure and pending-delete-set representation in this wrapper only.

The wrapper must:

- Accept a candidate Y.Doc and succeed only when no causal dependencies remain pending.
- Detect generated out-of-order structure fixtures.
- Detect generated pending delete-set fixtures.
- Fail closed when the expected internal shape is absent or changed.
- Be the only application module permitted to access the relevant Yjs internals.
- Have tests that are mandatory whenever Yjs is upgraded.

### 9.5 Bounded validator worker

Prototype candidate decoding and validation in a worker with:

- A two-second timeout per update.
- At most two concurrent validation workers per process.
- A bounded waiting queue with explicit overload rejection.
- Termination of timed-out workers.
- No mutation of the accepted document on timeout, malformed input, limit rejection, or worker failure.

Use deterministic typical and limit fixtures. Record the hardware, runtime, fixture size, sample count, elapsed time, and peak memory when practical. These results validate feasibility; they are not release performance claims.

### 9.6 Concurrent text binding proof

Use the intended plain-text editing control or binding approach in a minimal browser harness. Prove that it binds incremental edits to Y.Text, retains caret/selection sensibly during a remote insertion, and does not replace the whole string on each keystroke.

The harness is disposable unless its code is suitable for later reuse. The compatibility report must name the selected binding strategy and document any browser-specific limitations.

## 10. PostgreSQL migrations

Create real migrations with foreign keys, uniqueness constraints, and indexes for the following tables:

| Table | Required shape |
| --- | --- |
| `boards` | Owner, title, description, archive state, metadata version, latest sequence, content timestamps |
| `board_members` | Composite board/user key and editor/viewer role |
| `board_invites` | Unique token hash, role, creator, expiry, revocation, and acceptance fields |
| `board_snapshots` | One snapshot per board with schema version, through-sequence, bytes, and byte length |
| `board_updates` | Ordered board sequence, unique board/update ID, actor, bytes, and timestamp |
| `update_receipts` | Board/update key, actor, payload hash, sequence, and timestamp |
| `checkpoints` | Immutable named snapshot metadata and bytes |
| `comment_threads` | Board, anchor JSON, resolution state, version, creator, and timestamp |
| `comments` | Thread, author, plain-text body, version, edit/delete timestamps |
| `api_idempotency` | Actor, operation, key, request hash, stored response, and expiry |

Better Auth owns its generated authentication tables. The selected adapter's actual user ID type must be propagated through foreign keys; do not assume it is a UUID.

Required indexes include memberships by user, active owned boards by owner and content-update time, board updates by board and sequence, comments by thread/time/ID, threads by board/time/ID, invites by board, and checkpoints by board/time/ID.

Migration verification must use a real PostgreSQL instance and prove clean apply from an empty database. If the migration tool supports rollback, verify it during development; the committed production migration strategy must not depend on destructive rollback.

## 11. Fixtures

The `fixtures` package must provide deterministic, version-controlled data for:

- A minimal graph with two component nodes and one connection.
- Every node kind, both edge styles and directions, every handle, a boundary, and presentation steps.
- Concurrent rename/move, concurrent text insert, concurrent move, and delete-versus-edit scenarios.
- Out-of-order Yjs structure and delete-set updates.
- Malformed roots, nested values, enums, IDs, immutable fields, and tombstones.
- Typical graph size for fast validation measurements.
- Maximum allowed live graph counts and content sizes.
- One-over-limit cases for each centralized limit.

Fixtures must use fixed semantic inputs and deterministic seeds. UUID values may be fixed valid test UUIDs. Do not take snapshots of nondeterministic Yjs client IDs as the only correctness assertion; verify observable projection and convergence.

## 12. Work breakdown

Tasks must be completed in dependency order. A task is finished only when its outputs and checks are recorded.

| ID | Task | Depends on | Primary output | Completion evidence |
| --- | --- | --- | --- | --- |
| P1-01 | Compatibility matrix and toolchain | None | Pinned runtime, packages, lockfile, initial compatibility report | Install, build, and test tools execute under the selected ESM setup |
| P1-02 | Monorepo baseline | P1-01 | Root workspace, minimal web/API apps, package boundaries, shared configs | Full strict typecheck and production builds pass |
| P1-03 | Shared contracts and limits | P1-02 | Zod graph, protocol, error, and limit schemas | Valid fixtures parse; malformed and unknown fields fail |
| P1-04 | Yjs schema and projection | P1-03 | Physical roots, deterministic projection, invariant validation | Every entity projects correctly; malformed structures fail |
| P1-05 | Document commands and undo origins | P1-04 | Framework-independent command API | Commands are the only mutation path; local/remote undo test passes |
| P1-06 | Convergence and tombstone proofs | P1-05 | Deterministic and randomized replica tests | A02–A05 semantics and delete-wins invariants pass |
| P1-07 | Causal-completeness wrapper | P1-04 | Isolated Yjs compatibility boundary | Structure/delete-set gap fixtures fail closed |
| P1-08 | Auth and WebSocket spike | P1-02, P1-03 | Same-origin authenticated upgrade harness | Cookie succeeds; anonymous and invalid-origin access fail before graph data |
| P1-09 | Relational migrations | P1-01, P1-03 | TypeORM entities and committed migration | Clean migration against real PostgreSQL passes |
| P1-10 | Durable ACK spike | P1-04, P1-07, P1-09 | Candidate-validation and receipt harness | Commit-before-ACK, retry, and commit-failure tests pass |
| P1-11 | Atomic IndexedDB/outbox spike | P1-03, P1-04 | Browser persistence adapter prototype | Atomic success and injected-failure tests pass |
| P1-12 | Validator worker spike | P1-04, P1-07 | Bounded worker pool prototype and measurement | Timeout/overload/malformed cases leave accepted state unchanged |
| P1-13 | Y.Text binding spike | P1-04 | Minimal concurrent text browser harness | Incremental merge and caret/selection scenario passes |
| P1-14 | Phase audit and handoff | All prior tasks | Final evidence report and tracked amendments | Every exit criterion has a link to passing evidence or an explicit unresolved blocker |

Tasks with satisfied dependencies may be implemented in parallel, but each task must own a clear module set and avoid duplicating shared contracts.

## 13. Verification requirements

The repository must expose concrete commands for these checks. Exact script names may be chosen during setup and must be recorded in the root README and compatibility report.

### 13.1 Static and build checks

- Install succeeds from the committed lockfile.
- Formatting and lint checks pass.
- All packages and applications pass TypeScript strict mode without suppressed errors.
- Production builds for the web and API applications pass.
- Package-boundary checks prove that `contracts` and `document-model` do not import React or NestJS.

### 13.2 Contract and model checks

- Valid logical graph and protocol fixtures parse.
- Unknown keys, malformed unions, invalid URLs, unsafe enum values, oversized text, non-finite geometry, and excessive counts fail with stable errors.
- Projection is deterministic.
- Immutable identity fields and append-only tombstones are enforced.
- Randomized replica tests converge with duplicated and reordered delivery.

### 13.3 Required acceptance evidence

Phase 1 must prove the foundation-level portions of these acceptance tests from `plan.md`:

| Test | Phase 1 assertion |
| --- | --- |
| A02 | Concurrent rename and move both survive |
| A03 | Concurrent text insertion converges without whole-field loss |
| A04 | Concurrent moves converge without assuming wall-clock ordering |
| A05 | Delete wins over edits and incident edges disappear from projection |
| A08 | Crash/failpoint after DB commit and before ACK returns the original receipt on retry |
| A22 | IndexedDB failure never reports saved state, pauses persistence-dependent editing, and exposes the in-memory projection for export |

Phase 1 must also prove the model-level causal-gap behavior later exercised by A30: incomplete structure and delete-set updates are rejected, the accepted document is unchanged, and the compatibility wrapper fails closed when its pinned assumptions do not hold.

### 13.4 Test realism

- PostgreSQL transaction and receipt tests must use real PostgreSQL, not an in-memory substitute.
- IndexedDB atomicity tests must run in a real browser environment.
- WebSocket tests must use an actual upgrade path and real session-cookie handling.
- Two Yjs replicas must be independent documents; two views of one shared instance do not prove convergence.
- Failpoints must be deterministic and test-controlled.

## 14. Deliverables

Phase 1 is complete only when all of these deliverables exist and agree:

1. Pinned workspace manifests and lockfile.
2. Minimal buildable web and API applications.
3. Shared TypeScript and Zod contracts.
4. Central limits and stable error-code definitions.
5. Yjs document schema, commands, projection, validation, and undo-origin policy.
6. PostgreSQL schema and committed migrations.
7. Deterministic fixture package.
8. Automated model, contract, persistence, authentication, WebSocket, browser, and database tests required by this phase.
9. Bounded validation-worker prototype and measurement notes.
10. Atomic IndexedDB/outbox prototype.
11. Database-before-ACK and receipt-idempotency prototype.
12. Concurrent Y.Text binding proof.
13. `docs/phase-1-compatibility.md` containing the final evidence matrix.
14. Updated `plan.md` only if a contract amendment was required and justified by recorded evidence.

## 15. Exit gate

Phase 1 passes when:

- Every P1 task is complete or explicitly marked blocked with reproducible evidence.
- The selected stack is pinned and the lockfile reproduces a clean install.
- Strict typecheck, lint, unit tests, integration tests, and builds pass.
- The logical DTO and physical Yjs schema match the contracts in this document.
- A02, A03, A04, and A05 pass as repeatable model tests.
- The real auth-cookie WebSocket proof passes, including anonymous and invalid-Origin rejection.
- The durable update spike proves PostgreSQL commit occurs before ACK/broadcast eligibility.
- A08 passes with one receipt and the original server sequence after retry.
- The IndexedDB transaction proves the local update and outbox entry are atomic.
- A22's persistence-failure behavior is demonstrable.
- Causal-gap fixtures are rejected before persistence and the accepted candidate remains unchanged.
- Worker timeout and overload paths are bounded and leave accepted state unchanged.
- Migrations apply successfully to an empty real PostgreSQL database.
- The compatibility report contains exact commands, results, environment details, measurements, limitations, and amendments.
- No product-facing work from later phases has been presented as complete.

If any required proof fails, Phase 1 remains open. The team must fix the implementation or propose a targeted contract amendment with the failed evidence and its consequences.

## 16. Handoff record

Each Phase 1 task report must contain:

```text
Task: <P1-ID and title>
Implemented behavior: <observable result>
Changed files/modules: <owned scope>
Contracts used: <schemas, commands, invariants>
Checks run: <exact commands>
Results: <pass/fail with relevant counts or measurements>
Known gaps: <honest unresolved items>
Decision or amendment: <none, or link and rationale>
Next dependency unlocked: <task ID or phase exit>
```

The final phase handoff must link every exit criterion to a test, build result, migration result, or compatibility-report section. Unrun checks must be labeled unrun; mocked evidence must be labeled as such and cannot satisfy a gate requiring real browser, WebSocket, authentication, or PostgreSQL behavior.
