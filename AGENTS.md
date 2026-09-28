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
Run focused non-browser checks such as formatting, lint, types, builds, and relevant API or
database tests. Record skipped browser checks as **UNRUN (deferred by user)** in new evidence.
Do not mark browser acceptance or a phase/release gate PASS from substitute tests. This
temporary preference remains in effect until the user asks to resume browser verification.
