# Workspace instructions

Before working on anything inside `apps/web`, read and follow
[`apps/web/AGENTS.md`](apps/web/AGENTS.md). This also applies when starting Codex from
the repository root or changing shared configuration specifically for the frontend.

Before working on anything inside `apps/api`, read and follow
[`apps/api/AGENTS.md`](apps/api/AGENTS.md). This also applies when starting Codex from
the repository root or changing shared configuration specifically for the API.

The nested guides cover coding conventions for their respective applications.

## Temporary verification preference

For current implementation tasks, skip all browser-running checks, including Playwright,
native browser package tests, served production-preview flows, and aggregate commands that
launch them (`pnpm test`, `pnpm test:browser`, `pnpm phase4:quick`, and full phase verifiers).
Run focused database-free, non-browser checks such as formatting, lint, types, builds,
static scans, boundary checks, and relevant API unit/Node tests. Record skipped browser
checks as **UNRUN (deferred by user)** in new evidence.
Do not mark browser acceptance or a phase/release gate PASS from substitute tests. This
temporary preference remains in effect until the user asks to resume browser verification.

Defer all database checks/tests until the entire Version 1 implementation (M00–M08)
is complete, then run them during final verification. This includes PostgreSQL/Neon
integration tests, database-backed HTTP/auth/session/socket tests, schema/migration
inspections, and database diagnostics used for verification. Do not run aggregates
with database children, including `pnpm phase5:verify --non-browser`. Implement needed
tests without executing them; record **UNRUN (deferred by user — until Version 1
implementation is complete)** and keep acceptance gates OPEN. Individual task/phase
completion does not resume database checks. Historical evidence remains unchanged.
Follow [the full verification policy](docs/verification-policy.md); it applies to all
task guides and milestone instructions unless the user explicitly overrides it later.
