# AI creation timeout and accounting reads

Date: 2026-10-06. Working-tree follow-up to local-ai-funding-fix.md.

The user reported an uncertain creation outcome with a failed POST and no response
headers. This does not establish whether the API committed a run. Source review
found that create used the same 15-second client deadline as availability and that
admission repeatedly reloaded already locked accounting rows. A 15-second timeout
is a plausible cause; the live Network duration/error was not supplied.

Creation now uses a 125-second transport deadline, aligned with the existing stream
deadline and above the maximum configured 120-second run deadline. Availability,
read and cancel retain 15 seconds. Timeout errors report their actual deadline.
The review explains when the API took too long to confirm creation and keeps the
original body/key for explicit recovery. There is no automatic POST retry or
replacement intent.

PostgresAiScope now retains copies of ledger rows after their first locked read.
Repeated reads within the same transaction avoid repeating insert-if-missing and
SELECT FOR UPDATE. Successful saves update that transaction's snapshot. Caller
mutation without a save cannot corrupt it. A fresh transaction rechecks the database,
and rollback to a content savepoint clears snapshots. Funding records, balances,
coordinator/row locks and authorization remain mandatory.

- PASS: API database-free Jest, 3 suites / 56 tests: postgres-ai-persistence,
  admission-service and run-coordinator. Includes capacity/budget snapshot isolation,
  save refresh, transaction boundaries and savepoint rollback invalidation.
- PASS: frontend Node Vitest, 2 suites / 39 tests: ai-api and ai-review-session.
  Includes creation staying active past 15 seconds, timing out at 125 seconds once,
  late-response rejection, default availability timeout and exact-key recovery.
- PASS: focused formatting/ESLint, API build, API/frontend Node type checks and
  git diff --check.
- Browser verification: **UNRUN (deferred by user)**.
- Database/live latency verification:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
  Offline tests do not prove a live speedup or the cause of this particular failure.
- No provider request sent by verification. Acceptance gates remain OPEN.

After the API adopts the new build, use Recover original request in the existing
review. Preserve the page/review so its original in-memory request key is retained.
