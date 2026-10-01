# Version 1 implementation verification policy

Effective October 1, 2026, at the user's direction. This policy applies to every
remaining Version 1 milestone, task guide, audit, and evidence handoff. It supersedes
earlier instructions to run database checks during implementation, including checks
described as focused, read-only, non-browser, smoke, baseline, or milestone exit checks.

## Database verification timing

Defer all database-dependent checks and tests until the entire Version 1 implementation
is complete: the required product capabilities and implementation deliverables for
M00–M08 in [plan.md](../plan.md) are implemented. Completing one task, Phase 6, or
another intermediate milestone does not resume these checks. An earlier exception
requires an explicit later user instruction.

During implementation, do not run:

- PostgreSQL/Neon integration tests, including real HTTP/auth/session/WebSocket tests
  that connect to a database, transaction/locking/race/rollback/durability tests,
  database performance measurements, or test-schema creation/migration/cleanup runs.
- Database-backed auth schema compatibility checks, configured migration inspections,
  readiness probes used as verification, database activity diagnostics, or similar
  database reads performed only to validate a change.
- `pnpm test:integration`, `pnpm --filter @archboard/api test:integration`,
  `pnpm auth:schema:check`, `pnpm db:migration:show`, or direct Node/Jest wrappers
  that perform the same checks.
- Any aggregate with database children, including `pnpm phase5:verify --non-browser`.
  A non-browser label does not mean database-free. Inspect child commands before use.

Continue formatting, lint, type checks, builds, boundary checks, static/public-bundle
secret scans, and focused unit/Node tests that use neither a database nor a browser.
API service units and transport/query tests using in-memory adapters remain allowed;
they do not prove real database or socket authorization boundaries.

Keep or add meaningful integration tests and fixtures when needed for implementation,
but defer their execution. Keep migration source, schemas, DTOs, and Swagger aligned
by source review. Do not delete tests, weaken assertions, substitute mocks as database
proof, or change scripts to silently report skipped checks as passing.

This is a verification pause, not a change to runtime database behavior or permission
to deploy, apply configured migrations, or alter existing data. Normal product
development and explicitly requested database operations are separate from automatic
verification; the policy does not require replacing the application's database.

## Browser verification remains paused

The existing browser pause remains independent: no Playwright, native browser package
tests, served preview/browser acceptance, `pnpm test`, `pnpm test:browser`,
`pnpm phase4:quick`, or browser-running phase verifiers until the user explicitly
resumes browser verification. Finishing Version 1 implementation does not itself
resume browser checks.

## Evidence and gates

Record each newly deferred database, schema/migration, or database-backed socket
boundary as **UNRUN (deferred by user — until Version 1 implementation is complete)**.
Continue recording deferred browser checks as **UNRUN (deferred by user)**.
Record fast-check results separately. No substitute unit/build result closes a
database, browser, phase, or release acceptance gate. Keep a deferred-check list in
new task evidence so final verification can recover the required commands and cases.

Historical PASS/FAIL/UNRUN observations and their original build/commit boundaries
remain unchanged. This policy does not revoke earlier proof or make it current-tree
proof. Tasks may land and later implementation milestones may proceed with honest
OPEN acceptance gates; a task handoff need not run deferred checks to continue.

## Final verification after implementation

Once all Version 1 implementation deliverables are complete, run a consolidated
database verification pass, preferably against a separate local PostgreSQL test
database where compatible, plus any required Neon-specific checks. Verify the target
before database operations and use isolated test schemas/databases. Inspect configured
migration state separately from isolated test migrations. Apply migrations only under
existing user authorization; this document grants no migration or deployment approval.

Restore the deferred database/session/socket/auth-schema/migration and regression
checks, record actual results, fix failures, and rerun affected checks. Browser and
other release requirements retain their own resumption conditions. "Version 1
implementation complete" unlocks this final verification; "Version 1 release complete"
still requires the unchanged release gate in plan.md section 20. Do not call the
release PASS while required proof remains missing or failing.
