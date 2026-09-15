# Pre-C15 fix - Expose auth session lookup through its application API

Introduced by: C09 (`a8a1fc0e10d9694c2b98723bb4ca64b28d46c943`)
Parent: b65f3139a321c643c6c6fd5d1fcf024f459a9b1a
Environment: Windows, Node.js v22.23.2, pnpm 11.24.0, Better Auth 1.7.4,
Neon PostgreSQL 18.6

## Violated invariant

Collaboration's WebSocket infrastructure imported `BetterAuthRuntime` directly from the auth
feature's infrastructure through `auth/index.ts`. The Phase 1 feature-module contract permits
cross-feature consumption only through the other feature's public application API. That direct
infrastructure dependency would couple collaboration transport to Better Auth construction and
break the required dependency boundary check.

## Smallest correction

The auth application layer now publishes an `AuthSessionLookup` port and injection token. A narrow
auth-owned infrastructure adapter calls the same real Better Auth `getSession` API and maps a valid
result to `{ userId }`. `AuthModule` provides the adapter under the port token. Collaboration's
WebSocket service imports only `auth/application/index.ts`, passes the actual Node-header conversion
to the port, and retains the same handshake deadline and rejection behavior. The platform bootstrap
may still use the auth runtime to mount its own HTTP handler; that is composition, not a
cross-feature collaboration dependency.

## Commands and results

- `pnpm --filter @archboard/api test:integration -- auth websocket` - PASS; 1 real
  PostgreSQL-backed suite and 6 tests in 14.851 seconds
- `pnpm --filter @archboard/api typecheck` - PASS
- `pnpm --filter @archboard/api build` - PASS
- `pnpm lint` - PASS
- Search of `apps/api/src/modules/collaboration` for `BetterAuthRuntime` or
  `better-auth.runtime` - PASS; no matches

## Downstream impact and limitations

No WebSocket event, status, frame limit, auth cookie, database query, or production provider
configuration changed. The Phase 1 spike still returns `SERVER_BUSY` after an authenticated
`hello` because room loading is later work. C15's dependency audit can now enforce public
application-only cross-feature imports without an exception for this path.
