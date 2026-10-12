# Local NestJS startup logging

Date: 2026-10-05. Working-tree implementation evidence.

At the user's request, `runtime.startup_stage` messages are production-only.
Local startup uses NestJS's default logger instead of `PrivacyLogger`; production
retains its sanitized framework diagnostics. Startup failures remain sanitized in
both modes, with local failures sent through NestJS's Bootstrap logger. Stage
tracking remains active so failures identify the relevant startup step.

Custom admission, writer ownership and shutdown lifecycle progress records are
also production-only. Runtime fencing, ownership and shutdown behavior are intact.
This change concerns startup/lifecycle logging; feature/request diagnostics are
unchanged.

- PASS: database-free lifecycle/privacy Jest, 4 suites / 22 tests, including
  production stage logging, silence in development/test/unset modes, sanitized
  local failure reporting and production failure redaction.
- PASS: focused ESLint, formatting, API build and `git diff --check`.
- Browser checks: **UNRUN (deferred by user)**.
- Database-backed startup/ownership checks:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
  No configured API startup or database connection used for verification.
- Acceptance gates remain OPEN.

Restart the API to adopt the logger change.
