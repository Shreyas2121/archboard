# Archboard — Phase 3: Identity and Board Lifecycle

Version: 1.0<br>
Date: 22 September 2026<br>
Status: Implementation specification<br>
Governing specification: `plan.md` version 1.1<br>
Prerequisites: Phase 1 and Phase 2 completed; see `docs/phase-1-compatibility.md` and
`docs/phase-2-editor.md`.

## 1. Purpose and authority

This document defines Phase 3 of Archboard: milestone M03, identity and board lifecycle. It turns
the Phase 1 authentication and PostgreSQL compatibility work into product authentication, a shared
authorization boundary, durable board metadata, membership, and invitation behavior. It also adds
the authenticated board-management surface that follows the local editor completed in Phase 2.

`plan.md` remains the product and architecture authority. This file narrows that plan into bounded
Phase 3 work, dependency order, observable behavior, and an exit gate. When the documents disagree,
use this order:

1. The user's latest written instruction.
2. `plan.md`.
3. This Phase 3 specification.
4. Existing implementation details and task handoffs.

MUST means required to close Phase 3. DEFERRED means excluded from Phase 3, not removed from version

1. An implementation must not weaken authentication, board isolation, role enforcement,
   transaction ordering, idempotency, or token-secrecy rules to simplify controllers or the user
   interface.

## 2. Phase outcome

At the end of Phase 3, a user can authenticate with GitHub, sign out, and use an authenticated
dashboard to:

- Create a private blank board whose owner and initial empty Yjs snapshot are committed together.
- List boards they own or belong to, search titles, filter active or archived boards, and page in a
  deterministic order.
- Read board metadata and their effective owner, editor, or viewer role without learning whether
  inaccessible boards exist.
- Rename or describe a board with optimistic version checks.
- Archive and restore an owned board while preserving its content and access records.
- Duplicate a readable board from its committed server state into a new private board with fresh
  graph object IDs and no copied access or discussion history.
- Inspect board membership through the API, while owners can change editor/viewer roles or remove
  members and nonowners can leave.
- Create, list, revoke, preview, and atomically accept seven-day single-use editor or viewer
  invitations through the API.
- Receive stable, shared REST response and error contracts, including idempotent creation behavior.

The Nest application has one permission service used by board REST behavior and by the durable
update boundary prepared for Phase 4. Authorization is rechecked inside write transactions. A
viewer cannot persist graph data, a nonmember cannot distinguish a missing board from a forbidden
one, and archiving serializes with graph-update acceptance so no update commits after the archive
transaction.

Phase 3 does not claim live collaboration, server-backed editor synchronization, production
offline navigation, comments, or the finished sharing experience. The dashboard manages durable
server boards; `/demo` remains the completed local-only editor until the collaboration client is
connected in Phase 4.

## 3. Completed baseline

Phase 3 consumes the following completed work rather than rebuilding it:

| Foundation                                                                   | Phase 3 use                                                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Pinned Nest, Express, Better Auth, TypeORM, PostgreSQL, Zod, and test stack  | Productize the proven runtime combination without changing frameworks                       |
| Auth handler mounted before JSON parsing                                     | Preserve Better Auth request bodies, response headers, cookies, and origin checks           |
| Real Better Auth session-cookie proof                                        | Build the Nest session boundary and authenticated REST tests on the proven integration      |
| TypeORM migration and generated Better Auth schema                           | Extend the committed schema only through migrations; keep `synchronize: false`              |
| Board, member, invite, snapshot, and idempotency entities                    | Add repositories and application services without duplicating persistence models            |
| Commit-before-ACK durable-update harness                                     | Replace its local role query with the shared permission boundary and prove archive ordering |
| Strict shared contracts and server sequence strings                          | Define all Phase 3 DTOs and keep PostgreSQL `bigint` values out of JavaScript numbers       |
| Empty graph schema, projection, validation, and fresh-ID fixture utilities   | Initialize new boards and safely duplicate committed projections                            |
| Phase 2 routed React shell, TanStack Router/Query, themes, and UI primitives | Add authentication and board routes using the established frontend conventions              |
| Phase 2 local editor and `/demo` namespace                                   | Preserve the local demo independently from authenticated server board metadata              |

The following baseline constraints remain binding:

- Better Auth owns its user, session, account, and verification tables. Application code uses the
  library and its public session interface rather than writing those rows directly.
- The Better Auth user ID is text. Do not cast or migrate it to UUID.
- Runtime application connections use the configured pooled PostgreSQL URL. Migrations and
  transaction proofs that require session semantics use the direct URL.
- The database schema is migration-owned. No environment enables TypeORM schema synchronization.
- The native `ws` Phase 1 path is a compatibility boundary, not the Phase 4 production room.
- Phase 2's local save label continues to mean IndexedDB commit only. Phase 3 must not relabel a
  local document as server-saved.

## 4. Scope

### 4.1 Included

- Production GitHub OAuth configuration through Better Auth, session lookup, current-user REST
  data, credentialed browser requests, sign-in, callback, session expiry, and sign-out behavior.
- Shared strict contracts for current-user data, board metadata, roles, membership, invitations,
  pagination, idempotency headers, and Phase 3 errors.
- A Nest request authentication boundary that converts a valid Better Auth session into a trusted
  actor and rejects absent or expired sessions.
- A single Nest board-permission service for read, metadata-write, graph-write, and owner-only
  decisions.
- Blank board creation with an owner, valid schema-version-1 empty Yjs snapshot, and idempotency
  record committed in one PostgreSQL transaction.
- Board list, title search, active/archive filtering, stable cursor pagination, read, rename,
  description update, archive, restore, and committed-state duplication.
- The active-owned-board limit from `plan.md`, enforced transactionally under concurrent creates.
- Membership list, role change, owner removal protection, owner-only removal, and member self-leave.
- Cryptographically random invite creation, one-time token return, hash-only storage, list/revoke,
  signed-in preview, atomic acceptance, expiry, exhaustion, and idempotent replay by the accepting
  user.
- Request-scoped creation idempotency for board creation, duplication, and invite creation, with
  request hash comparison and 24-hour durable responses.
- Authenticated `/boards` route, loading/empty/error/cached-unavailable states, title search,
  archive filter, blank-board creation, rename, archive, restore, duplicate, and sign-out controls.
- A signed-out landing state with GitHub sign-in and an authenticated redirect to `/boards`.
- Shared error translation, request IDs, safe structured logs, and exact OpenAPI documentation for
  the Phase 3 REST surface.
- Real-PostgreSQL transaction and concurrency tests plus supported-browser evidence for the
  identity and dashboard flows.

### 4.2 Excluded

- Production collaboration rooms, the final WebSocket adapter, server-ready snapshots, presence,
  cursors, drag previews, update acknowledgements, reconnect, compaction, or a server-save label.
- Opening an authenticated board as a synchronized editable document. Phase 4 connects the local
  editor to durable collaboration.
- Service-worker caching, offline authenticated routes, cached account switching, revocation
  recovery, or update prompts. These remain Phase 5 work.
- The finished share dialog, invitation page experience, role-management interface, query
  invalidation across open clients, and comments. These remain Phase 6 work. Phase 3 delivers and
  verifies the membership and invitation APIs on which that experience depends.
- Presentation steps, presenter leases, checkpoints, JSON import, general JSON export, SVG/PNG
  export, and the complete template set. These remain Phase 7 work.
- Board ownership transfer, hard deletion, member email delivery, public anonymous links,
  organizations, enterprise SSO, password authentication for production, and custom OAuth flows.
- Inserting a template into an existing board. `templateId` is reserved by the final create-board
  contract; Phase 3 dashboard creation is blank, and Phase 7 completes the three-template product
  flow.
- Full release rate tuning, hosted backup drills, cross-browser certification, and production
  deployment. These remain Phase 8 work.

## 5. Non-negotiable architecture rules

1. Better Auth remains the sole authority for OAuth, sessions, auth cookies, and sign-out. Nest
   consumes authenticated sessions through the exported auth application boundary; it does not
   implement a parallel token or cookie format.
2. GitHub client secrets, the Better Auth secret, session cookies, database URLs, OAuth account
   data, invitation tokens, and token hashes never enter browser bundles, Y.Doc data, exports, or
   logs.
3. Auth routes remain `/api/auth/*`; product REST routes remain under `/api/v1`. Better Auth stays
   mounted before JSON parsing, and credentialed CORS/trusted-origin behavior remains explicit.
4. Every protected request derives the actor from the session. User IDs, owner IDs, authorship,
   and effective roles are never accepted from request bodies.
5. Board authorization is implemented once in the boards application layer. Controllers,
   repositories, and future collaboration code must not grow separate role matrices.
6. Owner is derived from `boards.owner_user_id`. There is no owner row in `board_members`; owners
   cannot be removed, demoted, or transferred in version 1.
7. For board-scoped reads, a nonmember receives `NOT_FOUND` even when the board exists. A known
   member who lacks permission for an allowed resource receives `FORBIDDEN`.
8. Mutation authorization is checked again while holding the board row lock in the same database
   transaction as the effect. A controller-only check is insufficient.
9. Archive, restore, membership changes, invite changes, and durable graph writes use the same
   board-row serialization policy. Database commit decides ordering.
10. `metadata_version` protects metadata and lifecycle writes only. `latest_seq` remains the graph
    update sequence and is serialized as a decimal string in JSON.
11. Board title and access metadata stay in PostgreSQL and never move into the Y.Doc. A new board's
    initial Yjs snapshot is valid graph state, not an editable relational node array.
12. Creation endpoints store the idempotency result in the transaction that performs the effect.
    A replay with the same actor, operation, key, and request hash returns the stored replay-safe
    response; a different request hash returns `IDEMPOTENCY_CONFLICT`. The one-time raw invite URL
    is never placed in that stored response.
13. Invite tokens contain 32 cryptographically random bytes encoded as base64url. Only the SHA-256
    digest is stored. The raw token is returned once and is never recoverable from list APIs.
14. Duplicate reads committed server content, validates it, remaps every graph object and reference
    together, and creates a private board. It never copies member, invite, comment, checkpoint,
    receipt, or update history.
15. Browser server state uses TanStack Query. Zustand remains limited to ephemeral editor state and
    must not become a board metadata cache or session authority.
16. All request, response, query, path, and error shapes are strict shared contracts. Controllers
    do not publish locally invented role enums or subtly different DTOs.

## 6. Identity and session behavior

### 6.1 Better Auth configuration

- Production identity uses GitHub through Better Auth. Request only the identity scopes required
  for sign-in. Do not request repository access.
- `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are backend-only configuration. Production startup
  fails clearly when GitHub identity is enabled but either value is missing.
- Better Auth's base URL, trusted web origins, secure-cookie behavior, and callback URL come from
  validated configuration. Production origins must be HTTPS and must not contain paths, queries,
  fragments, or wildcards.
- Test-only email/password support may remain available only in `mode === 'test'` for deterministic
  integration setup. It is not rendered by the product or enabled in production.
- Preserve all `Set-Cookie` headers and Better Auth response headers across the Express/Nest
  boundary. Do not copy a session into localStorage or a custom bearer token.

### 6.2 Product session boundary

`AuthSessionLookup` remains the public server boundary and is expanded only as needed to return a
trusted current-user summary. Feature modules depend on that application interface, not on Better
Auth runtime internals.

`GET /api/v1/me` returns the signed-in user's stable ID, name, email, and nullable image URL in the
standard `{ data: ... }` envelope. It returns `UNAUTHENTICATED` with status 401 when the session is
missing or expired. It never returns accounts, provider tokens, session tokens, cookie values, or
internal Better Auth rows.

The frontend resolves the initial session before redirecting:

- A signed-out `/` route shows GitHub sign-in and the local demo action.
- A signed-in `/` route redirects to `/boards`.
- A protected route with no session redirects to `/` while preserving a safe same-origin return
  path when useful.
- Sign-out calls Better Auth, clears authenticated TanStack Query data, and returns to `/`.
- A 401 from any protected request invalidates the current session view and follows the same
  sign-in path. It does not erase the separate `/demo` namespace.
- Authentication network failure is distinct from signed-out state and offers retry. The browser
  must not infer sign-out merely because one request failed.

### 6.3 Account data and display

Names and images displayed for owners, members, or inviters come from server-owned Better Auth user
records. User-provided graph or request data cannot impersonate identity. Render names as text, use
safe image handling, and provide a text fallback when an image is absent or fails.

Phase 3 does not define local cache account switching. Authenticated board metadata must not be
written into the Phase 2 demo namespace.

## 7. Permission model

### 7.1 Effective role

The permission service resolves exactly one effective role:

1. `owner` when `boards.owner_user_id` equals the session user ID.
2. The `editor` or `viewer` value in `board_members` otherwise.
3. No access when neither relationship exists.

The service exposes application-level decisions for `read`, `editMetadata`, `editGraph`, and
`manageAccess`. It applies the matrix below:

| Operation                                     | Owner          | Editor | Viewer |
| --------------------------------------------- | -------------- | ------ | ------ |
| Read active or archived board and member list | Yes            | Yes    | Yes    |
| Rename or describe an active board            | Yes            | Yes    | No     |
| Persist active graph or presentation data     | Yes            | Yes    | No     |
| Duplicate readable committed content          | Yes            | Yes    | Yes    |
| Archive or restore                            | Yes            | No     | No     |
| Manage member roles or other members          | Yes            | No     | No     |
| Create, list, or revoke invites               | Yes            | No     | No     |
| Leave board                                   | Not applicable | Yes    | Yes    |

Archived boards are readable and duplicable by existing members. Metadata edits, graph writes,
membership changes, and invite listing, creation, revocation, or acceptance are blocked until the
owner restores the board. The owner may change access after restoring and archive it again
afterward.

### 7.2 Information disclosure

- `GET /boards/:id` and all board-scoped subordinate routes return 404 for a missing board or a
  caller with no relationship to it.
- Once a caller is known to be a member, an insufficient role returns 403.
- A subordinate ID is always resolved with its path board ID. A member cannot use an invite or
  member identifier from another board.
- Invite preview is token-scoped and returns only board title, inviter name, role, and expiry. A
  missing, malformed, revoked, or otherwise unavailable token returns the same 404 shape.
- Search and pagination never include inaccessible board counts or cursor data.

### 7.3 Transaction-time enforcement

Read checks may use a normal query. Every mutation starts a transaction, locks the authoritative
board row with `FOR UPDATE`, resolves the actor's current role in that transaction, checks archive
state, and only then applies the effect.

The durable update persistence boundary must call this shared policy while holding the same board
row lock. This proves the ordering required by A27:

- If a graph update locks and commits first, the archive transaction waits, then archives; the
  update remains accepted as a pre-archive write.
- If the archive locks and commits first, a waiting graph update rereads the archived state and is
  rejected without advancing `latest_seq`, inserting update bytes, or creating a receipt.

Role removal follows the same rule. A write committed before the removal transaction remains
accepted; a later write fails. Phase 4 adds socket notification and disconnection after the access
transaction commits.

## 8. Board lifecycle

### 8.1 Creation

Board titles are trimmed and contain 1–120 characters. Descriptions are plain text up to 2,000
characters. The dashboard supplies `Untitled architecture` when the user does not enter a title;
the API receives and validates the resulting title.

`POST /boards` requires a UUID `Idempotency-Key`. In one transaction it:

1. Locks the authenticated user row, cleans or ignores expired idempotency entries as appropriate,
   and enforces at most 100 active owned boards.
2. Inserts the board with the authenticated actor as immutable owner, `metadata_version = 1`,
   `latest_seq = 0`, and server timestamps.
3. Creates and validates a schema-version-1 empty Y.Doc and stores its encoded state in
   `board_snapshots` with `through_seq = 0` and an exact `byte_length`.
4. Stores the successful response and canonical request hash in `api_idempotency` with a 24-hour
   expiry.
5. Commits all records together or none of them.

No owner membership row is inserted. No comment, invite, checkpoint, or update record is created.
Phase 3 creates blank boards; nonempty template instantiation is completed in Phase 7.

### 8.2 List and read

`GET /boards` returns boards owned by the actor or joined through `board_members`, without
duplicates. Search matches trimmed titles case-insensitively. Archived boards are excluded by
default and selected through the explicit `archived` filter.

Ordering is `content_updated_at DESC, id DESC`. The opaque cursor contains the last ordering tuple
and is strictly validated. Default page size is 30 and maximum page size is 100. `latestSeq` is a
decimal string. The summary includes effective role and enough lifecycle metadata for the
dashboard, but no graph bytes, invitation data, member email addresses, or auth data.

`GET /boards/:id` returns metadata, effective role, `latestSeq`, and member count. It does not load
or project the graph. Phase 4 defines the collaboration join path for graph content.

### 8.3 Metadata updates

Owners and editors may update title and description on an active board. The request contains at
least one changed field and `expectedVersion`. The service locks the board, rechecks permission and
archive state, and compares `metadata_version`.

- A stale version returns `VERSION_CONFLICT` with status 409 and does not partially update fields.
- A successful change increments `metadata_version` once and sets `updated_at` from the database.
- A validated request that produces no value change returns the current object without incrementing
  the version.
- Metadata edits do not advance `latest_seq` and do not pretend to be graph content updates.

### 8.4 Archive and restore

Only the owner can archive or restore. Each request carries `expectedVersion`, locks the board, and
applies one atomic state transition.

- Archive sets `archived_at`, increments `metadata_version`, and updates `updated_at`.
- Restore clears `archived_at`, increments `metadata_version`, and updates `updated_at`.
- Repeating the already-achieved state with the current version returns the current object without
  another version increment.
- A stale version returns 409 even if another request already reached the desired state.
- Archive never deletes snapshots, updates, members, invites, comments, or checkpoints.
- Archived boards remain readable and duplicable, and appear only through the archive filter.

### 8.5 Duplication

Any reader may duplicate an active or archived board. The request supplies a valid new title and a
UUID idempotency key. The duplicate is always private and owned by the caller.

The transaction obtains a consistent committed source through the source board's snapshot and
ordered updates up to its locked `latest_seq`. Application code reconstructs and validates the
document, derives a strict `GraphProjection`, generates one fresh-ID mapping for nodes, edges,
boundaries, and steps, remaps all references, and creates a new Y.Doc. The new board and snapshot
commit with `latest_seq = 0` and `through_seq = 0`.

Duplication enforces the same 100-active-owned-board limit as blank creation while holding the
caller's user row lock. It locks the caller row before the source board row; no Phase 3 transaction
may acquire those two locks in the opposite order.

The duplicate excludes memberships, invitations, comments, checkpoints, update rows, receipts,
presence, and CRDT history. Source permissions are used only to authorize the read. Failure to
validate or remap the full source aborts without creating a partial board. Phase 7 repeats the
fresh-ID proof with every card kind and the complete portability fixtures.

The dashboard describes duplication as copying the committed server version. Until Phase 4 can
drain a local outbox, it must not imply that local-only `/demo` edits are included.

## 9. Membership and invitations

### 9.1 Membership

`GET /boards/:id/members` is available to every reader and returns the owner plus editor/viewer
members. It contains safe user summaries, effective roles, and server timestamps. It never returns
provider account data or invitation token information.

Only an owner may change another member between editor and viewer. The target must already be a
member, cannot be the owner, and is resolved under the path board. A successful role change is one
transaction and does not create duplicate membership rows.

Only an owner may remove another member. An editor or viewer may remove themselves to leave the
board. Owners cannot leave or remove themselves because ownership transfer and deletion are
deferred. Removal of a missing membership is naturally idempotent only after the caller's current
authority is established; cross-board or inaccessible targets still follow the 404 policy.

If a leaving or removed member may have unsynchronized edits, the finished client must use the
preservation flow from `plan.md`. Phase 3 has no authenticated sync outbox, so it establishes the
server behavior without claiming that Phase 5 recovery experience.

### 9.2 Invite creation and storage

Only the owner of an active board may create an invite. The request chooses `editor` or `viewer`
and requires a UUID idempotency key. The server generates 32 random bytes, base64url-encodes the raw
token, stores only its SHA-256 hash, and sets expiry to exactly seven days from server time.

The creation response contains invite metadata and the shareable URL once. An idempotent replay of
the same request during the 24-hour window returns the stored successful metadata with
`inviteUrl: null` and `inviteUrlAvailable: false`; it does not expose the secret again. The first
response sets `inviteUrlAvailable: true` and includes the URL from request-scoped memory after the
transaction commits. The raw token is never written into `api_idempotency.response_json`. List
responses contain ID, role, creator summary, created time, expiry, and derived status only; they
never contain the raw token or hash.

Owners can revoke an unaccepted invite. Revocation is a durable timestamp and does not delete the
row. Revoking again is a successful no-op. An accepted invite remains an audit record and cannot be
reissued or transferred.

### 9.3 Preview and atomic acceptance

Preview and acceptance require a signed-in user. The server decodes the base64url token strictly,
hashes it, and uses the digest for lookup. Raw tokens are not placed in log fields, error messages,
metrics, or database query diagnostics controlled by the application.

Invite acceptance first resolves the digest to a candidate board without trusting its status, then
locks the board row and refetches the invite `FOR UPDATE` in that order. It revalidates every state
inside the transaction and completes atomically:

- Missing, malformed, or revoked token: `INVITE_UNAVAILABLE`, status 404.
- Expired token: `INVITE_EXPIRED`, status 410.
- Archived board: `BOARD_ARCHIVED`, status 409; the token is not consumed.
- Unaccepted valid token: create membership, retain a stronger existing role, or upgrade viewer to
  editor; then record `accepted_by` and `accepted_at`.
- Existing owner: create no member row, but record that owner as the accepting user so retries have
  stable behavior.
- Retry by the recorded accepting user: return success with the board ID and current effective
  role.
- Attempt by another user after acceptance: `INVITE_EXHAUSTED`, status 409.

Two independent database connections racing to accept the same invite must produce exactly one
accepting user. A unique constraint alone is insufficient evidence; the test must prove the full
response and membership behavior.

## 10. REST and frontend contracts

### 10.1 API conventions

Product routes use `/api/v1`. Successful objects return `{ data: ... }`; collections return
`{ data: [...], nextCursor: string | null }`. Errors use:

```ts
type ApiErrorEnvelope = {
  error: {
    code: ErrorCode;
    message: string;
    fieldErrors?: Record<string, string[]>;
    requestId: string;
  };
};
```

All IDs are UUID strings except Better Auth user IDs, which are opaque nonempty strings. All
timestamps are ISO 8601 UTC strings. `latestSeq` is a branded decimal string. Request objects are
strict and reject unknown fields. Query booleans, page limits, cursors, idempotency keys, and path
IDs are validated before application services run.

Phase 3 implements these routes:

| Method/path                            | Request                               | Result and role                                                     |
| -------------------------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| GET `/me`                              | none                                  | Current user; 401 if unauthenticated                                |
| GET `/boards`                          | search?, archived?, cursor?, limit?   | Accessible board summaries                                          |
| POST `/boards`                         | title, description?                   | New blank private board; signed-in user; 201                        |
| GET `/boards/:id`                      | none                                  | Metadata, effective role, latest sequence, member count; any reader |
| PATCH `/boards/:id`                    | title?, description?, expectedVersion | Updated active metadata; owner/editor                               |
| POST `/boards/:id/archive`             | expectedVersion                       | Archived metadata; owner                                            |
| POST `/boards/:id/restore`             | expectedVersion                       | Restored metadata; owner                                            |
| POST `/boards/:id/duplicate`           | title                                 | New private board from committed state; any reader; 201             |
| GET `/boards/:id/members`              | none                                  | Owner and members; any reader                                       |
| PATCH `/boards/:id/members/:userId`    | role                                  | Updated member; owner                                               |
| DELETE `/boards/:id/members/:userId`   | none                                  | Owner removes member or member leaves; 204                          |
| GET `/boards/:id/invites`              | cursor?, limit?                       | Invite metadata; owner                                              |
| POST `/boards/:id/invites`             | role                                  | One-time invite URL and metadata; owner; 201                        |
| DELETE `/boards/:id/invites/:inviteId` | none                                  | Revoke invite; owner; 204                                           |
| POST `/invites/preview`                | token                                 | Limited invite preview; signed-in user                              |
| POST `/invites/accept`                 | token                                 | Board ID and effective role; signed-in user                         |

`Idempotency-Key` is required for board creation, duplication, and invite creation. It is a header,
not a request-body field. Scope is authenticated actor plus operation. Request hashing uses a
documented canonical representation. Reuse with different content returns 409. A client does not
blindly retry after the 24-hour record expires. The invite-create response explicitly models the
one-time URL as described in section 9.2; a replay never reconstructs or stores that secret.

Common codes used in this phase are `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401), `FORBIDDEN`
(403), `NOT_FOUND` or `INVITE_UNAVAILABLE` (404), `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`,
`INVITE_EXHAUSTED`, or `BOARD_ARCHIVED` (409), `INVITE_EXPIRED` (410), `PAYLOAD_TOO_LARGE` (413),
`RATE_LIMITED` (429), and `TEMPORARILY_UNAVAILABLE` (503). Unexpected failures return a safe
message and request ID without exposing SQL, stack traces, tokens, or board existence.

### 10.2 Dashboard behavior

The authenticated `/boards` route contains:

- User identity and sign-out in the application header.
- Search input with deliberate query timing and cancellation so stale responses do not replace a
  newer query.
- Active/archived filter and cursor-backed pagination or load-more behavior.
- Loading skeleton, empty active state, empty search state, retryable error, session-expired state,
  and an explicit network-unavailable state.
- Blank-board creation with title and optional description.
- Accessible rename/description, archive, restore, and duplicate actions appropriate to the
  effective role and archive state.
- Stable focus after dialogs close and a live announcement after successful create/archive/restore
  actions.

Controls reflect server permissions, but hidden or disabled controls are never the security
boundary. Optimistic metadata UI is allowed only when it can cleanly roll back on a 409 or failed
request. A version conflict refreshes authoritative metadata and explains that the board changed.

Phase 3 does not expose incomplete editing or sharing controls. `/demo` remains clearly local-only.
Authenticated board cards may provide management actions; opening a server-backed collaborative
editor is enabled in Phase 4.

### 10.3 Frontend data ownership

- A small typed API client sends credentials, parses shared schemas, maps the standard error
  envelope, and supports request cancellation.
- TanStack Query owns current-user, board list, board detail, member, and invite server state.
- Mutations invalidate or update the narrow affected query keys after confirmed responses.
- Router loaders may prefetch, but components do not duplicate query results into Zustand or a
  second global store.
- Idempotency keys are generated once per user intent and reused only for retries of that exact
  intent. Opening a new create dialog generates a new key.
- Raw invite tokens, if exercised by developer tooling, remain in transient memory and are never
  persisted in localStorage, IndexedDB, query persistence, analytics, or logs.

## 11. Persistence and transaction rules

### 11.1 Repository boundaries

Controllers validate transport data and call application services. Application services own
authorization and transaction orchestration. Infrastructure repositories perform explicit queries
and return domain-shaped records. TypeORM entities do not leak into shared contracts or the web
application.

Use the existing feature-owned entities and database module. Do not create a second data source per
request. Every multi-record lifecycle operation uses a `QueryRunner` transaction and always
releases it. Transaction tests must exercise the real PostgreSQL behavior.

### 11.2 Migrations

The committed initial migration and Better Auth SQL are historical artifacts. Do not edit an
already-applied migration to make Phase 3 tests pass. If implementation needs a new constraint,
index, or column, add a forward migration with a complete `down` path, register the related entity,
and update schema verification.

Phase 3 must verify:

- Fresh database migration from zero.
- Upgrade from the completed Phase 1/2 schema.
- `db:migration:show` reports every committed migration applied.
- Foreign keys, role checks, token uniqueness, acceptance consistency, and idempotency uniqueness
  fail closed at the database boundary.

### 11.3 Idempotency

The idempotency service checks actor, operation, and key under transaction, compares a SHA-256 hash
of the canonical request, and returns the stored status/body when it matches. The effect and stored
response commit together. Concurrent identical requests yield one effect and equivalent
replay-safe responses. For invite creation, only the request that generated the token can include
the one-time URL; all replays return the redacted stored response. Concurrent different requests
using the same key yield one effect and one conflict.

Expired records may be deleted by bounded cleanup. Cleanup is not part of a correctness-critical
request transaction and must not delete unexpired entries.

### 11.4 Time and sequence values

Database time is authoritative for creation, update, archive, invitation, acceptance, and expiry
timestamps. Tests control time through a transaction-safe clock boundary or database fixtures
without changing production semantics. PostgreSQL bigint values remain strings from repository to
JSON response.

## 12. Security, accessibility, and operational behavior

- Preserve Better Auth's CSRF and origin protections. Credentialed CORS allows only configured
  origins. Never combine credentials with a wildcard origin.
- Session cookies are Secure and HttpOnly in production with the appropriate SameSite policy for
  the selected origin topology. JavaScript never reads them.
- Apply bounded JSON body and query limits before expensive work. Invitation and authentication
  endpoints participate in configured request throttling; exact production tuning remains Phase 8.
- Log request ID, safe route template, status, duration, actor ID after authentication, board ID
  after validation, and safe error code. Exclude names, emails, board titles/descriptions, raw URLs
  containing invite tokens, cookies, request bodies, OAuth data, and token hashes.
- Invite-facing pages use `Referrer-Policy: no-referrer` when the Phase 6 page is added. Phase 3 API
  responses must already avoid redirects or logs that expose the token.
- Render all identity and board text as text. Avatar or image URLs never become HTML, script, or a
  server-side preview fetch.
- Forms have labels, field descriptions, inline validation, and focusable error summaries where
  useful. Dialogs use the existing accessible primitives. Icon-only controls have names and
  tooltips.
- Keyboard users can sign in, sign out, search, filter, create, rename, archive, restore, duplicate,
  dismiss dialogs, and retry failures with visible focus.
- Color is not the only indication of role, archive state, error, or network state.
- Loading does not flash signed-out content before session resolution. Narrow screens provide a
  usable board-management surface even though full canvas editing remains desktop-oriented.
- `/health/live` remains process health. `/health/ready` includes database connectivity and schema
  compatibility; Phase 3 must not report ready when required migrations are missing.

## 13. Limits and consistency budgets

Phase 3 enforces the relevant centralized product limits:

| Area                        | Phase 3 requirement                                                |
| --------------------------- | ------------------------------------------------------------------ |
| Board title                 | Trimmed, 1–120 characters                                          |
| Board description           | Plain text, at most 2,000 characters                               |
| Active owned boards         | At most 100 per user, enforced under concurrent creation           |
| List page                   | Default 30, maximum 100, stable `(content_updated_at, id)` cursor  |
| Invite entropy and lifetime | 32 random bytes, base64url, seven days from server time            |
| Idempotency lifetime        | 24 hours from server time                                          |
| Initial/duplicated graph    | Accepted encoded Yjs state remains within the shared 10 MiB limit  |
| REST body and query parsing | Bounded before application processing; oversized input returns 413 |

Database queries for list, permission lookup, member list, invite list, and idempotency lookup must
use the committed indexes or add a migration-backed index justified by `EXPLAIN` evidence. Avoid
per-row user or membership queries. Record representative query plans and timings for a fixture
containing owned boards, joined boards, archived boards, and enough rows to exercise pagination.

Performance measurements are evidence about the recorded environment, not universal claims. A
missed target or sequential query problem is fixed or documented as a blocker; it is not hidden by
using an unrealistically empty fixture.

## 14. Work breakdown

Tasks are completed in dependency order. Each task owns a bounded module set and an evidence file.
Exact internal filenames may evolve, but responsibility and contracts must remain clear.

| ID    | Task                                     | Depends on          | Primary output                                                                                           | Completion evidence                                                                                  |
| ----- | ---------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| P3-01 | Identity and board REST contracts        | Phase 2             | Strict Zod schemas/types for users, boards, roles, members, invites, pagination, idempotency, and errors | Contract tests cover valid boundaries, unknown keys, bigint strings, cursors, and all invalid limits |
| P3-02 | Product Better Auth and current user     | P3-01               | GitHub provider config, trusted session actor, `/me`, sign-out/session behavior                          | Real cookie integration passes; production config rejects missing/unsafe OAuth settings              |
| P3-03 | Persistence and transaction primitives   | P3-01               | Repositories, board-row locking, idempotency service, initial snapshot factory, any forward migration    | Fresh/upgrade migration and real-PostgreSQL atomicity tests pass                                     |
| P3-04 | Shared permission service                | P3-02, P3-03        | Effective-role resolution and read/metadata/graph/access decisions reused by durable update persistence  | Full role/archive matrix passes; duplicate permission logic is removed from the Phase 1 harness      |
| P3-05 | Board create, list, read, and metadata   | P3-03, P3-04        | Blank create, stable list/search/filter/cursor, detail, rename, description, active-board limit          | HTTP and real-DB tests prove isolation, version conflicts, concurrency, and exact response schemas   |
| P3-06 | Archive, restore, and duplicate          | P3-05               | Serialized lifecycle transitions and fresh-ID committed-state duplication                                | A27 transaction harness passes; duplicate has fresh IDs and excludes access/history records          |
| P3-07 | Membership lifecycle                     | P3-04, P3-05        | Member list, role changes, removal, self-leave, immutable owner behavior                                 | Role matrix and cross-board subordinate-ID tests pass through authenticated HTTP                     |
| P3-08 | Invitation lifecycle                     | P3-03, P3-04, P3-07 | Secure create/list/revoke/preview/accept with atomic single use                                          | A19 passes on independent DB connections; token secrecy and expiry cases pass                        |
| P3-09 | REST composition and API documentation   | P3-05–P3-08         | Controllers, guards/interceptors, error mapping, request IDs, OpenAPI, health readiness                  | Supertest responses match contracts and documented status/error behavior                             |
| P3-10 | Frontend authentication                  | P3-02, P3-09        | Typed credentialed client, auth provider/query, GitHub sign-in, redirects, sign-out, route states        | Supported-browser session lifecycle and network-error evidence recorded                              |
| P3-11 | Authenticated dashboard                  | P3-05, P3-06, P3-10 | `/boards` list/search/filter/create/rename/archive/restore/duplicate experience                          | Supported-browser owner/editor/viewer and loading/empty/error/version-conflict flows recorded        |
| P3-12 | Authorization and concurrency acceptance | P3-06–P3-09         | A11 Phase 3 boundary, A19, A27, idempotency races, query-plan evidence                                   | Real-PostgreSQL suite passes without mocked authorization or transactions                            |
| P3-13 | Phase audit and handoff                  | All prior tasks     | Final matrix, commands/results, migration status, security review, limitations                           | Every exit criterion links to evidence or an explicit blocker                                        |

Tasks with satisfied dependencies may be implemented in parallel only when they do not share
migrations, contract exports, auth runtime configuration, application services, or frontend route
composition. The integrating agent owns conflicts and reruns every affected check after integration.

## 15. Verification requirements

### 15.1 Static, migration, and build checks

- Installation succeeds from the committed lockfile with exact direct dependency versions.
- Formatting, lint, strict TypeScript, boundary, API build, web build, and workspace build pass.
- Better Auth generated SQL still matches the committed auth schema.
- Migrations succeed from an empty isolated schema and from the preceding completed schema.
- `synchronize` remains false in every data-source option.
- Contracts and document-model retain their framework boundaries; browser code contains no backend
  auth/database imports or secret environment names.
- OpenAPI exposes the Phase 3 product routes and standard errors without documenting raw tokens as
  list output or security metadata as client input.

### 15.2 Contract and application checks

- Every request, response, cursor, path parameter, role, timestamp, and error envelope is parsed by
  a strict shared schema at the appropriate trust boundary.
- Owner is derived only from `boards.owner_user_id`; owner mutation attempts fail.
- Active/archived read and mutation behavior matches the permission matrix.
- Nonmembers receive the same 404 shape for absent and inaccessible board resources.
- Metadata writes reject stale versions without partial changes.
- Board create and duplicate atomically write owner metadata, snapshot, and idempotency response.
- Initial and duplicate snapshots decode as valid schema-version-1 documents at sequence zero.
- Duplicate remaps IDs and references and excludes source membership/history.
- Member role and removal operations are scoped to the route board.
- Invite generation, hashing, expiry, revocation, preview, role upgrade, owner no-op, same-user retry,
  and other-user exhaustion match section 9.
- Idempotency races produce one effect; key reuse with a different request produces 409.
- Logs and HTTP responses contain no raw invite token except the authorized one-time create
  response, and contain no cookie, OAuth secret, token hash, SQL, or stack trace.

### 15.3 Database and acceptance evidence

Phase 3 must prove these acceptance-test portions from `plan.md`:

| Test | Phase 3 assertion                                                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A11  | Viewer graph-write authority is rejected with accepted bytes/sequence unchanged; nonmembers and cross-board subordinate IDs receive no state or existence disclosure |
| A19  | Two different signed-in users concurrently accept one single-use invite; exactly one becomes the recorded accepting user/member, while same-user retry is idempotent |
| A27  | Archive and a graph-update transaction use the same board lock; commit order is defined and no graph write commits after archive                                     |

A11's raw production-room WebSocket path is completed in Phase 4. Phase 3 must exercise the shared
permission service through the existing durable-update persistence boundary, not merely call a
pure role function. A27 is a real transaction proof at this phase; socket notification and room
disconnection remain Phase 4 integration.

Additional mandatory real-database cases cover:

- Concurrent board creation at the 100-active-owned-board boundary.
- Same-key identical and different-payload idempotency races.
- Owner/editor/viewer/nonmember access for every Phase 3 board and membership endpoint.
- Stable pagination with equal `content_updated_at` values and membership joins without duplicates.
- Metadata version conflict, archive/restore repeat, and editor write racing owner removal.
- Invite expiry, revocation, viewer-to-editor upgrade, editor non-demotion, owner acceptance, and
  cross-board invite ID misuse.
- Rollback after injected failure between each multi-record effect and its idempotency response.

### 15.4 Browser evidence

Supported-browser evidence must cover:

- Real GitHub sign-in and callback with the configured development OAuth application.
- Initial session resolution without signed-out-content flash.
- Authenticated redirect, refresh, expired-session handling, retryable auth-network failure, and
  sign-out.
- Board list loading, empty, search-empty, error/retry, active, and archived states.
- Blank create, rename/description, stale-version refresh, archive, restore, and duplicate flows.
- Owner/editor/viewer controls matching their effective role while forged HTTP remains denied.
- Keyboard operation, visible focus, dialog focus return, error announcements, and narrow-screen
  board management.
- `/demo` remains local-only and is neither erased nor represented as a server board after sign-in
  or sign-out.

### 15.5 Evidence realism

- Authenticated HTTP tests obtain an actual Better Auth cookie through the mounted handler. A
  hard-coded actor header or mocked guard cannot satisfy the gate.
- Transaction, locking, uniqueness, migration, and query-plan evidence runs against real
  PostgreSQL in an isolated schema. SQLite, an in-memory repository, and mocked TypeORM calls cannot
  satisfy those assertions.
- A19 and A27 use independent database connections and a deterministic barrier. Awaiting two
  operations that share one serialized mock does not prove concurrency.
- GitHub product sign-in evidence uses the actual provider flow. Test-only email/password proves
  deterministic API behavior but does not prove the required production identity path.
- Browser evidence uses the served production build in the supported browser and records browser,
  runtime, origin configuration, and result. Component-unit rendering alone is insufficient.
- Secret checks use synthetic tokens and credentials. Evidence files redact values and never
  include cookies, OAuth callback URLs containing codes, database URLs, raw invite URLs, or full
  environment dumps.

## 16. Required verification commands

The repository must expose and document concrete commands for the checks below. Exact focused
script names may be introduced during implementation, but Phase 3 should converge on one aggregate
gate such as `pnpm phase3:verify`.

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
pnpm --filter @archboard/api test
pnpm --filter @archboard/api test:integration
pnpm --filter @archboard/api build
pnpm --filter @archboard/web build
pnpm build
pnpm boundary:check
pnpm phase1:verify
pnpm phase2:verify
pnpm phase3:verify
```

The final audit records the exact commands that exist at that point, test counts, relevant
durations, PostgreSQL/runtime/browser versions, and PASS/FAIL/UNRUN. An aggregate command does not
replace reporting its meaningful children.

Phase 1 and Phase 2 regressions remain mandatory. A Phase 3 change to auth mounting, configuration,
migrations, contracts, the durable-update harness, app routing, or shared frontend providers must
not weaken the earlier guarantees. Environment-dependent checks are recorded honestly when their
required credentials or database are unavailable; Phase 3 cannot pass by replacing a required
real integration with a mock.

## 17. Deliverables

Phase 3 is complete only when these deliverables exist and agree:

1. Shared strict Phase 3 user, board, role, member, invite, cursor, idempotency, and error contracts.
2. Production GitHub provider configuration and preserved Better Auth handler/session lifecycle.
3. Authenticated `/api/v1/me` and a reusable Nest actor boundary.
4. One board-permission service shared by REST and durable graph-update persistence.
5. Transactional blank-board initialization with a valid empty Yjs snapshot and owner limit.
6. Stable accessible-board list/search/archive pagination and board detail APIs.
7. Optimistically versioned rename/description plus serialized archive/restore.
8. Committed-state duplicate with fresh graph IDs and no copied access/history data.
9. Membership list, role change, member removal, self-leave, and immutable-owner enforcement.
10. Secure invitation create/list/revoke/preview/accept with hash-only storage and single-use races.
11. Transactional 24-hour idempotency for board create, duplicate, and invite create.
12. Standard REST errors, request IDs, safe logs, readiness/schema checks, and exact OpenAPI output.
13. Signed-out/authenticated route behavior and typed credentialed frontend API/query layer.
14. Authenticated `/boards` dashboard with required lifecycle actions and route states.
15. Real-PostgreSQL A11 Phase 3, A19, and A27 evidence plus supported-browser auth/dashboard
    evidence.
16. Root Phase 3 verification command and updated local configuration/run documentation.
17. `docs/phase-3-identity-boards.md` with the final task/evidence matrix, migrations, query evidence,
    limitations, and pass/block decision.
18. Per-task evidence under `docs/evidence/phase3/` using the handoff format below.

## 18. Exit gate

Phase 3 passes when:

- Every P3 task is complete or explicitly marked blocked with reproducible evidence.
- Clean install, formatting, lint, strict types, unit tests, real-PostgreSQL integration tests,
  browser checks, migrations, auth-schema verification, package boundaries, and production builds
  pass.
- A real GitHub sign-in establishes a Better Auth session, `/me` returns the safe user summary,
  protected routes use the session, and sign-out invalidates authenticated frontend state.
- A board create transaction commits exactly one private owner board, valid initial snapshot, and
  idempotency result, including under concurrent retry and the active-board limit.
- Board listing returns only accessible records in deterministic order and search/archive filters
  do not leak other boards.
- Metadata, archive, restore, and duplicate behavior matches role, version, archive, and fresh-ID
  rules.
- Owner derivation, membership lifecycle, and all subordinate-resource lookups preserve board
  isolation.
- Invite tokens have required entropy, hash-only storage, one-time exposure, expiry/revocation, and
  deterministic single-use behavior.
- A19 proves one winner on independent concurrent connections and idempotent success for that same
  accepting user.
- A27 proves board archiving and graph updates serialize at the database row and no post-archive
  write changes sequence, update, snapshot, or receipt state.
- The A11 Phase 3 boundary proves viewer update rejection and no cross-board existence/data leak.
- The dashboard provides truthful signed-out, loading, empty, active, archived, conflict, network,
  and expired-session states with usable keyboard focus.
- The frontend contains no secret settings or custom session persistence, and `/demo` remains an
  isolated local-only board.
- Phase 1 and Phase 2 regression gates still pass, or an environment-dependent unrun portion is
  documented without weakening their implementation guarantees.
- The final audit distinguishes durable board metadata from durable collaborative graph editing
  and contains no claim of collaboration, production offline support, finished sharing UX, or
  release readiness.

If a required proof fails, Phase 3 remains open. Fix the implementation or propose a targeted
contract amendment with failed evidence and consequences; do not relabel a missing authorization
or transaction guarantee as later work when it is included above.

## 19. Handoff record

Each Phase 3 task report must contain:

```text
Task: <P3-ID and title>
Implemented behavior: <observable result>
Changed files/modules: <owned scope>
Contracts used: <DTOs, roles, errors, transaction locks, limits, and invariants>
Checks run: <exact commands>
Results: <PASS/FAIL/UNRUN with counts, PostgreSQL/browser/runtime details when relevant>
Database evidence: <migration, transaction, concurrency, rollback, and query-plan result, or not applicable>
Security evidence: <session/origin/token/log/isolation result, or not applicable>
Accessibility evidence: <keyboard/focus/screen-reader result, or not applicable>
Known gaps: <honest unresolved items>
Decision or amendment: <none, or link and rationale>
Next dependency unlocked: <task ID or phase exit>
```

The final handoff links every exit criterion to a contract test, authenticated HTTP result,
real-database transaction proof, browser observation, build, or audit section. Unrun checks are
labeled unrun. Mock sessions, mocked repositories, single-connection concurrency, and component-only
browser evidence are labeled as such and cannot satisfy a gate requiring the real boundary. No
evidence file may contain secrets, cookies, OAuth codes, database URLs, invitation tokens or hashes,
private user data, or full environment dumps.
