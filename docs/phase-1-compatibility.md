# Archboard Phase 1 compatibility and exit report

Status: **Passed** on 16 September 2026 (Asia/Calcutta). This is a foundation and risk-spike gate,
not a version 1 product-release or deployment gate. The complete command gate passed against real
Neon PostgreSQL, real Chrome IndexedDB/textarea behavior, and real cookie-authenticated HTTP and
WebSocket upgrades. The user requested no frontend integration or end-to-end tests; the frontend
proofs here are unit-level browser-backed tests only.

## Pinned compatibility matrix

The lockfile and exact direct manifest versions are the package authority. The runtime/hardware
values below describe the audited Windows machine, not a deployment specification.

| Component                             | Audited exact version                     | Role or compatibility result                                   |
| ------------------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| Windows, Node.js, pnpm                | Windows 10; Node.js 22.23.2; pnpm 11.24.0 | ESM workspace, API Jest, and Vite builds pass                  |
| TypeScript, TypeScript ESLint         | 6.0.3; 8.70.0                             | Strict typecheck and no-magic/boundary lint pass               |
| React, React DOM                      | 19.3.0; 19.3.0                            | Web app builds independently                                   |
| Vite, React plugin                    | 8.3.0; 6.1.1                              | Production web build passes                                    |
| NestJS common/core/Express/TypeORM    | 12.0.1 for all four                       | API ESM build and real HTTP/WS spike pass                      |
| Express                               | 5.2.1                                     | Better Auth handler mounts before JSON parsing                 |
| TypeORM, `pg`                         | 1.1.1; 8.23.0                             | Explicit migration and bounded pooled/direct data sources pass |
| Better Auth, `ws`                     | 1.7.4; 8.21.3                             | Real session-cookie upgrade and strict envelope tests pass     |
| Neon PostgreSQL                       | 18.6 (`2078fcb`)                          | Pooled and direct read-only version queries agree              |
| Yjs, Zod, `idb`                       | 13.6.32; 4.6.4; 8.0.3                     | Model, strict contracts, and native IndexedDB units pass       |
| Jest, ts-jest, Vitest                 | 30.5.1; 29.4.12; 5.0.0                    | API and package test runners pass                              |
| Vitest Browser Playwright, Playwright | 5.0.0; 1.63.0                             | Chrome-backed unit suites pass                                 |
| Google Chrome                         | 153.0.8010.36 on Windows                  | Current supported Phase 1 browser proof                        |

The C01 [bootstrap evidence](./evidence/phase1/C01.md) records the original toolchain selection;
subsequent evidence and this gate record the complete final stack. The repository has seven pnpm
projects, six of which have a strict TypeScript check/build target.

## Exact verification commands and results

An ignored root `.env` supplied the existing Neon pooled and direct URLs. Neither URL, role
credential, nor secret was printed or committed. `pnpm phase1:verify` supplies non-secret local
test origins and a test-only Better Auth secret to its child checks; its independent production
builds use secure Vercel-to-Render-shaped origin fixtures. The source worktree was clean at the
start of the audit; the command gate was also repeated after the C15 commit from a clean worktree.

| Command                                                  | Result                                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                         | PASS; all seven workspace projects match the committed lockfile                                                           |
| `pnpm phase1:verify`                                     | PASS; runs every command below plus endpoint/origin and dependency audits                                                 |
| `pnpm format:check`                                      | PASS; repository-wide Prettier check                                                                                      |
| `pnpm lint`                                              | PASS; ESLint and shared-package restrictions                                                                              |
| `pnpm typecheck`                                         | PASS; six strict TypeScript projects                                                                                      |
| `pnpm test`                                              | PASS; API 30, web 7 existing Node units, contracts 61, fixtures 15, document-model 31, sync-client 6 native browser units |
| `pnpm test:integration`                                  | PASS; 3 real-PostgreSQL suites and 17 backend tests                                                                       |
| `pnpm test:browser`                                      | PASS; 6 native IndexedDB units and 7 native Y.Text textarea units in Chrome                                               |
| `pnpm --filter @archboard/api build`                     | PASS; independent ESM API build                                                                                           |
| `pnpm --filter @archboard/web build`                     | PASS; independent production Vite build, 113 transformed modules                                                          |
| `pnpm build`                                             | PASS; all six build targets                                                                                               |
| `pnpm db:migration:show`                                 | PASS; `[X] 1 InitialDatabaseFoundation1789300000000` over the direct endpoint                                             |
| `pnpm auth:schema:check`                                 | PASS; pinned Better Auth-generated SQL equals committed `auth-schema.sql`                                                 |
| `pnpm --filter @archboard/api phase1:measure-validation` | PASS; five typical and five limit samples                                                                                 |
| `node scripts/check-phase1-boundaries.mjs`               | PASS; four manifests, 82 production source files, 233 static imports                                                      |
| `rg -n 'DATABASE_URL                                     | DATABASE_DIRECT_URL                                                                                                       | BETTER_AUTH_SECRET' apps/web/dist -g '*'` | PASS; no browser-bundle matches |

The first sandboxed `phase1:verify` attempt stopped before browser tests because the sandbox denied
reads inside pnpm's installed `@vitest/browser-playwright` dependency tree. The same command was
rerun outside that filesystem restriction and passed; this was an execution-permission issue, not
a failing application test. Better Auth's generator logs a schema-mismatch diagnostic while its
intentionally empty temporary schema is being inspected, then generates SQL and the committed-SQL
comparison passes. The `pg` 8 TLS-mode warning is listed under risks below.

## Phase 1 task and exit-criterion evidence

Every task output and mandatory exit criterion has a direct executable source. The two focused
pre-C15 fixes are separately recorded, as the guide requires.

| Task / criterion                                                                                                     | Evidence and result                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-01/P1-02 pinned toolchain, lockfile, monorepo, independent builds                                                 | [C01](./evidence/phase1/C01.md), [C02](./evidence/phase1/C02.md), frozen install and independent build commands above                                            |
| P1-03 strict graph/protocol DTOs, centralized limits, stable errors                                                  | [C03](./evidence/phase1/C03.md), [bounded-base64 fix](./evidence/phase1/C03-fix-bounded-base64.md); 61 contract units                                            |
| Deterministic valid, malformed, concurrency, typical, and limit fixtures                                             | [C04](./evidence/phase1/C04.md); 15 fixture units and 46 invalid candidates                                                                                      |
| P1-04 fixed physical Yjs roots, all-stored-value validation, deterministic projection                                | [C05](./evidence/phase1/C05.md); 31 document-model units in the final suite                                                                                      |
| P1-05 command-only mutation, incremental Y.Text, undo origins                                                        | [C06](./evidence/phase1/C06.md); document-model command/undo units                                                                                               |
| P1-06 A02–A05 independent-replica convergence and delete-wins                                                        | [C07](./evidence/phase1/C07.md); 432 seeded scenario runs with duplicate/reordered delivery                                                                      |
| P1-07 causal structure/delete-set gaps and fail-closed Yjs internals                                                 | [C10](./evidence/phase1/C10.md); real dependent-update fixtures and upgrade sentinel                                                                             |
| P1-08 credentialed REST, actual Better Auth cookie, allowed-Origin WebSocket, anonymous/invalid-Origin no disclosure | [C09](./evidence/phase1/C09.md), [auth-boundary fix](./evidence/phase1/C15-fix-auth-boundary.md); 6 real backend integration cases                               |
| P1-09 clean auth-first relational migration, `bigint` strings, `bytea`, direct writer lock, `synchronize: false`     | [C08](./evidence/phase1/C08.md), [isolated-integration fix](./evidence/phase1/C15-fix-isolated-integration.md); 3 real migration/lock cases and migration status |
| P1-10 commit-before-ACK and A08 original receipt/sequence after retry                                                | [C11](./evidence/phase1/C11.md); 8 real PostgreSQL integration cases and post-commit failpoint                                                                   |
| P1-11 atomic IndexedDB local update/outbox, ACK transaction, A22 failure/export behavior                             | [C12](./evidence/phase1/C12.md); 6 real Chrome IndexedDB units and deterministic aborts                                                                          |
| P1-12 worker decode/validation, 2 s timeout, 2 workers, queue 32, overload, accepted-state isolation                 | [C13](./evidence/phase1/C13.md); 9 real-worker units and measurements below                                                                                      |
| P1-13 incremental Y.Text/plain-text binding and supported caret/selection behavior                                   | [C14](./evidence/phase1/C14.md); 7 real Chrome textarea units on independent Y.Docs                                                                              |
| P1-14 final audit, amendment record, command and evidence matrix                                                     | This report, `pnpm phase1:verify`, and the dependency audit above                                                                                                |

The [C02 WebSocket timing fix](./evidence/phase1/C02-fix-websocket-timing.md) pins the specified
5-second handshake, 15-second heartbeat, and 45-second pong timeout. Worker and frame size checks
consume their named constants rather than redefining thresholds in feature code.

## Neon, auth, and topology decisions

The ignored local URL pair has a pooled `-pooler` runtime endpoint and a non-pooled direct endpoint
for the same database and role. A read-only `SELECT current_setting('server_version')` succeeded on
both and returned PostgreSQL 18.6 (`2078fcb`). Runtime TypeORM and Better Auth each own a bounded
pool on the pooled URL; the migration data source and dedicated collaboration-writer `QueryRunner`
use the direct URL. The real integration suite proves advisory-lock exclusion/reacquisition and
transactional receipt behavior. This split accords with [Neon's connection-pooling documentation](https://neon.com/docs/connect/connection-pooling):
its transaction pooler does not preserve session-level advisory locks or `SET` state, and direct
connections are recommended for migrations. The C08 integration proof now migrates an isolated
process-scoped schema, C11 does the same, and C09 cleans only its generated test user. No public
schema reset, Neon branch creation, production deployment, or credential disclosure occurred in
the C15 gate.

The API bootstrap mounts Better Auth's Express handler before JSON parsing, preserves actual
session cookies and credentialed CORS headers, and rejects anonymous or untrusted-Origin WebSocket
upgrades before graph data. An authenticated `hello` receives `SERVER_BUSY` because production
membership/room loading is deliberately excluded, not because the auth upgrade failed. The pinned
Better Auth CLI generated the four auth tables into an isolated schema; the resulting SQL matched
the committed auth artifact, which the initial TypeORM migration executes before application
foreign keys and ten application tables. All data-source options explicitly disable schema
synchronization.

The supported hosting shape remains Vercel web → Render API → Neon PostgreSQL. A production-mode
fixture validates exact `https://archboard.vercel.app` and
`https://archboard-api.onrender.com` API origins, and the production web build embeds its paired
HTTPS/WSS API fixture. The C02 API/web tests reject wildcard, pathful, or insecure production
origins; C09 exercises credentialed REST and cookie WebSocket behavior across a configured local
frontend/API origin pair. These are configuration and transport proofs, not evidence that those
example hostnames are deployed or that GitHub OAuth is configured.

## Worker feasibility measurement

The C15 refresh ran five fresh-worker samples for each C04 fixture on an Intel Core i5-9300H
2.40 GHz CPU with 8 logical CPUs and 17,013,329,920 bytes system memory, using Node.js 22.23.2
win32 x64. Elapsed values include worker startup, decode, causal and complete document validation,
response transfer, and termination. Heap is the highest worker `heapUsed` observation at response
time, not an OS process peak. The earlier [C13 measurement](./evidence/phase1/C13.md) is retained
as its own historical run.

| Fixture | Accepted bytes | Update bytes | Samples | Total ms | Min ms | Median ms | Max ms | Max observed worker heap |
| ------- | -------------: | -----------: | ------: | -------: | -----: | --------: | -----: | -----------------------: |
| Typical |             33 |      197,187 |       5 | 2,017.70 | 376.88 |    396.17 | 441.89 |         24,294,288 bytes |
| Limit   |             33 |      556,338 |       5 | 2,578.44 | 474.71 |    496.12 | 582.42 |         28,008,920 bytes |

Both local fixture runs stayed under the named 2-second per-job deadline. This establishes spike
feasibility on this hardware only; it is not a production latency, throughput, or autoscaling
claim.

## Architecture and amendment audit

Shared package manifests use the expected dependency direction: contracts → Zod;
document-model → contracts/Yjs; fixtures → contracts; sync-client →
contracts/document-model/`idb`/Yjs. ESLint forbids React/Nest imports in contracts and
document-model, enforces type-only imports and named numeric constants, and the executable boundary
audit verifies manifest pins, production-source imports, application/domain inward dependencies,
and cross-feature application API use. Feature-owned TypeORM entities remain under their owning
infrastructure folders. The browser bundle search found no API database or auth secret setting
names. Core graph mutation and validation remain in document-model; the C14 mountable textarea is
a labeled compatibility spike, not an editable graph store or product editor.

Version 1.1 of [`plan.md`](../plan.md) and [`phase1.md`](../phase1.md) records the already-approved
TypeORM choice from [guide §2.2](../guide.md) instead of the original Drizzle baseline. It also
clarifies that C09's native `ws` HTTP upgrade listener is the Phase 1 cookie/Origin proof while the
production room adapter remains later work. Neither amendment changes the graph, protocol, durable
receipt, or offline data contracts. No new unapproved architecture substitution was made.

## Risks, blockers, and exit decision

There are **no unresolved Phase 1 gate blockers**. All mandatory install, static, type, unit, real
PostgreSQL integration, native Chrome browser-unit, build, migration-status, auth-schema, worker,
and dependency checks passed. The two issues found during audit were fixed and verified in
separate pre-C15 commits before the final report.

Later-work constraints must not be mistaken for delivered product features:

- The `pg` 8 connection-string stack warns that `sslmode=require` currently behaves like
  `verify-full` but will adopt weaker libpq semantics in the next major version. A `pg` 9 upgrade
  must explicitly select and reverify the intended TLS mode.
- C10 inspects Yjs 13.6.32 internals behind one fail-closed compatibility boundary. Any Yjs
  upgrade requires its sentinel and causal-gap suites.
- Chrome 153 on Windows is the only supported Phase 1 browser proof. Firefox, Safari/WebKit,
  mobile, IME composition, grapheme-aware caret behavior, and bidirectional text are unverified.
- Worker measurements do not choose production capacity, autoscaling, or distributed queues.
- GitHub sign-in, product board APIs, production rooms/membership/reconnect, hosted deployment,
  the offline application shell, frontend save-status UI, and later product milestones remain open.

The final Phase 1 decision is **passed for foundation and risk validation only**. It authorizes
subsequent product implementation against the pinned contracts, not a version 1 release claim.
