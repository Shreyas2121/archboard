# Archboard

Archboard is an offline-capable collaborative architecture editor. This repository is a pnpm
monorepo containing independently deployable web and API applications plus framework-independent
shared packages.

The active implementation scope is Phase 2: the local editor. Read [`plan.md`](./plan.md),
[`phase2.md`](./phase2.md), and the commit-by-commit [`guide1.md`](./guide1.md) before making
changes. The completed Phase 1 foundation and compatibility evidence remain authoritative inputs
to this phase.

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

| Command                          | Purpose                                        |
| -------------------------------- | ---------------------------------------------- |
| `pnpm install --frozen-lockfile` | Reproduce the dependency graph                 |
| `pnpm dev`                       | Run the API and web development servers        |
| `pnpm format:check`              | Check formatting                               |
| `pnpm lint`                      | Run lint and package-boundary rules            |
| `pnpm typecheck`                 | Run strict TypeScript checks                   |
| `pnpm test`                      | Run workspace unit tests                       |
| `pnpm test:integration`          | Run API integration tests                      |
| `pnpm test:browser`              | Run browser-backed sync-client package units   |
| `pnpm boundary:check`            | Check package boundaries and negative fixtures |
| `pnpm build`                     | Build applications and packages                |
| `pnpm db:migration:generate`     | Generate a TypeORM migration after C08         |
| `pnpm db:migration:run`          | Apply TypeORM migrations after C08             |
| `pnpm db:migration:show`         | Show TypeORM migration state after C08         |
| `pnpm auth:schema:check`         | Check Better Auth schema drift after C08       |
| `pnpm phase1:verify`             | Run the complete Phase 1 gate after C15        |
| `pnpm phase2:measure`            | Measure the cached local editor in Chrome      |
| `pnpm phase2:verify`             | Run the complete Phase 2 static/package gate   |

The browser-backed sync-client units use Playwright with an installed stable Google Chrome. Package
installation does not download a second browser binary. The web application does not retain an
automated frontend test suite; its feature evidence is recorded through manual supported-browser
acceptance and production builds. Use `pnpm test:browser -- indexeddb outbox` to filter the
sync-client units.

`pnpm phase1:verify` runs the full Phase 1 command gate. It requires an ignored root `.env` with
paired Neon pooled and direct URLs; it does not print credentials. The database integration test now
uses a temporary process-scoped schema rather than resetting `public`.
