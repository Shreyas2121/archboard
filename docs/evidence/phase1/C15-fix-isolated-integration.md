# Pre-C15 fix - Isolate database and auth integration state

Introduced by: C08 (`44309f2cff0eb1d8b3e81e8f4e9d3f2295fa203e`) and C09
(`a8a1fc0e10d9694c2b98723bb4ca64b28d46c943`)
Parent: 41a46387c297d65df68e497a6eaf9800f6b0b0c0
Environment: Windows, Node.js v22.23.2, pnpm 11.24.0, Neon PostgreSQL 18.6

## Violated invariant

The C08 integration test called `DataSource.dropDatabase()` on the direct `.env` database and
queried the `public` schema. Repeating the mandatory Phase 1 integration gate would therefore
erase project tables and data. The C09 authenticated-upgrade test created a uniquely named Better
Auth user but left that test identity in the database after completion. Neither behavior is an
acceptable default for a repeatable audit command.

## Smallest correction

C08 now creates a process-scoped `archboard_c08_<pid>` schema over the direct connection, applies
the real initial migration there from empty, queries that exact schema for all four auth and ten
application tables, round-trips the same `bigint` and `bytea` values, and drops only its own schema
at teardown. Its advisory-lock test continues to use a dedicated direct session. The broad
`dropDatabase()` call is removed.

C09 still exercises the real pooled Better Auth HTTP and cookie-authenticated WebSocket path. At
teardown it deletes only the test user selected by its generated unique email, using a parameterized
query over the direct connection. Database and HTTP teardown run in `finally` paths. No test resets
the shared `public` schema. This correction changes test isolation, not wire contracts or product
behavior.

## Commands and results

The ignored root `.env` supplied the existing pooled/direct Neon URLs to the child command without
printing or recording either connection string. C08 used a test-only 32-character auth secret.

- `pnpm --filter @archboard/api test:integration -- database` - PASS; 1 suite, 3 tests in
  26.731 seconds on the isolated schema
- `pnpm --filter @archboard/api test:integration -- auth websocket` - PASS; 1 suite, 6 tests in
  14.92 seconds, including test-user cleanup
- `pnpm test:integration` - PASS; 3 suites, 17 tests in 84.647 seconds against real Neon
  PostgreSQL 18.6
- `pnpm lint` - PASS
- `pnpm --filter @archboard/api typecheck` - PASS

## Downstream impact and limitations

The public-schema C08 migration result recorded at C08 remains historical evidence, but the new
default gate proves the same empty-schema migration without repeating that reset. The direct
connection is required for migration and session-scoped advisory-lock work; normal Better Auth
traffic remains pooled. A PostgreSQL `pg` 8 warning still requires a deliberate TLS-mode decision
before a future `pg` 9 upgrade. No production data migration, branch creation, or deployment was
performed by this fix.
