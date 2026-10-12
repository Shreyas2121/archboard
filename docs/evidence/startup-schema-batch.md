# Batched startup schema inspection

Date: 2026-10-05. Working-tree implementation evidence.

The user reported a long pause after the final RouterExplorer route message.
Startup readiness runs schemaCompatible before application initialization completes.
The previous implementation called QueryRunner.getTable sequentially for twenty
product tables and four auth tables. Source review of the installed TypeORM adapter
shows each call reloads PostgreSQL table, column, constraint, index and foreign-key
catalogs, plus schema/database lookup queries. Remote latency repeats for every table.

schemaCompatible now passes the deduplicated product/auth table list to one public
QueryRunner.getTables call. It compares the returned metadata locally using the
existing column, unique, foreign-key, auth and migration checks. It retains qualified
table identities when TypeORM strips the current schema from table.name. Missing
tables/mismatched migration histories fail closed; the runner is released on errors.
No startup check is bypassed, no schema is changed and no compatibility result is
cached across readiness checks.

- PASS: database-free schema-compatibility and health.controller Jest, 2 suites /
  14 tests. Checks cover a single batch for all required tables, missing product/auth
  tables, auth drift, migration drift before catalog inspection, qualified names,
  runner cleanup on catalog failure and readiness fencing.
- PASS: focused ESLint, formatting, API type check, API build and git diff --check.
- Live startup timing/database-backed schema verification:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
  Query reduction is established by source/offline probes, not a measured speedup.
- Browser checks: **UNRUN (deferred by user)**.
- Acceptance gates remain OPEN. No configured API startup, database connection,
  migration or provider request used for verification.

Restart the API to adopt the built implementation and observe the new startup gap.
