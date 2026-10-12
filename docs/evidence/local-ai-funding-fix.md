# Local AI funding constraint fix

Date: 2026-10-05. Working-tree follow-up to local-ai-unlimited.md.

The user observed a quick `TEMPORARILY_UNAVAILABLE` response from AI run creation.
Source review found an implementation bug: development bypassed allocation writes,
but the existing PostgreSQL `ai_require_funding` deferred constraint requires twelve
funding allocations and balanced deployment/actor liability before commit. The
adapter maps native failures to the safe generic availability error. This is a
confirmed code mismatch and a likely cause of the reported response; no live
database diagnosis was performed.

The fix retains normal allocation, ledger preparation, attempt claiming and
settlement bookkeeping in development. Only application quota comparisons are
bypassed. Local availability stays unmetered, provider input admission stays
unrestricted and actual usage/cost may exceed the reservation. Missing allocations
are rejected in every mode. No migration, trigger weakening or data edit is needed.

- PASS: database-free API Jest, 4 suites / 71 tests: admission-service,
  run-coordinator, postgres-ai-persistence and intent-service. Local regression
  checks the twelve required allocation classes, balanced outstanding reservation,
  real settlement and continued quota bypass. The coordinator regression still
  settles usage/cost above the configured reservation.
- PASS: API type check (including prepared integration test), focused ESLint,
  formatting, API build and `git diff --check`.
- PostgreSQL regression prepared in ai-persistence.integration-spec.ts: commit
  multiple development runs with budget 1 through real deferred funding triggers,
  dispatch and settle one run.
- Database checks: **UNRUN (deferred by user — until Version 1 implementation is complete)**.
- Browser checks: **UNRUN (deferred by user)**.
- No live provider request sent. Database/browser acceptance gates remain OPEN.

The earlier no-quota-ledgers observation in local-ai-unlimited.md describes the
initial implementation, which this follow-up corrects. Restart the API and start
a new reviewed request to try the corrected implementation.
