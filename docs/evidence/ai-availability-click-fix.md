# AI availability click handling — October 5, 2026

The enabled availability button used a request guard that required the current-user
query to be successful and idle. Background session revalidation suppressed explicit
clicks; a transient session API failure also prevented an explicit recovery read.

The connection guard now checks browser connectivity. Existing account, sign-out,
board permission, and session-boundary guards still apply. Availability reads retain
server authorization, and generation retains its separate fresh authentication check.
Repeated availability calls retain the first request rather than aborting it. Clearing
or pausing the session releases the aborted availability controller.

Existing uncommitted loading/error UI and HTTP CORS-order changes were preserved.
The HTTP fixture confirms allowed origins can read admission refusals without invoking
auth or accessing a database. These checks do not identify the live network failure in
the supplied screenshot or prove a configured AI provider is operational.

## Verification

- PASS: focused frontend Node suites for review session, review-session hook, AI
  transport, and auth transition coordinator: 46 tests.
  Command: `pnpm exec vitest run --config scripts/web-node/vitest.config.ts scripts/web-node/features/editor/ai/use-ai-review-session.test.ts scripts/web-node/features/editor/ai/ai-review-session.test.ts scripts/web-node/platform/api/ai-api.test.ts scripts/web-node/features/auth/auth-transition-coordinator.test.ts`.
- PASS: database-free `configure-auth-http.spec.ts`: 5 tests, run with the API Jest
  unit configuration and a Nest fixture without database providers.
- PASS: `node --test scripts/security/security-policy.node.test.mjs`: 6 tests.
- PASS: `pnpm typecheck` (workspace and frontend Node test types).
- PASS: focused ESLint on changed hook/session, their Node tests, and Node Vitest
  configuration; focused Prettier formatting.
- Browser reproduction and network inspection: **UNRUN (deferred by user)**.
- Configured database/auth/session/AI runtime verification:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.

Browser, database, and release acceptance gates remain OPEN. Later verification
should confirm one click dispatches availability during background session refetch,
inspect the failing request's status and headers, and confirm the configured runtime
returns either valid AI availability or a readable service error.

## Follow-up: requests cancelled at 15 seconds

The second screenshot shows availability requests cancelled after 15.02 seconds,
matching the client deadline, while other API requests return HTTP 200. This proves
the request is now dispatched and times out; it does not establish the precise live
server bottleneck.

Source review found that the allowance transaction performed 52 sequential ledger
insert/read operations: preparing 16 accounting rows and retrieving 10 rows again.
Availability now reads only its eight required ledger keys through two projected,
batched ORM queries. Absent rows represent zero usage and are not created. The
separately committed poll-frequency accounting, repeated authorization, namespace
and actor admission locks, reservation liability, and generation admission remain.
Provider execution is never part of availability. Client timeouts now have a distinct
error class and tell the user the API did not respond within 15 seconds.

- PASS: 50 backend database-free tests across admission service, PostgreSQL adapter
  QueryRunner probes, and AI controller fixture.
- PASS: 40 frontend Node tests across AI transport, review session, and session hook.
- PASS: workspace typecheck, API build, and focused ESLint.
- Prepared: real PostgreSQL batch-read integration case verifying populated values,
  zero usage for an absent key, and no creation of missing rows.
- Production web build with local HTTP environment: blocked by the existing CSP
  requirement for HTTPS/WSS origins. A separate build uses synthetic HTTPS/WSS
  origins without modifying environment files; client bundling completed but PWA
  generation failed because the installed `@rollup/plugin-terser` cannot resolve
  `terser`. Production web build remains FAIL due to that dependency installation
  issue. The API build and web typecheck passed.
- Live browser reproduction: **UNRUN (deferred by user)**.
- Real PostgreSQL batch-read test and configured runtime latency/lock diagnostics:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.

These results prove code behavior and reduced query count, not live latency or
resolution of the configured runtime timeout. Acceptance gates remain OPEN.
