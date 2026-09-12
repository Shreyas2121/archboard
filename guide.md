# Archboard Phase 1 — Commit-by-Commit Implementation Guide

Version: 1.0<br>
Date: 12 September 2026<br>
Status: Implementation guide<br>
Governing documents: `plan.md` and `phase1.md`

## 1. Purpose

This guide turns Phase 1 into a sequence of small, reviewable commits that an AI coding agent can implement without guessing the architecture or absorbing work from later phases.

`plan.md` remains the product and architecture authority. `phase1.md` defines the Phase 1 scope and exit gate. This file defines the implementation order, ownership boundaries, verification required before each commit, and the handoff format between agents.

When documents disagree, use this order:

1. The user's latest written instruction.
2. `plan.md` product behavior and data invariants.
3. `phase1.md` Phase 1 scope and exit criteria.
4. This commit guide.

An agent must stop and document a conflict instead of silently choosing a different contract.

## 2. Fixed implementation decisions

### 2.1 Database provider

Use Neon PostgreSQL for shared development, preview, and hosted environments. Local automated tests may use an ephemeral standard PostgreSQL instance when they need deterministic lifecycle control. Tests must not depend on Neon-only behavior unless the behavior being tested is explicitly Neon-specific.

Use two validated connection settings:

- `DATABASE_URL`: Neon pooled connection for ordinary application queries and transactions.
- `DATABASE_DIRECT_URL`: Neon direct connection for migrations and the dedicated session that owns the PostgreSQL advisory lock.

The collaboration singleton lock is session-scoped. It must run through one dedicated direct connection that remains open for the lifetime of the process. Do not acquire it through a transaction-pooled connection.

No database credential may be committed. Commit `.env.example` with names and descriptions only.

### 2.2 ORM

Use TypeORM with `@nestjs/typeorm` and the PostgreSQL `pg` driver.

This is an intentional amendment to the Drizzle choice inherited by `plan.md` and `phase1.md`. It follows the user's latest direction. Agents implementing this guide must use TypeORM for application-owned data unless the user approves another documented amendment.

Reasons for this choice:

- Nest provides maintained TypeORM integration and feature-level repository registration.
- TypeORM exposes `DataSource`, `EntityManager`, transactions, and `QueryRunner`, which are needed for row locks, atomic receipts, migrations, and the dedicated advisory-lock session.
- Neon speaks standard PostgreSQL and works with standard PostgreSQL drivers.
- The feature-module architecture can keep entity and repository ownership local to each backend module.

Rules:

- Set `synchronize: false` in every environment.
- Commit explicit TypeORM migrations. Never use schema synchronization as a deployment mechanism.
- Use `DATABASE_DIRECT_URL` for the migration data source.
- Use the injected transactional `EntityManager` inside a transaction. Never call a global repository from inside a transaction callback.
- Use explicit SQL where PostgreSQL behavior matters, including `SELECT ... FOR UPDATE`, advisory locks, `bytea`, and receipt idempotency constraints.
- Do not wrap TypeORM in a generic repository abstraction. A feature may define a narrow repository port only when the domain or test boundary needs it.
- Better Auth uses its official built-in PostgreSQL adapter with a dedicated, size-limited `pg.Pool`; do not pass TypeORM into Better Auth and do not adopt a community TypeORM adapter.
- Better Auth and TypeORM may share the same Neon database and pooled URL, but they own separate configured pools. Pool sizes and timeouts must be named validated settings.
- Better Auth owns its authentication tables. Generate their SQL from the pinned Better Auth CLI, review it, and incorporate it into the committed migration chain before migrations that add application foreign keys to the auth user table.
- Do not model Better Auth user, session, account, or verification tables as application TypeORM entities. Application entities store the compatible user ID scalar and migrations create the required foreign keys explicitly.
- A Better Auth version change must regenerate its schema and fail a committed schema-drift check until the migration chain is deliberately updated.

### 2.3 Application architecture

Use a feature-module modular monolith. Organize code by business capability first and technical layer second.

```text
apps/
  api/src/
    app.module.ts
    main.ts
    platform/
      config/
      database/
      logging/
      health/
    modules/
      auth/
      boards/
      collaboration/
    testing/
  web/src/
    app/
    features/
      phase1-spikes/
    platform/
      config/
      browser-storage/
packages/
  contracts/src/
    graph/
    protocol/
    errors/
    limits/
    index.ts
  document-model/src/
    schema/
    commands/
    projection/
    validation/
    undo/
    index.ts
  sync-client/src/
    persistence/
    outbox/
    index.ts
  fixtures/src/
    graph/
    concurrency/
    malformed/
    limits/
    index.ts
docs/
  evidence/phase1/
```

Backend feature layout:

```text
modules/<feature>/
  <feature>.module.ts
  domain/            pure rules and feature-owned types
  application/       use cases, commands, and orchestration
  infrastructure/    TypeORM entities, repositories, gateways, adapters
  presentation/      REST controllers or WebSocket gateway
  testing/           feature-specific builders and failpoints
  index.ts            deliberately small public API
```

Not every feature needs every folder. Create a folder only when it has real code. Domain and application code must not import Nest controllers, TypeORM entities, or transport DTOs. Infrastructure may depend inward on application/domain contracts.

Cross-feature rules:

- A feature may import another feature only through its public application API.
- A controller or gateway validates transport input, calls an application use case, and maps the result. It does not contain domain or transaction logic.
- TypeORM entities stay inside the owning feature's infrastructure layer.
- Shared wire schemas belong in `packages/contracts`; feature-internal types stay with the feature.
- Yjs graph behavior belongs in `packages/document-model`, not in React components or Nest providers.
- Browser synchronization and persistence belong in `packages/sync-client`, not in Zustand or React component state.
- Avoid a general `utils`, `helpers`, or `common` dumping ground. Name modules after their responsibility.

This structure supports team ownership and later extraction if measured scaling needs justify it. Phase 1 still preserves the planned single collaboration-writer process; modular code does not remove that runtime constraint.

### 2.4 No magic numbers or strings

Numeric limits, timeouts, retry policies, rates, sizes, and stable protocol strings must have one named source.

Use these categories:

- Product limits shared by client and server: `packages/contracts/src/limits`.
- Protocol versions, event names, and stable error codes: `packages/contracts/src/protocol` and `packages/contracts/src/errors`.
- Backend operational defaults: `apps/api/src/platform/config`.
- Browser persistence constants: `packages/sync-client/src/config` or an equivalent focused module.
- Test-only timings, seeds, and fixture sizes: named constants next to the relevant test fixture.

Examples of required names include `GRAPH_SCHEMA_VERSION`, `PROTOCOL_VERSION`, `MAX_LIVE_NODES`, `MAX_CLIENT_UPDATE_BYTES`, `MAX_WS_FRAME_BYTES`, `VALIDATION_TIMEOUT_MS`, `MAX_VALIDATION_WORKERS`, `MAX_VALIDATION_QUEUE_DEPTH`, `WS_HANDSHAKE_TIMEOUT_MS`, and `SERVER_SEQUENCE_ZERO`.

Rules:

- Feature code must import a named constant or validated configuration value instead of repeating a literal.
- Environment values must be parsed once through a strict runtime schema during startup.
- Defaults must live beside their schema and state their unit in the name.
- Byte quantities must be derived from named unit constants such as `KIBIBYTE` and `MEBIBYTE`.
- Duration names must include the unit, such as `_MS` or `_SECONDS`.
- Tests may use small literals that are intrinsic to the example, but thresholds and timings must be named.
- Do not create constants for language syntax or self-evident collection indexes merely to satisfy a lint rule.
- Configure a no-magic-numbers lint rule with narrow exceptions for unavoidable language conventions. Do not disable it for an entire package.

### 2.5 Separate frontend and backend deployment

The frontend and backend are separate deployable applications in one monorepo:

- `apps/web` builds independently for Vercel.
- `apps/api` builds independently as a Render web service.
- Both consume versioned workspace packages during the build; neither imports source from the other application.
- Neon is reached only by the backend. The frontend never receives a database URL or credential.

This intentionally amends the original same-origin deployment assumption in `plan.md`. The supported production topology is:

```text
Browser
  ├── https://app.archboard.example     Vercel frontend
  ├── https://api.archboard.example     Render REST and Better Auth
  └── wss://api.archboard.example       Render WebSocket endpoint
                                            │
                                            └── Neon PostgreSQL
```

Use real custom domains under one trusted parent domain. For example, use `app.example.com` and `api.example.com`. This makes the two services different origins but the same browser site.

Do not use a raw `project.vercel.app` frontend with a raw `service.onrender.com` API as the permanent production authentication topology. Those hosts are cross-site, require third-party cookie behavior, and can fail in browsers that restrict such cookies. Raw provider domains may be used for non-authenticated smoke checks or temporary testing with the limitation clearly recorded.

Authentication and transport rules:

- Better Auth runs only on the Render API.
- Set Better Auth's base URL explicitly to the public API origin.
- Keep the session cookie host-only to the API domain unless a demonstrated requirement needs cross-subdomain cookie sharing. HttpOnly frontend code does not need to read it.
- Use `Secure`, `HttpOnly`, and the validated SameSite policy appropriate to the same-site subdomain topology.
- Add only exact frontend origins to Better Auth `trustedOrigins` and backend CORS configuration.
- Browser REST calls to the API must use credentials.
- Backend CORS must allow credentials and must never combine credentials with wildcard origin.
- The WebSocket client connects directly to the Render `wss://` endpoint.
- Validate the WebSocket `Origin` header against the same exact frontend-origin allowlist before authenticating or sending graph bytes.
- Authenticate WebSocket upgrades with the Better Auth session cookie sent to the API domain.
- GitHub OAuth callbacks terminate at the API's Better Auth callback URL and redirect only to an allowlisted frontend URL.
- Do not disable Better Auth CSRF or origin checks to make a deployment work.

Configuration must be environment-driven and runtime-validated:

| Application | Required setting | Meaning |
| --- | --- | --- |
| Web | `VITE_API_ORIGIN` | Public HTTPS origin of the Render API |
| Web | `VITE_WS_ORIGIN` | Public WSS origin of the Render API |
| API | `PUBLIC_API_ORIGIN` | Canonical external API origin used by Better Auth |
| API | `ALLOWED_WEB_ORIGINS` | Explicit comma-separated frontend origin allowlist |
| API | `PORT` | Render-provided public service port |
| API | `DATABASE_URL` | Neon pooled runtime URL |
| API | `DATABASE_DIRECT_URL` | Neon direct migration and advisory-lock URL |

Origin settings must contain origins only, without an accidental path or trailing wildcard. Production startup must reject HTTP origins other than explicitly supported local development origins.

The Render process must bind its HTTP and WebSocket server to `0.0.0.0` on the validated `PORT`. REST, Better Auth, health endpoints, and WebSocket upgrade share that one public server and port.

Vercel external rewrites may be used for HTTP convenience, but the application must not depend on a Vercel rewrite for WebSocket support. The canonical client WebSocket URL points directly to Render.

Preview deployments require an explicit origin policy. Do not trust every `*.vercel.app` deployment in production. Add the exact active preview origin through environment configuration and remove it when the preview is retired.

## 3. Agent execution contract

Each agent implements exactly one commit unless the user explicitly assigns a range. The agent must begin from the exact parent commit named in the assignment.

Before editing, the agent must:

1. Read `plan.md`, `phase1.md`, this guide, and any repository-level agent instructions.
2. Inspect the current branch, HEAD, status, and recent commit history.
3. Confirm that the required parent commit is present.
4. Inspect existing changes and preserve work that does not belong to the assigned commit.
5. Read all files in the assigned ownership area before changing them.
6. State the commit ID being implemented and its explicit non-goals.

While working, the agent must:

- Stay inside the commit's owned paths unless a listed integration file must change.
- Reuse shared contracts and constants; never create a local duplicate.
- Keep the commit buildable and testable.
- Add tests that prove behavior rather than mirror implementation details.
- Use deterministic failpoints for crash windows and failures.
- Record commands and outcomes in the commit's evidence file.
- Update this guide only when the architecture itself is intentionally amended.
- Avoid drive-by formatting, renaming, dependency upgrades, or cleanup outside the commit.

Before committing, the agent must:

1. Review the diff and remove unrelated changes.
2. Run the commit-specific checks.
3. Run `pnpm typecheck` and `pnpm lint` after those scripts exist.
4. Run broader tests only when the commit affects shared behavior or the table below requires them.
5. Update `docs/evidence/phase1/Cxx.md` with actual commands and results.
6. Commit with the exact subject listed in this guide.
7. Report the resulting commit hash, changed files, checks, and any unresolved risk.

Agents must never:

- Rewrite, squash, amend, or rebase commits created by another agent without explicit authorization.
- Commit `.env`, tokens, Neon connection strings, OAuth secrets, generated coverage, build output, or editor state.
- mark a check as passed when it was skipped, mocked, or failed.
- weaken a contract or limit to make a test pass.
- implement product UI or later-phase features while completing a Phase 1 spike.

## 4. Branch and commit policy

Use one integration branch for Phase 1. A single sequential implementation may commit directly to it. Parallel agents must work from isolated branches or worktrees and may start only when their dependency commits are available.

Commit rules:

- One row in the commit plan equals one commit.
- Use the exact Conventional Commit subject shown in the plan.
- Keep generated lockfile and migration artifacts in the same commit as the change that created them.
- A fix discovered before the assigned commit is handed off belongs in that commit.
- A fix discovered after handoff gets a separate `fix(...)` commit; do not silently amend history.
- Documentation evidence belongs in the same commit as the behavior it records.
- The final audit commit changes documentation and verification metadata only. Functional fixes must land before it as explicit fix commits.

Parallel work is allowed only for commits marked as parallel-safe. Parallel agents must not edit the same manifest, barrel export, TypeScript config, or shared evidence index at the same time. If those integration files are required, assign one agent as owner or serialize the work.

## 5. Canonical repository commands

Commit C01 must establish these stable root commands. A later commit may add a command's implementation, but must not rename the interface without updating this guide.

| Command | Purpose |
| --- | --- |
| `pnpm install --frozen-lockfile` | Reproduce the pinned dependency graph |
| `pnpm format:check` | Check formatting without modifying files |
| `pnpm lint` | Run lint and boundary rules |
| `pnpm typecheck` | Strict TypeScript check across the workspace |
| `pnpm test` | Run unit tests across packages and apps |
| `pnpm test:integration` | Run API and real PostgreSQL integration tests |
| `pnpm test:browser` | Run real-browser IndexedDB and text-binding tests |
| `pnpm build` | Build every publishable package and application |
| `pnpm db:migration:generate` | Generate a reviewed TypeORM migration |
| `pnpm db:migration:run` | Apply committed migrations with the direct URL |
| `pnpm db:migration:show` | Show pending/applied migrations |
| `pnpm auth:schema:check` | Regenerate the pinned Better Auth SQL in a temporary location and fail on drift |
| `pnpm phase1:verify` | Run the full Phase 1 gate after C15 |

Commands requiring a database must fail clearly when the required connection variable is absent. They must never silently connect to a production database. Test commands must use an explicitly named test database or ephemeral test container.

## 6. Commit graph

```text
C01 → C02 → C03 → C04 → C05 → C06 → C07
                  │      │      │
                  │      │      ├──────────────→ C15
                  │      ├──→ C10 → C11 ──────→ C15
                  │      ├──→ C12 ────────────→ C15
                  │      ├──→ C13 ────────────→ C15
                  │      └──→ C14 ────────────→ C15
                  └──→ C08 → C09 → C11 ───────→ C15
```

The default execution order is C01 through C15. After C08, an orchestrator may parallelize independent work when file ownership does not overlap.

## 7. Commit plan

### C01 — Bootstrap the workspace

Commit subject:

```text
chore(repo): bootstrap the phase 1 workspace
```

Depends on: none.

Owned paths:

- Root workspace manifests and configuration.
- Minimal `apps/web` and `apps/api` boot files.
- Package manifests and empty public entry points.
- `.env.example`, `.gitignore`, and root README command table.
- `docs/evidence/phase1/C01.md`.

Required work:

- Initialize the pnpm workspace and pin the package-manager version.
- Select and record a supported Node.js LTS version.
- Pin exact direct dependency versions and commit the lockfile.
- Configure TypeScript strict mode, ESM, formatting, linting, Vitest/Jest as selected, and workspace builds.
- Configure the no-magic-numbers rule with documented narrow exceptions.
- Create minimal React/Vite and NestJS/Express applications that build and start.
- Establish package-boundary rules preventing `contracts` and `document-model` from importing React or NestJS.
- Add placeholders for every canonical root command; commands with no tests yet may report that no matching tests exist and exit successfully only when this behavior is explicit.

Non-goals:

- No graph schemas, database entities, authentication, WebSocket behavior, or product UI.

Required checks:

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
```

Evidence must record the chosen Node.js, pnpm, React, Vite, NestJS, TypeScript, test-runner, and module-system versions.

### C02 — Add validated configuration and named constants

Commit subject:

```text
feat(config): add validated runtime configuration
```

Depends on: C01.

Owned paths:

- `apps/api/src/platform/config/**`.
- `apps/web/src/platform/config/**`.
- Configuration tests and `.env.example`.
- `docs/evidence/phase1/C02.md`.

Required work:

- Parse environment variables once at process startup with a strict runtime schema.
- Define `DATABASE_URL` and `DATABASE_DIRECT_URL` without exposing their values to logs.
- Validate the public API origin, public WebSocket origin, exact web-origin allowlist, and Render port.
- Keep browser-safe public configuration separate from API-only secrets.
- Define named operational defaults for WebSocket handshake, ping/pong, worker timeout, worker concurrency, queue depth, room capacity, and rate limits.
- Encode units in constant names.
- Reject missing, malformed, or unsafe configuration with actionable startup errors.
- Keep server-only values out of the web build.

Non-goals:

- No database connection, authentication setup, worker pool, or WebSocket gateway.

Required checks:

```text
pnpm test --filter config
pnpm lint
pnpm typecheck
```

### C03 — Define shared contracts, limits, and errors

Commit subject:

```text
feat(contracts): define phase 1 graph and protocol contracts
```

Depends on: C02.

Owned paths:

- `packages/contracts/**`.
- Contract tests.
- `docs/evidence/phase1/C03.md`.

Required work:

- Implement the exact logical graph projection from `phase1.md` as strict Zod schemas and inferred types.
- Use a discriminated node-content union with no arbitrary metadata bag.
- Define centralized product limits and unit constants.
- Define protocol version, event names, strict message unions, and canonical error codes.
- Serialize PostgreSQL sequences as validated decimal strings.
- Reject unknown fields, invalid UUIDs, non-finite geometry, invalid enum values, unsupported URL schemes, and values beyond limits.
- Export a deliberately small public API from the package root.

Non-goals:

- No Yjs objects, database entities, Nest DTO copies, or React Flow types.

Required checks:

```text
pnpm --filter contracts test
pnpm lint
pnpm typecheck
```

### C04 — Add deterministic fixtures

Commit subject:

```text
test(fixtures): add deterministic phase 1 scenarios
```

Depends on: C03.

Owned paths:

- `packages/fixtures/**`.
- `docs/evidence/phase1/C04.md`.

Required work:

- Add minimal, all-entity, malformed, typical-size, limit-size, and one-over-limit graph fixtures.
- Add deterministic seeds and fixed valid application UUIDs.
- Define concurrency scenario inputs without yet coupling them to a Yjs implementation.
- Provide fixture builders that make the tested threshold explicit through named parameters.
- Validate every valid logical fixture through `contracts` and assert every invalid fixture fails for the intended reason.

Non-goals:

- No snapshots that depend only on nondeterministic Yjs client IDs.
- No product templates or demo content beyond what tests need.

Required checks:

```text
pnpm --filter fixtures test
pnpm --filter contracts test
pnpm lint
pnpm typecheck
```

### C05 — Implement the Yjs schema and projection

Commit subject:

```text
feat(document-model): implement the yjs schema and projection
```

Depends on: C04.

Owned paths:

- `packages/document-model/src/schema/**`.
- `packages/document-model/src/projection/**`.
- `packages/document-model/src/validation/**` excluding causal internals.
- Related tests and `docs/evidence/phase1/C05.md`.

Required work:

- Create the fixed Y.Doc roots defined in `phase1.md`.
- Store textual fields as Y.Text and geometry as the specified atomic objects.
- Keep entity IDs as map keys and immutable fields immutable.
- Implement deterministic projection with stable ordering.
- Filter tombstoned objects, incident edges with missing endpoints, and missing step targets.
- Validate complete physical structure, immutable fields, append-only tombstones, stored values, and entity limits.
- Keep valid missing graph references distinct from missing Yjs causal dependencies.

Non-goals:

- No domain mutation commands, causal-internal access, persistence, server rooms, or UI adapters.

Required checks:

```text
pnpm --filter document-model test -- schema projection validation
pnpm lint
pnpm typecheck
```

### C06 — Add domain commands and undo origins

Commit subject:

```text
feat(document-model): add graph commands and local undo origins
```

Depends on: C05.

Owned paths:

- `packages/document-model/src/commands/**`.
- `packages/document-model/src/undo/**`.
- Related tests and `docs/evidence/phase1/C06.md`.

Required work:

- Implement the Phase 1 command set from `phase1.md`.
- Require fully initialized entities in one transaction.
- Prevent in-place kind, endpoint, handle, and ID mutation.
- Implement deletion only through append-only tombstones.
- Implement restore as fresh entities with fresh IDs and remapped internal edges.
- Define local, remote, and hydration origins.
- Scope Y.UndoManager to eligible local property/text/geometry commands and exclude remote transactions, creation, and deletion.
- Ensure consumers can mutate the document only through exported commands.

Non-goals:

- No React hooks, React Flow event handlers, keyboard shortcuts, or persistent undo stack.

Required checks:

```text
pnpm --filter document-model test -- commands undo
pnpm lint
pnpm typecheck
```

### C07 — Prove convergence and delete-wins semantics

Commit subject:

```text
test(document-model): prove convergence and tombstone semantics
```

Depends on: C06.

Owned paths:

- `packages/document-model` convergence tests.
- Yjs-specific concurrency fixtures in `packages/fixtures`.
- `docs/evidence/phase1/C07.md`.

Required work:

- Prove A02, A03, A04, and A05 with independent Y.Doc replicas.
- Prove move plus resize, concurrent creation, concurrent step reordering, and local undo after a remote edit.
- Add seeded randomized delivery with duplicates and reorderings.
- Compare final observable projections after every replica receives the complete accepted update set.
- Run every seed enough times to be meaningful while keeping CI duration bounded by a named test budget.

Non-goals:

- No network transport, database persistence, or claim about wall-clock conflict winners.

Required checks:

```text
pnpm --filter document-model test -- convergence
pnpm test
pnpm lint
pnpm typecheck
```

### C08 — Integrate Neon PostgreSQL through TypeORM

Commit subject:

```text
feat(database): add neon typeorm foundation and migrations
```

Depends on: C03. Default sequence places it after C07; it is parallel-safe with C05–C07 only if manifests and shared exports have a single owner.

Owned paths:

- `apps/api/src/platform/database/**`.
- Feature-owned TypeORM entity files needed by Phase 1.
- `apps/api/src/migrations/**`.
- TypeORM data-source configuration.
- Database integration tests and `docs/evidence/phase1/C08.md`.

Required work:

- Configure TypeORM with `pg`, `synchronize: false`, explicit entity registration, and validated URLs.
- Use the pooled URL for the runtime data source and the direct URL for migrations.
- Configure Better Auth's official built-in PostgreSQL adapter with its own bounded `pg.Pool`; do not use a community TypeORM adapter.
- Generate the Better Auth schema with the pinned CLI, review the SQL, and place its tables before application foreign keys in the committed migration chain.
- Add `pnpm auth:schema:check` so dependency upgrades expose auth-schema drift.
- Implement the relational schema and indexes specified in `phase1.md`.
- Preserve Better Auth table ownership and propagate its actual user ID type.
- Store Yjs snapshots and updates as `bytea`; map sequence values without JavaScript number conversion.
- Add the dedicated direct `QueryRunner` lifecycle for the singleton advisory lock, including readiness failure and connection-loss behavior at the narrow Phase 1 foundation level.
- Commit generated migration files after reviewing their SQL.
- Prove a clean migration against an empty real PostgreSQL database.

Non-goals:

- No CRUD APIs, complete board lifecycle, production room service, or Neon project provisioning automation.

Required checks:

```text
pnpm db:migration:show
pnpm db:migration:run
pnpm auth:schema:check
pnpm --filter api test:integration -- database
pnpm lint
pnpm typecheck
```

### C09 — Prove Better Auth over WebSocket upgrade

Commit subject:

```text
test(auth): prove authenticated websocket upgrades
```

Depends on: C03 and C08.

Owned paths:

- `apps/api/src/modules/auth/**`.
- Minimal Phase 1 WebSocket spike files under `apps/api/src/modules/collaboration/**`.
- Auth/upgrade integration tests and `docs/evidence/phase1/C09.md`.

Required work:

- Mount Better Auth through Express before JSON body parsing.
- Preserve session cookies and response headers.
- Resolve the real Better Auth session during the native WebSocket path.
- Configure exact credentialed CORS for the separately deployed frontend.
- Validate the WebSocket Origin and the named handshake/frame limits before sending graph bytes.
- Parse strict shared envelopes.
- Prove a valid allowed frontend origin can authenticate to the API and open the WebSocket with its session cookie.
- Prove anonymous, invalid-cookie, invalid-origin, oversized-frame, and malformed-envelope attempts fail without graph disclosure.

Non-goals:

- No GitHub sign-in UI, full membership system, room synchronization, reconnect loop, or presence implementation.

Required checks:

```text
pnpm --filter api test:integration -- auth websocket
pnpm lint
pnpm typecheck
pnpm build
```

### C10 — Isolate causal-completeness validation

Commit subject:

```text
feat(collaboration): reject causally incomplete yjs updates
```

Depends on: C05.

Owned paths:

- One compatibility wrapper under `apps/api/src/modules/collaboration/infrastructure/yjs-compatibility/**` or a narrower server-only package.
- Out-of-order Yjs fixtures.
- Wrapper tests and `docs/evidence/phase1/C10.md`.

Required work:

- Implement the single `assertCausallyComplete` compatibility boundary.
- Prefer a public supported API if the pinned Yjs version provides it.
- If internals are unavoidable, contain every access to the one wrapper and document the exact pinned shape.
- Detect pending structures and pending delete sets.
- Fail closed when the expected internal representation changes.
- Prove complete updates pass and incomplete fixtures fail without changing the accepted document.
- Add an upgrade sentinel test that must fail when the compatibility assumption changes.

Non-goals:

- No database writes, receipt handling, room queues, or browser recovery UX.

Required checks:

```text
pnpm --filter api test -- yjs-compatibility causal
pnpm lint
pnpm typecheck
```

### C11 — Prove durable commit-before-ACK behavior

Commit subject:

```text
test(collaboration): prove durable update acknowledgements
```

Depends on: C08, C09, and C10.

Owned paths:

- Phase 1 collaboration application/infrastructure persistence harness.
- Deterministic server failpoints.
- PostgreSQL integration tests and `docs/evidence/phase1/C11.md`.

Required work:

- Serialize update acceptance through the narrow test harness.
- Authenticate and authorize before receipt lookup.
- Hash the exact update bytes.
- Return the original receipt only for the same board, update ID, actor, and payload hash.
- Apply untrusted bytes to an isolated candidate, run causal and document validation, and leave accepted state untouched on rejection.
- In one real PostgreSQL transaction, lock the board row, recheck authority/archive state, increment the sequence, insert update and receipt, and update content time.
- Expose ACK and broadcast eligibility only after commit.
- Add a failpoint after commit and before ACK to prove A08.
- Add a commit-failure failpoint proving that no ACK/broadcast occurs and accepted state remains unchanged.
- Prove `UPDATE_ID_REUSED` for actor or hash mismatch.

Non-goals:

- No production room registry, compaction scheduler, reconnect client, or horizontal scaling.

Required checks:

```text
pnpm --filter api test:integration -- durable-update receipts
pnpm lint
pnpm typecheck
```

### C12 — Prove atomic IndexedDB update and outbox storage

Commit subject:

```text
feat(sync-client): persist local updates and outbox atomically
```

Depends on: C05.

Owned paths:

- `packages/sync-client/**`.
- Browser persistence harness under `apps/web/src/features/phase1-spikes/**` when needed.
- Browser tests and `docs/evidence/phase1/C12.md`.

Required work:

- Create the four stores defined in `phase1.md` using versioned named constants.
- Namespace data by deployment origin, user ID, board ID, and graph schema version.
- Persist the exact local Yjs update bytes to `localUpdates` and `outbox` in one IndexedDB transaction.
- Make an entry transport-eligible only after transaction commit.
- Persist ACK and outbox removal/marking atomically.
- Distinguish hydration, remote application, and local command origins.
- Inject a deterministic IndexedDB transaction failure.
- Prove A22: no saved state, no send eligibility, editing-pause state, and access to the in-memory projection for export.
- Do not use `y-indexeddb` as a second writer.

Non-goals:

- No service worker, offline routes, production transport, account-switch UI, or complete save-status component.

Required checks:

```text
pnpm --filter sync-client test
pnpm test:browser -- indexeddb outbox
pnpm lint
pnpm typecheck
```

### C13 — Bound candidate validation in workers

Commit subject:

```text
feat(collaboration): bound candidate validation workers
```

Depends on: C05 and C10.

Owned paths:

- Collaboration validation-worker infrastructure.
- Typical/limit/malformed validation fixtures.
- Worker tests, measurement script, and `docs/evidence/phase1/C13.md`.

Required work:

- Run decode and candidate validation outside the main request path in a worker.
- Consume `VALIDATION_TIMEOUT_MS`, `MAX_VALIDATION_WORKERS`, and `MAX_VALIDATION_QUEUE_DEPTH` from validated configuration.
- Terminate timed-out workers and return a stable error.
- Reject overload explicitly when the queue is full.
- Prove malformed input, limit rejection, timeout, overload, and worker failure never mutate accepted state.
- Measure typical and limit fixtures and record hardware, runtime, fixture sizes, sample count, elapsed time, and peak memory when available.

Non-goals:

- No production autoscaling, distributed queue, or performance claim beyond recorded spike evidence.

Required checks:

```text
pnpm --filter api test -- validation-worker
pnpm --filter api phase1:measure-validation
pnpm lint
pnpm typecheck
```

### C14 — Prove incremental Y.Text browser binding

Commit subject:

```text
test(web): prove incremental ytext editing
```

Depends on: C05.

Owned paths:

- Minimal text-binding harness in `apps/web/src/features/phase1-spikes/**`.
- Browser tests and `docs/evidence/phase1/C14.md`.

Required work:

- Select and record the text-control binding strategy.
- Bind incremental edits to Y.Text without full-string replacement per keystroke.
- Apply a remote insert from an independent Y.Doc.
- Prove convergence and acceptable caret/selection preservation in the supported browser matrix.
- Record browser-specific limitations.
- Keep the harness visually minimal and clearly labeled as a Phase 1 spike.

Non-goals:

- No final card editor, syntax highlighting, collaborative cursors, or product styling.

Required checks:

```text
pnpm test:browser -- ytext
pnpm --filter web typecheck
pnpm --filter web build
pnpm lint
```

### C15 — Audit and close Phase 1

Commit subject:

```text
docs(phase1): record foundation evidence and exit status
```

Depends on: C01–C14 and all later explicit Phase 1 fix commits.

Owned paths:

- `docs/phase-1-compatibility.md`.
- `docs/evidence/phase1/**` indexes or corrections.
- README verification references.
- `plan.md` and `phase1.md` only when a previously approved amendment must be recorded.

Required work:

- Pin the final compatibility matrix and include exact versions.
- Link every Phase 1 exit criterion to its test, migration, build, or measurement evidence.
- Record exact commands and results from a clean checkout.
- Record Neon pooled/direct connection behavior without exposing URLs.
- Record independent web/API production builds and the validated Vercel-to-Render origin configuration.
- Confirm the Better Auth generated schema matches the committed auth portion of the migration chain.
- Confirm every magic limit/config value has one named source.
- Confirm architecture boundaries through dependency checks.
- List known risks and distinguish blockers from later work.
- Mark Phase 1 passed only when every mandatory gate is satisfied.

Non-goals:

- No functional code fixes. Land each required fix in a separate commit before C15.
- No claims that later product phases are complete.

Required checks:

```text
pnpm install --frozen-lockfile
pnpm phase1:verify
pnpm db:migration:show
pnpm auth:schema:check
pnpm build
```

## 8. Integration order and parallel assignments

The safest order is C01 through C15. If multiple agents are available, use these waves:

| Wave | Commits | Rule |
| --- | --- | --- |
| 1 | C01, then C02, then C03, then C04 | Always sequential; these establish shared files |
| 2 | C05, then C06, then C07 | Sequential document-model chain |
| 3 | C08 and C10 | May run in parallel after their dependencies; avoid shared manifest edits |
| 4 | C09, C12, C13, C14 | May run in parallel once each dependency is present |
| 5 | C11 | Starts after C08, C09, and C10 are integrated |
| 6 | Fix commits, then C15 | Audit only after every branch is integrated |

The orchestrating agent must assign each parallel worker an isolated branch/worktree, an exact parent hash, one commit ID, and its owned paths. The orchestrator owns integration conflicts and reruns affected checks after cherry-picking or merging.

## 9. Required evidence format

Every commit adds `docs/evidence/phase1/Cxx.md` with:

```text
# Cxx — <title>

Commit: <hash added by the integrating agent if needed>
Parent: <required parent hash>
Environment: <OS, Node.js, pnpm, browser or PostgreSQL version when relevant>

## Behavior proved
<observable result>

## Contracts used
<schemas, limits, commands, and invariants>

## Commands and results
- `<exact command>` — PASS/FAIL/UNRUN, duration, relevant counts

## Failure injection
<failpoints used and the state proved unchanged>

## Measurements
<fixture, samples, hardware, result; or not applicable>

## Known gaps
<remaining issue, consequence, and owner; or none>

## Next commit unlocked
<commit ID>
```

Do not paste secrets, full environment dumps, cookies, source snippets from graph content, or database URLs into evidence files.

## 10. Fix commit policy

When integration reveals a defect after a planned commit has landed, create a focused fix commit immediately before the next dependent commit.

Subject format:

```text
fix(<scope>): <specific violated invariant>
```

A fix commit must state:

- The planned commit that introduced or exposed the defect.
- The failing test or reproducible behavior.
- The smallest correction.
- Targeted checks and any downstream checks rerun.

Do not use broad subjects such as `fix bugs`, `cleanup`, or `changes`. Do not combine unrelated fixes.

## 11. Phase 1 final gate

The integration branch is ready to close Phase 1 only when:

- The full C01–C15 history is present in dependency order, plus any explicit focused fix commits.
- The lockfile reproduces a clean install.
- Strict typecheck, lint, unit, integration, browser, and build checks pass.
- Validated configuration contains every operational default and no feature code repeats magic thresholds.
- Neon pooled runtime access and direct migration/advisory-lock access are proven.
- The web and API build independently, and credentialed REST plus cookie-authenticated WebSocket tests pass across their configured origins.
- TypeORM schema synchronization is disabled and clean migrations pass on real PostgreSQL.
- Better Auth uses its official PostgreSQL adapter, and its pinned generated schema matches the committed migration chain.
- Shared contracts and the physical Yjs schema match `phase1.md`.
- A02–A05 pass with independent replicas and deterministic randomized delivery.
- Cookie-authenticated WebSocket upgrade from an explicitly allowed frontend origin succeeds, and unauthorized variants disclose no graph data.
- A08 proves one durable receipt and the original sequence after retry.
- A22 proves atomic local persistence failure behavior.
- Causal gaps, invalid candidates, worker timeouts, and queue overload leave accepted state unchanged.
- The Y.Text browser binding performs incremental edits and preserves supported selection behavior.
- Dependency checks enforce the feature-module and shared-package boundaries.
- Every gate links to honest evidence from a clean checkout.

If a mandatory check is unrun or relies on a mock where real PostgreSQL, browser IndexedDB, authentication, or WebSocket behavior is required, Phase 1 remains open.

## 12. Agent handoff response

After creating an assigned commit, the implementing agent must respond with:

```text
Commit: <Cxx — title>
Hash: <commit hash>
Parent: <parent hash>
Changed: <files/modules>
Proved: <observable behavior>
Checks: <exact commands and results>
Evidence: <path>
Risks: <known gaps or none>
Next: <unlocked commit ID>
```

The response must describe the committed state. Plans, attempted approaches, and uncommitted local experiments do not count as handoff evidence.

## 13. Technical references

- [NestJS database and TypeORM integration](https://docs.nestjs.com/techniques/database)
- [Neon serverless driver and node-postgres-compatible connections](https://neon.com/docs/serverless/serverless-driver)
- [Neon PostgreSQL compatibility](https://neon.com/docs/reference/compatibility)
- [Better Auth PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql)
- [Better Auth cookie and cross-domain guidance](https://better-auth.com/docs/concepts/cookies)
- [Render WebSocket support](https://render.com/docs/websocket)
- [Render web-service port and binding requirements](https://render.com/docs/web-services)
- [Vercel external rewrites](https://vercel.com/docs/routing/rewrites)

These references establish integration capabilities. Archboard's transaction ordering, advisory-lock ownership, limits, module boundaries, and commit gates remain project-specific requirements defined by `plan.md`, `phase1.md`, and this guide.
