# Archboard

Archboard is an offline-capable collaborative architecture editor. This repository is a pnpm
monorepo containing independently deployable web and API applications plus framework-independent
shared packages.

The current implementation scope is Phase 1. Read [`plan.md`](./plan.md),
[`phase1.md`](./phase1.md), and [`guide.md`](./guide.md) before making changes.

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

| Command                          | Purpose                                         |
| -------------------------------- | ----------------------------------------------- |
| `pnpm install --frozen-lockfile` | Reproduce the dependency graph                  |
| `pnpm format:check`              | Check formatting                                |
| `pnpm lint`                      | Run lint and package-boundary rules             |
| `pnpm typecheck`                 | Run strict TypeScript checks                    |
| `pnpm test`                      | Run workspace unit tests                        |
| `pnpm test:integration`          | Run API integration tests                       |
| `pnpm test:browser`              | Run browser-backed sync-client and Y.Text units |
| `pnpm build`                     | Build applications and packages                 |
| `pnpm db:migration:generate`     | Generate a TypeORM migration after C08          |
| `pnpm db:migration:run`          | Apply TypeORM migrations after C08              |
| `pnpm db:migration:show`         | Show TypeORM migration state after C08          |
| `pnpm auth:schema:check`         | Check Better Auth schema drift after C08        |
| `pnpm phase1:verify`             | Run the complete Phase 1 gate after C15         |

The browser-backed sync-client and Y.Text units use Playwright with an installed stable Google
Chrome. Package installation does not download a second browser binary. Use
`pnpm test:browser -- indexeddb outbox` or `pnpm test:browser -- ytext` to run one spike's units.

Commands belonging to later commits currently print an explicit availability message. Their names
are stable so later commits can implement them without changing the developer interface.
