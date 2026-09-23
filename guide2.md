# Archboard Phase 3 — Commit-by-Commit Implementation Guide

Version: 1.0<br>
Date: 23 September 2026<br>
Status: Implementation guide<br>
Governing documents: `plan.md` version 1.1 and `phase3.md` version 1.0<br>
Branch policy: one long-lived Phase 3 branch for the entire milestone

## 1. Purpose

This guide turns Phase 3 into a sequence of small, reviewable commits that one implementing agent
can complete on a single branch without guessing authorization behavior, weakening the completed
Phase 1 and Phase 2 guarantees, or absorbing work from later milestones.

`plan.md` remains the product and architecture authority. `phase3.md` defines Phase 3 scope,
behavior, task list, and exit gate. This guide defines the single-branch workflow, exact commit
order, owned paths, required checks, evidence, and handoff requirements.

When documents disagree, use this order:

1. The user's latest written instruction.
2. `plan.md` product behavior and data invariants.
3. `phase3.md` Phase 3 scope and exit criteria.
4. This implementation guide.

The implementing agent must document a conflict instead of silently choosing a different contract.
Routine internal names may change when the resulting boundary is clearer, but authentication,
effective-role rules, transaction ordering, information-disclosure behavior, idempotency, token
secrecy, and response contracts must remain unchanged.

## 2. Fixed implementation decisions

### 2.1 One branch for all Phase 3 work

Use one branch named:

```text
phase-3-identity-boards
```

Create it once from the approved Phase 2 completion baseline after the Phase 3 planning documents
are present. Record that base commit in the P3-01 evidence file. All P3-01 through P3-13 commits and
focused fix commits land directly on this branch in dependency order.

This phase does not use per-task branches, temporary integration branches, worktrees, or
cherry-pick assembly. If more than one agent contributes, only one may edit or commit at a time.
The outgoing agent leaves the shared branch committed, tested for its task, and free of unrelated
working-tree changes before the next agent begins.

This guide does not authorize remote branch creation, pushing, merging, rebasing, deployment, OAuth
application creation, or production data changes. Perform those actions only when the user requests
them. If the branch already exists or the working tree contains user changes, inspect and preserve
them; do not force-create the branch or discard work.

### 2.2 Identity and session ownership

Better Auth remains the only OAuth and session authority.

```text
GitHub OAuth
     |
     v
Better Auth Express handler ----> auth-owned PostgreSQL tables
     |
     | secure HttpOnly cookie
     v
AuthSessionLookup
     |
     +----> /api/v1/me
     +----> board application services
     +----> future collaboration session checks
```

Rules:

- Keep Better Auth mounted before Nest JSON parsing.
- Preserve its cookies, redirects, callback behavior, and response headers.
- Production authentication uses GitHub and requests identity scopes only.
- Test-only email/password setup remains confined to `mode === 'test'` and is never rendered.
- Nest features depend on `AuthSessionLookup`, not Better Auth runtime internals.
- The actor comes from the session. Requests never choose an actor, owner, or effective role.
- Sessions and provider tokens never enter localStorage, Y.Doc, exports, logs, or client DTOs.
- A failed network request is not treated as proof that a session ended.
- Signing out clears authenticated query data but never clears the independent `/demo` namespace.

Add `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` as backend-only validated settings. Production
startup must fail clearly when required GitHub configuration is absent. Do not prefix either value
with `VITE_` or make it available to browser code.

### 2.3 Shared REST contracts

All Phase 3 trust-boundary shapes live in `packages/contracts`. Add focused modules for identity,
boards, pagination, and REST errors rather than placing all schemas in one file.

Contract rules:

- Request, response, path, query, cursor, and error schemas are strict.
- Application IDs are UUIDs. Better Auth user IDs remain opaque text.
- PostgreSQL `bigint` sequences are decimal strings from database to JSON.
- Timestamps are server-generated ISO 8601 UTC strings.
- Owner/editor/viewer values come from one exported role source.
- API success uses `{ data: ... }`; collections also include `nextCursor`.
- API errors use the Phase 3 `ApiErrorEnvelope` with a request ID.
- Unknown fields, malformed cursors, invalid limits, and invalid enum values fail before services.
- Controllers parse shared schemas; they do not recreate DTO classes with different constraints.
- OpenAPI describes the shared wire shapes and never presents security metadata as client input.

Keep contract modules independent of Nest, TypeORM, React, Better Auth, and browser APIs.

### 2.4 Central permission boundary

Implement one board permission service under the boards application layer.

```text
controller / room persistence
            |
            v
BoardPermissionService
  resolve effective role
  hide inaccessible boards
  enforce active/archive rules
            |
            v
transaction-scoped board row
```

Owner is derived from `boards.owner_user_id`; no owner membership row exists. Otherwise the
effective role comes from `board_members`. Missing relationship means no access.

The service exposes explicit decisions for read, metadata edit, graph edit, and access management.
Do not expose a generic boolean that forces callers to rebuild the role matrix. Read denial for a
nonmember maps to `NOT_FOUND`; a known member lacking an allowed operation maps to `FORBIDDEN`.

Every mutation repeats authorization after locking the board row inside its transaction. Route
guards may reject obvious unauthenticated requests, but a guard-only permission check is not enough.
The Phase 1 durable-update harness must be refactored to use the same application boundary so A11
and A27 exercise production authorization logic rather than a copied SQL role query.

### 2.5 Transaction and lock policy

PostgreSQL commit order is authoritative. Use explicit `QueryRunner` transactions for multi-record
effects. Always release the runner in `finally`.

Lock rules:

- Board mutations lock the board row `FOR UPDATE` before checking mutable role/archive state.
- Duplicate locks the caller's Better Auth user row before locking the source board row.
- No Phase 3 path acquires those two locks in the opposite order.
- Invite acceptance resolves a candidate by token digest, locks the board row, then refetches and
  locks the invite row before revalidating state.
- Member changes, invite changes, archive/restore, and graph writes serialize through the same board
  row.
- Database time supplies timestamps and expiry decisions.
- A rollback leaves metadata, memberships, snapshots, invitations, and idempotency rows unchanged.

Do not use an in-process mutex as proof of database serialization. A19 and A27 require independent
database connections and a deterministic barrier.

### 2.6 Idempotency and invitation secrecy

Board create, duplicate, and invite create require a UUID `Idempotency-Key`. The key is scoped to
actor plus operation. Store a SHA-256 request hash and replay-safe response in the same transaction
as the effect for 24 hours.

The invite secret is the special case:

- Generate 32 random bytes and encode them with base64url.
- Store only SHA-256 digest in `board_invites`.
- Return the raw URL only to the request that generated it.
- Store a redacted idempotency response with `inviteUrl: null` and
  `inviteUrlAvailable: false`.
- A replay returns that redacted response and never reconstructs the token.
- The raw token exists only in request-scoped memory and must not reach logs, evidence, query caches,
  local storage, or `api_idempotency.response_json`.

The frontend generates one key per user intent and reuses it only for retries of that exact intent.
A newly opened create dialog gets a new key.

### 2.7 Board content ownership

Board title, description, archive state, ownership, membership, invites, versions, and sequence
metadata belong in PostgreSQL. Graph content remains a Y.Doc snapshot plus ordered updates.

New blank boards atomically create:

```text
boards row
  +-- immutable owner_user_id
  +-- metadata_version = 1
  +-- latest_seq = 0
board_snapshots row
  +-- schema_version = 1
  +-- through_seq = 0
  +-- validated encoded empty Y.Doc
api_idempotency row
```

Duplication reconstructs committed source state, validates it, projects it, remaps every graph ID
and reference once, hydrates a new Y.Doc, and stores one sequence-zero snapshot. It never copies
memberships, invites, comments, checkpoints, update rows, receipts, presence, or CRDT history.

Do not add relational node/edge arrays or put board access metadata into Y.Doc.

### 2.8 Frontend architecture

Extend the completed Phase 2 structure rather than introducing a parallel application shell:

```text
apps/web/src/
  app/
    routes/                    landing, boards, route errors and protection
    providers/                 query and authenticated-session composition
    components/               shared application chrome
  features/
    auth/                      sign-in, sign-out, current-user state
    boards/                    list, cards, filters, lifecycle dialogs
    editor/                    completed local editor; no server sync in Phase 3
  platform/
    api/                       credentialed fetch, schema parsing, error mapping
    config/                    public API origin only; no secrets
```

Responsibility rules:

- TanStack Query owns current-user and board server state.
- Zustand remains editor-only ephemeral state and does not cache boards or sessions.
- TanStack Router remains the only router.
- The API client always includes credentials and validates response schemas.
- Reuse checked-in shadcn/ui primitives, Tailwind tokens, Lucide icons, and existing app components.
- Add `@tanstack/react-query` and the Better Auth browser client only in P3-10, at exact compatible
  versions. Do not add another fetch, form, router, state, or component framework.
- Frontend product behavior follows the repository's manual supported-browser evidence policy; do
  not silently introduce a second test stack.
- `/demo` keeps its local namespace and never appears as a server board.

### 2.9 Migration and dependency policy

The initial database migration and committed Better Auth SQL are historical artifacts. Do not edit
them after application. Add a forward TypeORM migration only when Phase 3 needs a new constraint,
column, or evidence-backed index. Include a complete `down` path and update entity registration.

Keep `synchronize: false` everywhere. Verify both a fresh migration and an upgrade from the completed
baseline in isolated schemas. Runtime uses the pooled URL; migrations and tests requiring
session-level semantics use the direct URL as already established.

Add dependencies only in the commit that first uses them:

- P3-09 may add the exact Nest OpenAPI dependency if the current stack lacks it.
- P3-10 may add TanStack Query and the Better Auth browser client.
- No ORM, auth library, crypto helper, query builder, or API framework may be added as an alternate
  to the selected stack.

Node's maintained crypto APIs provide UUIDs, random bytes, SHA-256, and timing-safe comparison where
needed. Do not add a package for those operations.

### 2.10 No magic values or duplicate contracts

- Board title, description, page, owned-board, graph-size, invite-lifetime, and idempotency-lifetime
  limits live in focused shared constants.
- Database lock order, operation names, cursor version, hash algorithm, and invite byte count use
  named server constants.
- Frontend query keys, route paths, retry policy, and stale timing use focused modules.
- Tests use named fixture sizes, deterministic clocks, and barriers.
- UI option lists derive from shared role schemas.

Do not redefine roles, errors, request limits, response shapes, or route strings independently in
controllers and components.

### 2.11 Phase boundary

Phase 3 edits shared REST contracts, API auth/board/database modules, the web auth/dashboard surface,
root verification tooling, and Phase 3 documentation. It may make a focused change to the durable
update harness so that it consumes the shared permission service.

It does not implement production rooms, editor synchronization, presence, PWA/offline account
caches, comment UI, finished sharing UI, presentation, checkpoints, imports, image export, all
templates, deployment, or backups. The invitation APIs are included; the finished invite page and
share dialog remain Phase 6. The dashboard creates blank boards; Phase 7 completes template product
flows.

## 3. Single-branch execution contract

Each task below is one sequential commit on `phase-3-identity-boards`. The same agent may implement
the whole phase. If responsibility changes, the next agent continues from current branch HEAD.

Before P3-01, the implementing agent must:

1. Read `plan.md`, `phase3.md`, this guide, `apps/web/AGENTS.md`, both completed phase audits, and
   repository-level instructions.
2. Inspect branch, HEAD, status, recent history, manifests, migrations, and current module layout.
3. Record the approved Phase 2 completion commit.
4. Ensure `phase3.md` and this guide are committed or included in an approved planning commit.
5. Create or switch to `phase-3-identity-boards` without overwriting a branch or user work.
6. Run lightweight baseline checks and record pre-existing failures before editing.
7. Confirm the required local PostgreSQL configuration is available without printing it.

Before each planned commit, the agent must:

1. Confirm the prior planned commit or focused fix is current HEAD.
2. Confirm the working tree contains no unexplained changes.
3. Read dependency evidence and the task's existing owned files.
4. State the P3 task and its non-goals.
5. Recheck the named `phase3.md` sections.

While working, the agent must:

- Stay within owned paths except for listed integration files.
- Preserve unrelated work and avoid drive-by refactors or formatting.
- Reuse shared schemas, errors, database entities, configuration, and fixture builders.
- Test observable behavior, transaction rollback, and denied behavior.
- Use actual Better Auth cookies for authenticated integration tests.
- Use isolated real PostgreSQL schemas for migration, transaction, concurrency, and query evidence.
- Use supported-browser production-build evidence for frontend behavior.
- Keep the branch buildable with no intentionally failing placeholder tests.
- Record exact commands in `docs/evidence/phase3/P3-xx.md`.
- Label mocked, skipped, credential-dependent, browser-specific, and unrun checks honestly.

Before each commit, the agent must:

1. Review the entire diff and remove unrelated changes.
2. Run every task-specific check.
3. Run `pnpm lint` and `pnpm typecheck` unless a documented task dependency temporarily prevents
   it.
4. Run broader regressions when contracts, migrations, auth mounting, the durable update harness,
   manifests, root scripts, or frontend providers changed.
5. Update evidence with actual results, limitations, and next task.
6. Commit with the exact subject in this guide.
7. Report the commit and parent hashes without amending solely to add a self-hash.

The agent must never:

- Create per-task branches or parallel commit histories.
- Rewrite, squash, amend, or rebase completed Phase 3 commits without user direction.
- Reset or discard unrecognized changes.
- Run destructive database cleanup against a shared or production schema.
- Commit `.env`, credentials, cookies, OAuth codes, raw invite URLs, token hashes, database URLs,
  browser profiles, private user data, or build output.
- Replace real database or authenticated HTTP proofs with mocks and call the gate passed.
- Weaken earlier phase tests, schema validation, permission errors, or transaction rules.
- Claim live collaboration, cloud-saved graph editing, offline authenticated access, complete
  sharing UX, or release readiness.

## 4. Branch and commit policy

The planned history is linear:

```text
approved Phase 2 baseline
  -> P3-01
  -> P3-02
  -> P3-03
  -> P3-04
  -> P3-05
  -> P3-06
  -> P3-07
  -> P3-08
  -> P3-09
  -> P3-10
  -> P3-11
  -> P3-12
  -> focused fixes, if any
  -> P3-13
```

Commit rules:

- One P3 task equals one planned commit.
- Use the exact Conventional Commit subject listed below.
- A migration, lockfile update, or generated OpenAPI artifact belongs to the task that needs it.
- Task evidence belongs in the same commit as the behavior it records.
- Fix a defect found before a task lands inside that task.
- A defect found after its planned commit lands gets a focused `fix(...)` commit where discovered.
- P3-13 is audit/documentation only; functional fixes land before it.
- Do not merge intermediate `main` changes without user direction. If the baseline changes, record
  conflicts and rerun all affected checks.

## 5. Canonical repository commands

Preserve completed Phase 1 and Phase 2 commands. Add stable Phase 3 interfaces without renaming the
existing ones.

| Command                              | Purpose                                                  |
| ------------------------------------ | -------------------------------------------------------- |
| `pnpm install --frozen-lockfile`     | Reproduce the pinned dependency graph                    |
| `pnpm format:check`                  | Check formatting without modifying files                 |
| `pnpm lint`                          | Run lint and package-boundary rules                      |
| `pnpm typecheck`                     | Run strict TypeScript checks                             |
| `pnpm test`                          | Run workspace units and earlier regressions              |
| `pnpm test:browser`                  | Preserve browser-backed package checks                   |
| `pnpm test:integration`              | Run real PostgreSQL/API integration tests                |
| `pnpm auth:schema:check`             | Compare pinned Better Auth generated SQL                 |
| `pnpm db:migration:show`             | Show committed migration state through the direct source |
| `pnpm --filter @archboard/api build` | Build the ESM API independently                          |
| `pnpm --filter @archboard/web build` | Build the Vite web app independently                     |
| `pnpm build`                         | Build all applications and packages                      |
| `pnpm boundary:check`                | Enforce package/application import boundaries            |
| `pnpm phase1:verify`                 | Re-run Phase 1 compatibility and durability gates        |
| `pnpm phase2:verify`                 | Re-run the completed local-editor gate                   |
| `pnpm phase3:verify`                 | Run the final Phase 3 aggregate gate                     |

P3-12 completes `phase3:verify`. It must invoke real checks and propagate failures; a placeholder
successful script is forbidden. Database scripts use isolated schemas and must not print URLs.
Browser evidence starts and stops preview processes deterministically.

## 6. Commit plan

### P3-01 — Add identity and board REST contracts

Commit subject:

```text
feat(contracts): add identity and board lifecycle schemas
```

Depends on: approved Phase 2 baseline and committed Phase 3 planning documents.

Read first:

- `phase3.md` sections 3–5, 8–10, 13, and 15.1–15.2.
- Existing contract graph, protocol, error, role, and limit modules.
- Existing API entities so wire types do not mirror TypeORM classes.

Owned paths:

- `packages/contracts/src/auth/**`.
- `packages/contracts/src/boards/**`.
- `packages/contracts/src/http/**` or equivalently focused REST modules.
- Shared errors, limits, exports, and tests.
- `docs/evidence/phase3/P3-01.md`.

Required work:

- Add safe current-user and user-summary schemas.
- Add board summary/detail, metadata version, effective role, member count, list query/cursor, create,
  patch, archive/restore, and duplicate schemas.
- Add member and invitation metadata, preview, acceptance, and one-time URL response schemas.
- Model `inviteUrl` and `inviteUrlAvailable` so replays can be redacted.
- Add the standard object/collection/error envelopes and all Phase 3 error codes.
- Add strict UUID idempotency-key parsing as a transport helper without putting the header in body
  DTOs.
- Centralize title, description, pagination, active-board, invite, and idempotency limits.
- Add tests for unknown keys, malformed UUIDs/cursors/timestamps/sequences, boundaries, enums,
  redacted invite results, and safe errors.

Non-goals:

- No Nest decorators, TypeORM, database queries, routes, React components, or provider setup.
- No comment, checkpoint, import/export, room, or template contracts beyond existing final-plan
  types.

Required checks:

```text
pnpm --filter @archboard/contracts test
pnpm --filter @archboard/contracts typecheck
pnpm --filter @archboard/contracts build
pnpm lint
pnpm typecheck
pnpm test
```

Completion evidence:

- Every Phase 3 wire shape has one exported strict schema and inferred type.
- Bigint-like sequences reject JavaScript numbers.
- Better Auth user IDs remain opaque strings while application IDs remain UUIDs.
- Existing graph/protocol contracts and tests remain unchanged in meaning.

### P3-02 — Productize GitHub identity and current-user behavior

Commit subject:

```text
feat(auth): add github identity and current user
```

Depends on: P3-01.

Read first:

- `phase3.md` sections 5, 6, 10.1, 12, and 15.5.
- Current auth runtime, HTTP mounting, session lookup, API config, and Phase 1 auth evidence.

Owned paths:

- `apps/api/src/modules/auth/**`.
- `apps/api/src/platform/config/**` and focused config tests.
- Current-user controller/application code.
- Auth-related `apps/api` integration tests.
- Example environment documentation without values.
- `docs/evidence/phase3/P3-02.md`.

Required work:

- Add validated backend-only GitHub client ID/secret settings and provider configuration.
- Request identity scopes only and preserve trusted origins/base URL/cookie behavior.
- Keep email/password enabled only in test mode.
- Expand the public session boundary enough to return trusted safe current-user data.
- Implement authenticated `GET /api/v1/me` using the shared envelope/schema.
- Add a reusable request actor boundary for later controllers without accepting actor headers.
- Map missing/expired sessions to the standard 401 envelope with request ID.
- Test real handler cookies, `/me`, sign-out/expiry behavior, untrusted origins, and production config
  rejection without logging credentials.

Non-goals:

- No board services, dashboard, custom OAuth protocol, bearer token, localStorage session, or
  production OAuth application creation.
- A test-only email/password session does not count as the final real GitHub browser proof.

Required checks:

```text
pnpm --filter @archboard/api test -- auth config
pnpm --filter @archboard/api test:integration -- auth
pnpm auth:schema:check
pnpm --filter @archboard/api typecheck
pnpm --filter @archboard/api build
pnpm lint
pnpm typecheck
```

Completion evidence:

- Actual Better Auth cookies authenticate `/me`; synthetic actor headers do not.
- Production configuration fails closed when GitHub settings are absent or malformed.
- Responses contain safe user fields only.
- Existing HTTP and WebSocket auth compatibility tests remain green.

### P3-03 — Add board persistence and transaction primitives

Commit subject:

```text
feat(api): add board persistence primitives
```

Depends on: P3-01.

Read first:

- `phase3.md` sections 5, 8.1, 11, 13, and 15.3–15.5.
- Initial migration, board entities, database module/options, and real-PostgreSQL harness patterns.

Owned paths:

- `apps/api/src/modules/boards/infrastructure/**`.
- Boards transaction/repository interfaces under application/domain boundaries.
- Initial snapshot and idempotency services.
- Forward migration and entity registration only if evidence requires schema changes.
- Real-PostgreSQL tests and `docs/evidence/phase3/P3-03.md`.

Required work:

- Add explicit repositories for boards, members, invites, idempotency, and committed graph loading.
- Add a transaction helper that locks board rows and returns typed authority/state data.
- Add canonical request hashing and 24-hour idempotency behavior, including concurrent same-key
  handling and different-payload conflict.
- Add a validated empty schema-version-1 Y.Doc snapshot factory with exact byte length.
- Add a user-row lock and active-owned-board count primitive.
- Use database time and preserve bigint strings.
- Analyze indexes for planned accessible-board ordering and add only justified forward migrations.
- Prove fresh migration, upgrade migration, rollback, and `synchronize: false`.

Non-goals:

- No board HTTP endpoints, permission decisions, invitations, dashboard, or production room.
- Do not edit the initial migration or auth SQL.

Required checks:

```text
pnpm --filter @archboard/api test -- database boards
pnpm --filter @archboard/api test:integration -- database boards idempotency
pnpm auth:schema:check
pnpm db:migration:show
pnpm --filter @archboard/api build
pnpm lint
pnpm typecheck
```

Completion evidence:

- Empty document bytes decode and pass document-model validation.
- Effect and replay-safe idempotency response commit or roll back together.
- Independent identical/different request races produce the required one-effect outcomes.
- Fresh and upgrade schemas match registered entities with no synchronization.

### P3-04 — Centralize board authorization

Commit subject:

```text
feat(api): centralize board authorization
```

Depends on: P3-02 and P3-03.

Read first:

- `phase3.md` sections 5, 7, 11.1, and 15.2–15.3.
- Current durable-update authority query and its PostgreSQL integration tests.

Owned paths:

- `apps/api/src/modules/boards/application/permissions/**`.
- Boards module public application exports.
- Focused durable-update harness integration needed to consume the service.
- Permission unit/integration tests.
- `docs/evidence/phase3/P3-04.md`.

Required work:

- Resolve owner/editor/viewer/no-access from board owner plus membership.
- Expose explicit read, metadata-write, graph-write, and manage-access operations.
- Encode archived-board overrides and inaccessible-board 404 behavior centrally.
- Support ordinary read checks and transaction-scoped locked checks.
- Replace the durable-update harness's copied role/archive SQL with the shared permission service.
- Test the complete role/archive matrix and unchanged accepted state after denial.
- Keep the public service independent of HTTP exception classes; translate at the transport edge.

Non-goals:

- No new board routes, socket rooms, role-change UI, or revocation notifications.
- Do not weaken commit-before-ACK, receipt, causal validation, or Phase 1 error behavior.

Required checks:

```text
pnpm --filter @archboard/api test -- permissions durable-update
pnpm --filter @archboard/api test:integration -- permissions durable-update
pnpm --filter @archboard/api build
pnpm lint
pnpm typecheck
pnpm phase1:verify
```

Completion evidence:

- There is one role/archive decision source for REST and durable graph persistence.
- Viewer/nonmember/archive denials leave sequence, updates, receipts, and accepted bytes unchanged.
- Nonmember reads can map to 404 without leaking board existence.
- Phase 1 durable-update and retry tests still pass.

### P3-05 — Add board creation and metadata APIs

Commit subject:

```text
feat(api): add board metadata lifecycle
```

Depends on: P3-03 and P3-04.

Read first:

- `phase3.md` sections 8.1–8.3, 10.1, 11, 13, and 15.
- Shared board contracts and board persistence/permission evidence.

Owned paths:

- Board application services for create/list/read/update.
- Board controller routes for the owned slice.
- Board query/cursor logic and tests.
- Module wiring and authenticated HTTP integration tests.
- `docs/evidence/phase3/P3-05.md`.

Required work:

- Create a blank private board, initial snapshot, and idempotency result atomically.
- Enforce title/description rules and the 100-active-owned-board limit under concurrent create.
- List owned and joined boards without duplicates using title search, archive filter, stable
  `(content_updated_at, id)` ordering, and strict opaque cursor.
- Return safe summary/detail responses with effective role, latest sequence string, and member count.
- Update title/description with owner/editor authorization and expected metadata version.
- Return 409 on stale versions without partial changes; do not increment for a no-op.
- Ensure metadata edits never advance graph sequence.
- Exercise every route with actual Better Auth cookies and shared schema parsing.

Non-goals:

- No template board creation, archive/restore, duplicate, member mutation, invite, or synchronized
  editor route.

Required checks:

```text
pnpm --filter @archboard/api test -- boards
pnpm --filter @archboard/api test:integration -- boards auth
pnpm --filter @archboard/contracts test
pnpm --filter @archboard/api build
pnpm lint
pnpm typecheck
```

Completion evidence:

- Create rollback cannot leave a board without a snapshot or idempotency record.
- Limit races create no more than 100 active owned boards.
- Pagination is stable when timestamps tie and never leaks inaccessible records.
- Owner/editor/viewer/nonmember metadata behavior and version conflicts match contracts.

### P3-06 — Add archive, restore, and committed-state duplicate

Commit subject:

```text
feat(api): add board archive restore and duplicate
```

Depends on: P3-05.

Read first:

- `phase3.md` sections 7.3, 8.4–8.5, 11, and A27 requirements.
- Document-model projection/hydration/validation and current snapshot/update entities.

Owned paths:

- Board archive/restore/duplicate application services and routes.
- Committed-document loader and production fresh-ID projection remapper.
- Focused document-model helper/tests if a framework-independent remap belongs there.
- A27 database harness and duplicate integration tests.
- `docs/evidence/phase3/P3-06.md`.

Required work:

- Add versioned owner-only archive and restore with defined no-op behavior.
- Serialize archive with durable graph acceptance through the same locked board row.
- Reconstruct committed source from snapshot plus ordered updates through locked `latest_seq`.
- Validate, project, create one mapping for every entity, remap references, and hydrate a new Y.Doc.
- Atomically create the caller-owned duplicate, sequence-zero snapshot, and idempotency result.
- Enforce the active-owned-board limit and caller-user-before-source-board lock order.
- Exclude source members, invites, comments, checkpoints, updates, receipts, and history.
- Prove fresh IDs, reference integrity, source immutability, and rollback on invalid source content.

Non-goals:

- No local pending-edit duplication, general import/export, complete template flow, checkpoint restore,
  or production collaboration room.

Required checks:

```text
pnpm --filter @archboard/document-model test -- projection validation
pnpm --filter @archboard/api test -- boards duplicate
pnpm --filter @archboard/api test:integration -- archive duplicate durable-update
pnpm --filter @archboard/api build
pnpm lint
pnpm typecheck
```

Completion evidence:

- Both A27 transaction orders pass on independent connections.
- A rejected post-archive write changes no sequence/update/receipt/accepted state.
- Duplicate graph IDs and all references are fresh and valid.
- Duplicate is private, starts at sequence zero, and carries no access/history records.

### P3-07 — Add board membership lifecycle

Commit subject:

```text
feat(api): add board membership lifecycle
```

Depends on: P3-04 and P3-05.

Read first:

- `phase3.md` sections 7, 9.1, 10.1, and 15.2–15.3.
- Shared member contracts and user-summary behavior.

Owned paths:

- Membership application services, repository queries, and routes.
- Safe member/owner user-summary mapping.
- Membership HTTP and database integration tests.
- `docs/evidence/phase3/P3-07.md`.

Required work:

- List owner plus members for every reader without exposing provider data or member email.
- Allow owner-only editor/viewer changes for an existing nonowner member.
- Allow owners to remove another member and nonowners to remove themselves.
- Reject owner demotion, owner removal, owner self-leave, editor management, archived mutation, and
  cross-board target use.
- Lock the board and recheck authority in each mutation transaction.
- Make removal of an already absent target safe only after caller authority and board scope are
  established.
- Test role changes racing graph writes or removals with deterministic ordering.

Non-goals:

- No membership added directly by arbitrary user ID, ownership transfer, invite UI, socket
  disconnection, or offline edit-preservation flow.

Required checks:

```text
pnpm --filter @archboard/api test -- members permissions
pnpm --filter @archboard/api test:integration -- members permissions
pnpm --filter @archboard/contracts test
pnpm --filter @archboard/api build
pnpm lint
pnpm typecheck
```

Completion evidence:

- Full role matrix passes through authenticated HTTP.
- Owner is never represented or mutated as a member row.
- Cross-board and nonmember probes return the required no-disclosure responses.
- Removal/write ordering follows database commit order.

### P3-08 — Add secure single-use invitations

Commit subject:

```text
feat(api): add secure board invitations
```

Depends on: P3-03, P3-04, and P3-07.

Read first:

- `phase3.md` architecture rules 12–13; sections 9.2–9.3, 10.1, 11.3, and 12; and A19.
- Invite/idempotency entities and crypto/logging boundaries.

Owned paths:

- Invitation application services, repository queries, crypto adapter, and routes.
- Invite-list cursor handling and safe status mapping.
- Real-PostgreSQL concurrency/failure tests.
- Token/log security-negative tests.
- `docs/evidence/phase3/P3-08.md`.

Required work:

- Create seven-day editor/viewer invites for active boards with 32 random bytes and SHA-256 storage.
- Return the URL once and store only the redacted idempotency response.
- List safe invite metadata and revoke active invites without deleting audit rows.
- Preview only board title, inviter name, role, and expiry for signed-in users.
- Treat malformed/missing/revoked tokens uniformly as unavailable; distinguish expired/exhausted.
- Accept under board-then-invite locks; create/upgrade/retain membership as specified.
- Record owner acceptance without an owner membership row.
- Return success for recorded-user retry and exhaustion for a different user.
- Make archived invite listing/mutation/acceptance fail until restore.
- Capture logs in tests and prove secrets, digests, request bodies, and token-bearing URLs are absent.

Non-goals:

- No email delivery, invite page/share dialog, anonymous preview, multi-use invite, token recovery,
  or invitation analytics.

Required checks:

```text
pnpm --filter @archboard/api test -- invites idempotency logging
pnpm --filter @archboard/api test:integration -- invites concurrency
pnpm --filter @archboard/contracts test
pnpm --filter @archboard/api build
pnpm lint
pnpm typecheck
```

Completion evidence:

- A19 has exactly one winner on independent connections and stable same-user replay.
- Raw token appears only in the original authorized response.
- Database and captured logs contain no raw token; stored idempotency response is redacted.
- Expiry, revocation, role upgrade/non-demotion, owner no-op, archive, and rollback cases pass.

### P3-09 — Complete the Phase 3 REST boundary

Commit subject:

```text
feat(api): complete phase 3 rest boundary
```

Depends on: P3-05 through P3-08.

Read first:

- `phase3.md` sections 10.1, 11, 12, and 15.1–15.2.
- Every Phase 3 API route and current Nest application composition.

Owned paths:

- API module composition, validation pipes/interceptors/filters, request IDs, safe logging.
- OpenAPI setup and checked contract assertions.
- `/health/live` and `/health/ready` implementation.
- API package dependency/lockfile updates required by documented OpenAPI.
- Cross-route Supertest suites and `docs/evidence/phase3/P3-09.md`.

Required work:

- Standardize shared schema parsing for body/query/path/header and response serialization.
- Standardize error mapping and request IDs without leaking internals or board existence.
- Register all Phase 3 controllers under `/api/v1` while leaving `/api/auth/*` owned by Better Auth.
- Generate exact OpenAPI for success/error/security behavior and assert key paths/schemas.
- Add process liveness and database/schema-aware readiness.
- Apply bounded JSON/query handling before application work.
- Add safe structured logging fields and redaction tests.
- Scan browser build inputs and API responses for secret names/values.

Non-goals:

- No production rate tuning, distributed tracing, large observability stack, room endpoints, or
  deployment proxy configuration.

Required checks:

```text
pnpm --filter @archboard/api test
pnpm --filter @archboard/api test:integration
pnpm auth:schema:check
pnpm db:migration:show
pnpm --filter @archboard/api build
pnpm lint
pnpm typecheck
pnpm boundary:check
```

Completion evidence:

- Every Phase 3 route returns only documented envelopes/status codes.
- OpenAPI and shared schemas agree for representative valid and error responses.
- Readiness fails when database/schema prerequisites fail; liveness remains process-only.
- Logs omit protected content and token-bearing route values.

### P3-10 — Add authenticated frontend session flow

Commit subject:

```text
feat(web): add authenticated session flow
```

Depends on: P3-02 and P3-09.

Read first:

- `phase3.md` sections 6, 10.2–10.3, 12, and 15.4–15.5.
- `apps/web/AGENTS.md`, existing router/home/theme components, and web config.

Owned paths:

- Exact `apps/web` auth/query dependencies and lockfile.
- `apps/web/src/platform/api/**`.
- `apps/web/src/features/auth/**`.
- Query/auth providers and protected route composition.
- Landing/current-user/sign-out changes and `docs/evidence/phase3/P3-10.md`.

Required work:

- Add exact compatible TanStack Query and Better Auth client dependencies.
- Build a credentialed typed API client with response parsing, error mapping, abort support, and no
  secret settings.
- Resolve `/me` before deciding signed-in, signed-out, or network-error state.
- Add GitHub sign-in, authenticated `/` redirect, protected-route redirect, safe return path, and
  sign-out cache clearing.
- Distinguish 401 from retryable network/server failure.
- Avoid signed-out-content flash while the initial session is unresolved.
- Preserve local demo navigation/storage across sign-in and sign-out.
- Use existing primitives, theme tokens, router, and accessible focus/error patterns.

Non-goals:

- No board dashboard yet, auth token persistence, password UI, invite page, server editor, or new UI
  framework.

Required checks:

```text
pnpm install --frozen-lockfile
pnpm --filter @archboard/web typecheck
pnpm --filter @archboard/web build
pnpm lint
pnpm typecheck
pnpm boundary:check
```

Completion evidence:

- Production build has signed-out, resolving, authenticated, failed, and signed-out-again states.
- Real GitHub callback evidence is recorded when credentials are available; test auth is labeled.
- Session cookies are never read or stored by application JavaScript.
- `/demo` remains functional and local-only after auth transitions.

### P3-11 — Add the authenticated board dashboard

Commit subject:

```text
feat(web): add authenticated board dashboard
```

Depends on: P3-05, P3-06, and P3-10.

Read first:

- `phase3.md` sections 8, 10.2–10.3, 12, and 15.4.
- Current app shell/UI primitives and all board response contracts.

Owned paths:

- `apps/web/src/features/boards/**`.
- `/boards` route and shared authenticated app chrome.
- Additional shadcn primitives only when required and added at the recorded exact CLI version.
- Manual production-browser evidence in `docs/evidence/phase3/P3-11.md`.

Required work:

- Render current user, sign-out, title search, active/archive filter, stable pages, and role/archive
  states through TanStack Query.
- Cover initial loading, empty active, empty search, retryable error, network unavailable, and
  expired session.
- Add blank create with title/default/description and one intent-scoped idempotency key.
- Add role-appropriate rename/description, archive, restore, and committed-state duplicate dialogs.
- Handle 409 version conflict by refreshing authoritative metadata and explaining the conflict.
- Cancel stale searches and prevent late responses from replacing newer queries.
- Use narrow query invalidation/update; do not mirror board arrays in Zustand.
- Preserve focus, labels, dialog descriptions, keyboard operation, live announcements, and
  narrow-screen board management.
- Do not render unfinished share or collaborative editing controls.

Non-goals:

- No member/invite UI, comments, local-server board merge, authenticated editor, PWA cache, or
  optimistic behavior that cannot roll back.

Required checks:

```text
pnpm --filter @archboard/web typecheck
pnpm --filter @archboard/web build
pnpm lint
pnpm typecheck
pnpm boundary:check
```

Completion evidence:

- Supported-browser evidence covers every required dashboard state and lifecycle action.
- Owner/editor/viewer controls match effective role, while forged HTTP denial remains server-side.
- Search cancellation and version-conflict recovery show authoritative data.
- Keyboard/focus/narrow-screen results are recorded; `/demo` remains isolated.

### P3-12 — Verify authorization, concurrency, and phase gates

Commit subject:

```text
test(api): verify identity and board lifecycle gates
```

Depends on: P3-06 through P3-11.

Read first:

- `phase3.md` sections 13, 15, 16, and 18.
- All P3-01 through P3-11 evidence and known gaps.

Owned paths:

- A11 Phase 3, A19, A27, idempotency, migration, query-plan, and rollback harnesses.
- Root `phase3:verify` orchestration and bundle/secret scans.
- Supported-browser auth/dashboard evidence.
- Small direct fixes exposed by verification; substantial fixes use focused commits.
- `docs/evidence/phase3/P3-12.md`.

Required work:

- Prove A11 viewer graph-write rejection and cross-board/no-membership non-disclosure through actual
  authenticated boundaries.
- Prove A19 with two signed-in users and independent connections, then same-user retry.
- Prove both A27 commit orders with deterministic barriers and unchanged rejected state.
- Test active-board and idempotency concurrency limits, transaction failpoints, stable pagination,
  role/remove races, and all invitation states.
- Capture representative accessible-board/member/invite/idempotency `EXPLAIN` plans and timings.
- Record real GitHub and production-build dashboard evidence or exact credential blocker.
- Perform keyboard/focus/narrow-screen checks and token/log/browser-bundle security scans.
- Build `phase3:verify` from formatting, lint, types, units, real integration, migrations/auth schema,
  independent builds, boundaries, and secret scans.
- Rerun Phase 1 and Phase 2 regression gates.

Non-goals:

- No production room A11 transport claim, Phase 5 offline tests, Phase 6 share UI, load-test tuning,
  deployment, or relaxation of failed targets.

Required checks:

```text
pnpm install --frozen-lockfile
pnpm phase3:verify
pnpm phase1:verify
pnpm phase2:verify
pnpm --filter @archboard/api test:integration
pnpm --filter @archboard/api build
pnpm --filter @archboard/web build
pnpm build
```

Completion evidence:

- A11 Phase 3, A19, and A27 are reproducible and use real sessions/database connections.
- Query evidence uses representative rows and identifies any required migration-backed index.
- Aggregate command names every child and propagates failure.
- Browser and credential-dependent results are PASS/FAIL/UNRUN without substitution by mocks.
- Earlier phase gates remain intact.

### P3-13 — Audit and close Phase 3

Commit subject:

```text
docs(phase3): record identity and board evidence and exit status
```

Depends on: P3-01 through P3-12 and every focused Phase 3 fix.

Read first:

- Complete `phase3.md` deliverables and exit gate.
- Every Phase 3 evidence file.
- Current README, manifests, migrations, lockfile, OpenAPI, and git history from the Phase 2 base.

Owned paths:

- `docs/phase-3-identity-boards.md`.
- `docs/evidence/phase3/README.md` and evidence metadata/hash corrections.
- README Phase 3 commands/status.
- Planning docs only for an approved evidence-backed amendment.

Required work:

- Record branch base, planned/fix history, runtime/database/browser matrix, and dependency additions.
- Link every task, deliverable, and exit criterion to tests, transaction proof, browser evidence,
  build, query plan, or explicit blocker.
- Record exact clean-tree commands, counts, migration status, and OpenAPI/schema checks.
- Confirm GitHub/session behavior, board lifecycle, central permissions, memberships, invitation
  secrecy, idempotency, and frontend states.
- Confirm A11 Phase 3, A19, and A27 evidence arrangements.
- Confirm no secrets or private data entered evidence or browser bundles.
- Distinguish durable board metadata from server-backed collaborative graph editing.
- Mark Phase 3 passed only if every mandatory gate is satisfied.

Non-goals:

- No functional code, dependency upgrades, refactors, test weakening, merge, remote push,
  deployment, or version 1 claim.

Required checks:

```text
pnpm install --frozen-lockfile
pnpm phase3:verify
pnpm phase1:verify
pnpm phase2:verify
pnpm auth:schema:check
pnpm db:migration:show
pnpm --filter @archboard/api build
pnpm --filter @archboard/web build
pnpm build
git status --short
```

Completion evidence:

- Final audit contains a pass/block decision with no unsupported claim.
- Every exit-gate row has a direct evidence link or reproducible blocker.
- History and working tree contain no unexplained generated or secret files.
- Any unrun provider/browser/environment check names the exact missing prerequisite.

## 7. Sequential execution order

| Sequence | Commit | Why it is next                                                            |
| -------- | ------ | ------------------------------------------------------------------------- |
| 1        | P3-01  | Establishes the wire contracts and limits every later layer consumes      |
| 2        | P3-02  | Productizes the proven auth runtime before protected features exist       |
| 3        | P3-03  | Establishes transaction, snapshot, repository, and idempotency primitives |
| 4        | P3-04  | Centralizes permissions before any board mutation endpoint expands        |
| 5        | P3-05  | Adds the basic board metadata lifecycle on stable auth and persistence    |
| 6        | P3-06  | Adds serialized archive/restore and content-aware duplication             |
| 7        | P3-07  | Adds member behavior on the shared access boundary                        |
| 8        | P3-08  | Adds invitations after membership and lock rules are stable               |
| 9        | P3-09  | Completes cross-cutting REST, errors, docs, logs, and readiness           |
| 10       | P3-10  | Adds browser authentication against the complete API boundary             |
| 11       | P3-11  | Adds dashboard behavior on stable board APIs and session state            |
| 12       | P3-12  | Verifies concurrency, authorization, browser, query, and regression gates |
| 13       | P3-13  | Audits already-correct committed work and closes the phase                |

There are no parallel waves. Dependency rows in `phase3.md` describe architecture, not permission
to create multiple histories. Notes may be prepared early, but later-task code does not land in an
earlier commit.

After a focused fix, rerun targeted checks and every downstream gate that could observe the changed
contract. Record the fix at the point discovered without reordering history.

## 8. Required evidence format

Every planned commit adds `docs/evidence/phase3/P3-xx.md` with:

```text
# P3-xx — <title>

Planned commit subject: <exact subject from this guide>
Commit: <filled in the final Phase 3 evidence index; do not amend solely for self-hash>
Parent: <actual parent hash before implementation>
Branch: phase-3-identity-boards
Environment: <OS, Node.js, pnpm, PostgreSQL, browser/build mode when relevant>

## Behavior proved
<observable result>

## Contracts used
<DTOs, roles, errors, limits, lock order, and invariants>

## Changed scope
<owned files/modules and justified integration files>

## Commands and results
- `<exact command>` — PASS/FAIL/UNRUN, duration and relevant counts

## Database evidence
<schema, migration, transaction, connections, barrier, rollback, and query plan, or not applicable>

## Authentication and security evidence
<cookie/provider/origin/token/log/isolation result, or not applicable>

## Browser evidence
<real browser, origin, build, workflow, and result, or not applicable>

## Accessibility evidence
<keyboard/focus/announcement/narrow-screen result, or not applicable>

## Known gaps
<remaining issue, consequence, and owner, or none>

## Next commit unlocked
<P3 task ID>
```

`docs/evidence/phase3/README.md` maps planned IDs to final hashes during P3-13. Evidence never
contains cookies, credentials, OAuth codes, database URLs, raw invite URLs, token hashes, user email
addresses, private names, full environments, or production data. Use deterministic synthetic users
and boards. Screenshots are optional corroboration and must be sanitized.

## 9. Fix commit policy

When a defect is found after its planned commit, add a focused fix commit on the same branch before
continuing.

Subject format:

```text
fix(<scope>): <specific violated invariant>
```

A fix evidence file records:

- The planned commit that introduced or exposed the defect.
- The failing test or reproducible behavior.
- The smallest correction and why it preserves contracts.
- Targeted and downstream checks rerun.
- Effects on migration, OpenAPI, browser, concurrency, or prior evidence.

Examples:

```text
fix(auth): preserve all better auth response cookies
fix(boards): lock owner limit before duplicate creation
fix(invites): redact token from idempotency replay
fix(api): hide cross-board member targets
```

Do not use broad subjects such as `fix bugs` or amend/squash earlier planned commits. If a finding
changes approved scope or architecture, document the failed contract and request an amendment.

## 10. Phase 3 final gate

The `phase-3-identity-boards` branch is ready to close only when:

- P3-01 through P3-13 exist in order with focused fixes recorded.
- The lockfile reproduces a clean install.
- Formatting, lint, strict types, unit, real integration, auth schema, migrations, boundaries,
  independent builds, and aggregate gates pass.
- Phase 1 and Phase 2 regressions remain valid.
- Real GitHub sign-in, safe `/me`, protected navigation, expiry, and sign-out are evidenced.
- The actor always comes from the Better Auth session and secrets remain backend-only.
- Blank board creation atomically commits owner, validated snapshot, and idempotency result.
- Board list/search/archive pagination returns only accessible records deterministically.
- Metadata versions, archive/restore, and committed-state duplicate match their contracts.
- Duplicate graph IDs are fresh and source access/history records are absent.
- One permission service enforces REST and durable graph writes inside transactions.
- Owner/member invariants and cross-board no-disclosure behavior pass.
- Invite entropy, hash-only storage, one-time URL, redacted replay, expiry, revocation, and acceptance
  rules pass.
- A11 Phase 3, A19, and A27 pass with actual sessions and real independent database connections.
- Dashboard states and lifecycle actions pass in the supported production-build browser with
  keyboard/focus evidence.
- `/demo` remains isolated and no UI claims authenticated graph collaboration or server save.
- Query-plan evidence uses representative data and any needed index is migration-backed.
- The final audit distinguishes Phase 3 metadata/access durability from Phase 4 collaboration and
  makes no offline, sharing-UX, deployment, or release claim.

If a required real provider, browser, or database proof is missing, mocked, or failing, Phase 3
remains open. P3-13 records the blocker and does not redefine the gate.

## 11. Agent handoff response

After each planned or focused commit, respond with:

```text
Task: <P3-xx — title, or focused fix>
Branch: phase-3-identity-boards
Hash: <commit hash>
Parent: <parent hash>
Changed: <files/modules>
Proved: <observable behavior>
Checks: <exact commands and PASS/FAIL/UNRUN results>
Database evidence: <connections/transactions/migration result, or not applicable>
Auth/browser evidence: <provider/cookie/browser result, or not applicable>
Evidence: <path>
Risks: <known gaps or none>
Next: <next sequential P3 task>
```

The response describes committed state. A new agent verifies the named hash is current HEAD and
continues on the same branch.

## 12. Technical references

- `plan.md` sections 4.1, 5–8, 11–13, 15–18, and milestone M03.
- `phase3.md` — complete identity and board lifecycle contract and exit gate.
- `docs/phase-1-compatibility.md` — pinned auth/database compatibility and real integration baseline.
- `docs/phase-2-editor.md` — completed local editor, route shell, and `/demo` boundaries.
- `apps/web/AGENTS.md` — binding frontend structure, component, styling, and accessibility rules.
- `apps/api/src/platform/database/auth-schema.sql` — pinned Better Auth-generated relational schema.
- Better Auth Express integration reference linked from `plan.md` — handler order and Node adapter.
- PostgreSQL row locking and transaction behavior — authoritative basis for A19/A27 ordering.

Library references establish capabilities. Archboard's role matrix, no-disclosure policy, lock
order, snapshot initialization, idempotency semantics, invitation secrecy, task order, evidence
requirements, and exit gate remain project-specific requirements defined by `plan.md`, `phase3.md`,
and this guide.
