# Archboard

Archboard is a local-first collaborative architecture editor. This repository is a pnpm
monorepo containing independently deployable web and API applications plus framework-independent
shared packages.

The current implementation scope includes Phase 5: the offline product boundary. Read
[`phase5.md`](./phase5.md), the commit-by-commit [`guide4.md`](./guide4.md), and the
[Phase 5 audit](./docs/phase-5-offline.md) before changing this scope. Earlier-phase
evidence remains authoritative input.

The Phase 5 exit gate is **open**. The [Phase 5 evidence index](./docs/evidence/phase5/README.md)
links the implementation commits and distinguishes historical browser results from current-tree
browser checks deferred by the user. A local merge into `main` integrates the code and evidence;
it does not certify offline acceptance or authorize deployment.

The Phase 4 exit gate is **open**. The [Phase 4 evidence index](./docs/evidence/phase4/README.md)
records completed task commits and the failed or unrun acceptance gates. A local merge into
`main` integrates the branch history; it does not certify the gate or authorize deployment.

The Phase 3 exit gate is **passed** on the recorded automated checks and subsequent real GitHub
browser follow-up. The [Phase 3 evidence index](./docs/evidence/phase3/README.md) distinguishes
independently observed checks from user-reported browser and screen-reader results.

The [Phase 2 audit](./docs/phase-2-editor.md) is **open, not passed**. The local editor's recorded
pan p95 exceeds its target, and the spoken screen-reader check is unrun. See the
[task evidence index](./docs/evidence/phase2/README.md) for the completed work and remaining proofs.

## Requirements

- Node.js 22.23.2
- pnpm 11.24.0 through Corepack

## Workspace

```text
apps/
  api/                 NestJS/Express API
  web/                 React/Vite frontend
packages/
  contracts/           shared wire and graph contracts
  document-model/      framework-independent Yjs graph model
  fixtures/            deterministic test fixtures
  sync-client/         browser persistence and synchronization
```

The frontend and API build independently. The intended hosted topology is Vercel for `apps/web`,
Render for `apps/api`, and Neon PostgreSQL for backend persistence.

## Commands

Copy `.env.example` to `.env`, supply the real local database and authentication values, then run
`pnpm dev` from the repository root. It builds the API and its workspace dependencies once, then
starts the API compiler, API process, and Vite development server together. `Ctrl+C` stops all three.

| Command                            | Purpose                                                           |
| ---------------------------------- | ----------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`   | Reproduce the dependency graph                                    |
| `pnpm dev`                         | Run the API and web development servers                           |
| `pnpm format:check`                | Check formatting                                                  |
| `pnpm lint`                        | Run ESLint                                                        |
| `pnpm typecheck`                   | Run strict TypeScript checks                                      |
| `pnpm test`                        | Full workspace units; deferred because it launches Chrome         |
| `pnpm test:integration`            | DB tests; deferred until all Version 1 implementation is complete |
| `pnpm test:browser`                | Browser-backed sync-client units; temporarily deferred            |
| `pnpm boundary:check`              | Check package boundaries and negative fixtures                    |
| `pnpm build`                       | Build applications and packages                                   |
| `pnpm db:migration:generate`       | Generate a TypeORM migration after C08                            |
| `pnpm db:migration:run`            | Apply TypeORM migrations after C08                                |
| `pnpm db:migration:show`           | DB inspection; deferred until final Version 1 verification        |
| `pnpm auth:schema:check`           | DB check; deferred until final Version 1 verification             |
| `pnpm phase1:verify`               | Full Phase 1 gate; temporarily deferred                           |
| `pnpm phase2:measure`              | Chrome measurement; temporarily deferred                          |
| `pnpm phase2:verify`               | Full Phase 2 gate; temporarily deferred                           |
| `pnpm phase3:verify`               | Full Phase 3 gate; temporarily deferred                           |
| `pnpm phase4:quick`                | Includes Chrome package tests; temporarily deferred               |
| `pnpm phase4:verify`               | Full Phase 4 browser/database gate; temporarily deferred          |
| `pnpm phase4:verify:legacy`        | Full earlier-phase replay; temporarily deferred                   |
| `pnpm phase5:verify --non-browser` | Contains DB tests; deferred until final Version 1 verification    |
| `pnpm phase5:verify`               | Full Phase 5 browser gate; temporarily deferred                   |

**Version 1 test policy:** Defer all database checks/tests until the entire Version 1
implementation (M00–M08) is complete, then run a consolidated final verification pass.
This includes database-backed HTTP/auth/session/socket tests, schema/migration inspections,
and aggregates with database children, including `pnpm phase5:verify --non-browser`.
Individual task/phase completion does not resume these checks. Prepare meaningful tests,
but record execution as **UNRUN (deferred by user — until Version 1 implementation is complete)**.

Continue to skip browser-running commands for current implementation work,
including `pnpm test`, `pnpm test:browser`, sync-client's `test` script, `pnpm phase4:quick`,
and full phase verifiers until the user resumes browser checks. Run focused database-free
unit/Node checks, format, lint, typecheck, builds, boundaries, and static scans. Record browser
checks as **UNRUN (deferred by user)**; all required deferred proof remains necessary for
phase/release PASS. Historical results remain unchanged. Follow the complete
[verification policy](docs/verification-policy.md). The command table describes available
commands, not a direction to run deferred ones. This documentation change leaves scripts
unchanged; no database-free aggregate exists yet. Phase 6 plans an `--implementation` mode.

The browser-backed sync-client units use Playwright with an installed stable Google Chrome. Package
installation does not download a second browser binary. The web application does not retain an
automated frontend test suite; its feature evidence is recorded through manual supported-browser
acceptance and production builds. When browser verification resumes, use
`pnpm test:browser -- indexeddb outbox` to filter the sync-client units.

`pnpm phase1:verify` runs the full Phase 1 command gate. It requires an ignored root `.env` with
paired Neon pooled and direct URLs; it does not print credentials. The database integration test now
uses a temporary process-scoped schema rather than resetting `public`.
