# Archboard

Archboard is a local-first collaborative architecture editor. This repository is a pnpm
monorepo containing independently deployable web and API applications plus framework-independent
shared packages.

The current implementation scope is Phase 4: durable collaboration. Read
[`phase4.md`](./phase4.md), the commit-by-commit [`guide3.md`](./guide3.md), and the
[Phase 4 audit](./docs/phase-4-collaboration.md) before changing this scope. Earlier-phase
evidence remains authoritative input.

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

| Command                          | Purpose                                                         |
| -------------------------------- | --------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | Reproduce the dependency graph                                  |
| `pnpm dev`                       | Run the API and web development servers                         |
| `pnpm format:check`              | Check formatting                                                |
| `pnpm lint`                      | Run ESLint                                                      |
| `pnpm typecheck`                 | Run strict TypeScript checks                                    |
| `pnpm test`                      | Run workspace units, including native Chrome sync-client tests  |
| `pnpm test:integration`          | Run API integration tests                                       |
| `pnpm test:browser`              | Run browser-backed sync-client package units                    |
| `pnpm boundary:check`            | Check package boundaries and negative fixtures                  |
| `pnpm build`                     | Build applications and packages                                 |
| `pnpm db:migration:generate`     | Generate a TypeORM migration after C08                          |
| `pnpm db:migration:run`          | Apply TypeORM migrations after C08                              |
| `pnpm db:migration:show`         | Show TypeORM migration state after C08                          |
| `pnpm auth:schema:check`         | Check Better Auth schema drift after C08                        |
| `pnpm phase1:verify`             | Run the complete Phase 1 gate after C15                         |
| `pnpm phase2:measure`            | Measure the cached local editor in Chrome                       |
| `pnpm phase2:verify`             | Run the complete Phase 2 static/package gate                    |
| `pnpm phase3:verify`             | Run the Phase 3 automated gate with real PostgreSQL integration |
| `pnpm phase4:quick`              | Run focused static, unit/browser-package, and build checks      |
| `pnpm phase4:verify`             | Run the Phase 4 database, socket, browser, and measured gate    |
| `pnpm phase4:verify:legacy`      | Also replay the older phase verifier scripts for audit          |

The browser-backed sync-client units use Playwright with an installed stable Google Chrome. Package
installation does not download a second browser binary. The web application does not retain an
automated frontend test suite; its feature evidence is recorded through manual supported-browser
acceptance and production builds. Use `pnpm test:browser -- indexeddb outbox` to filter the
sync-client units.

`pnpm phase1:verify` runs the full Phase 1 command gate. It requires an ignored root `.env` with
paired Neon pooled and direct URLs; it does not print credentials. The database integration test now
uses a temporary process-scoped schema rather than resetting `public`.
