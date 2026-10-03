# Setup

Use Node **22.23.2**, pnpm **11.24.0** and the committed lockfile. The optional server
package uses PostgreSQL **17.11**. No paid service is required for the local demo.
These are intended setup instructions; fresh-checkout/browser/database setup was
not executed for P8-09. They do not override the current verification pause.
On Windows use `pnpm.cmd` where PowerShell blocks the `pnpm` script shim.

## Local demo without a database

From the repository root:

```text
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm --filter @archboard/contracts build
pnpm --filter @archboard/fixtures build
pnpm --filter @archboard/document-model build
pnpm --filter @archboard/export build
pnpm --filter @archboard/sync-client build
```

Create an ignored root `.env.local` with these public development values, preserving
any existing configuration:

```dotenv
VITE_API_ORIGIN=http://localhost:3000
VITE_WS_ORIGIN=ws://localhost:3000
```

Run `pnpm --filter @archboard/web dev` and open the printed Vite URL's `/demo` route
(normally `http://localhost:5173/demo`; use its actual port). This editor uses local
browser storage and does not attach board synchronization. Sign-in, dashboard,
sharing, discussion and server checkpoints require the API. A fresh/reset demo
starts with Web application; choosing other templates creates a new private server
board after signing in online. Export your current diagram before resetting the demo.

Vite reads env files from the repository root. Restart it after changing origins.
The development server does not establish production service-worker/offline proof.

## Authenticated local development

Use a deliberately selected development PostgreSQL database. For local PostgreSQL,
both database URLs can point to the same server. `DATABASE_DIRECT_URL` must support
a dedicated session for the writer lock; a transaction pooler is unsuitable.
Keep disposable tests and process faults separate from your own diagram database.

Extend root `.env.local` with:

```dotenv
NODE_ENV=development
PUBLIC_API_ORIGIN=http://localhost:3000
ALLOWED_WEB_ORIGINS=http://localhost:5173
PORT=3000
```

Supply actual `DATABASE_URL`, `DATABASE_DIRECT_URL`, a random stable
`BETTER_AUTH_SECRET` of at least 32 characters and GitHub client ID/secret.
[`.env.example`](../.env.example) is a variable inventory with production/example
origins and credentials; its placeholders are not usable configuration. Backend
secrets must never appear in `VITE_*`, commits, logs or screenshots. API development
loads root `.env`, then `.env.local`, with the latter taking precedence.

Create a GitHub OAuth application with homepage `http://localhost:5173` and callback
`http://localhost:3000/api/auth/callback/github`. The implementation requests
`read:user` and `user:email`. Keep localhost hostnames consistent instead of mixing
`localhost` with `127.0.0.1`. Supply OAuth credentials as a pair. Normal development/
production uses GitHub; email/password sign-in is enabled only in test mode.
Omitting GitHub credentials does not create a local password login.

## Explicit initial migrations

Before executing these operator commands, confirm both URLs identify the intended
development database and stop API writers. Preserve existing data before upgrades.
Never enable synchronization or reset `public` to repair startup.

From the root:

```text
pnpm --filter @archboard/api... build
node --env-file-if-exists=.env --env-file-if-exists=.env.local apps/api/node_modules/typeorm/cli.js migration:run -d apps/api/dist/platform/database/migration-data-source.js
```

The datasource uses `DATABASE_DIRECT_URL`. `pnpm db:migration:run` delegates to
TypeORM but does not itself load `.env.local`; this explicit wrapper matches
development env loading. Migrations create auth, graph/access/discussion/checkpoint
tables and retain receipts after log compaction. Startup never auto-applies them.
These instructions grant no migration action or verification resumption during the
current implementation session. Configured inspections remain deferred.

After explicit initialization, `pnpm dev` builds API dependencies and starts the API
compiler/process and Vite together; Ctrl+C stops the group. On a fresh checkout,
also build export/sync-client as in the demo sequence. Run exactly one API against
the database. Schema and writer readiness must pass before it listens.
Endpoints: `/health/live`, `/health/ready`, `/api/v1/openapi.json`.

## Optional production package

Follow [operations](phase-8-operations.md) for Compose, secret files and pinned
builds. Production requires one HTTPS web/API origin and its WSS counterpart.
OAuth callback: `https://<host>/api/auth/callback/github`; homepage: that HTTPS origin.
Public origins are embedded in the frontend; changing them requires rebuilding.

A development HTTP `.env.local` is unsuitable for a production build. Override
its two public origins through root `.env.production.local` with actual HTTPS/WSS
deployment values, or supply them in the build environment. API production mode
separately uses `NODE_ENV=production`. `pnpm build` compiles without serving and
does not prove OAuth, cookies, TLS, WSS or offline behavior. The earlier split
Vercel/Render/Neon topology is not the current packaged default. Native Caddy
adaptation and Docker image builds remain unverified. No deployment/account/DNS
setup was performed by this task.

Daily backup/restore automation is unfinished; see [preservation guidance](using-archboard.md).

| Symptom                             | Check                                                                             |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| Missing shared package              | Build the demo's shared packages before Vite                                      |
| Invalid origin/sign-in              | Exact scheme/host/port, actual Vite port, allowlist and OAuth callback            |
| API exits before listening          | DB connectivity, explicit schema compatibility and competing writer               |
| GitHub unavailable                  | Actual paired credentials; test email login is not a development fallback         |
| Diagram missing                     | Same browser profile, origin and account; inspect exports before deleting storage |
| Offline reload fails in development | Vite development does not prove a controlling production service worker           |
