# Unlimited local AI usage

Date: 2026-10-05. Current working tree; not a release acceptance result.

The user requested no local usage limits after a reviewed project context was
rejected with `AI_INPUT_TOO_LARGE`. Development mode now selects a server-owned
unmetered AI policy; production and test retain application quotas. Normalized
default API development mode also selects this policy.

Local admission skips budget, create/poll/fresh-run, provider RPM/TPM, worker
concurrency and SSE connection quotas. It skips the conservative input-byte guard
for initial requests and repairs. Availability returns null remaining allowances
and the UI explains that local development usage is unlimited.

Durable receipts, attempts and actual usage/cost settlement remain. Local runs
create no quota ledger allocations and can settle usage/cost above the configured
reservation. Authentication, board permissions, configuration/schema validation,
idempotency, operator spending switch, deadlines, repair/retry bounds and result
retention remain. Provider limits and charges are independent of this policy.

Failed session queries now use `retryOnMount: false`, preventing route/observer
remounts from immediately restarting failed `/me` calls. Explicit refetch remains
available. The new Node test proves this with actual TanStack Query observers.
The existing error mapper also gives a specific explanation for input-size failures
instead of the generic AI request failure message.

## Verification

- PASS: focused API Jest, 6 suites / 154 tests: config, admission, coordinator,
  controller and exception filter. Includes development-only activation, tiny
  quotas bypassed, permission rejection and successful settlement above the old
  reservation. Tests use in-memory adapters; no database or paid provider.
- PASS: contracts Vitest, 10 suites / 211 tests, including nullable allowances.
- PASS: frontend Node Vitest, 4 suites / 42 tests: current-user-query,
  auth-transition-coordinator, ai-review-session and use-ai-review-session.
- PASS: API production build; contracts build; all workspace package type checks
  and the scripts/web-node type check. The latter initially failed because the
  new QueryObserver test needed the web dependency's public modern type entry;
  its path mapping is now aligned and the focused type check passes.
- PASS: focused ESLint, formatting and `git diff --check`.
- Full web production build remains blocked by previously observed local CSP origin
  configuration and missing `terser` resolution in the installed PWA toolchain.
- Browser checks: **UNRUN (deferred by user)**. Recheck JSON review UI,
  unlimited availability feedback and failed-session navigation after resumption.
- Database checks: **UNRUN (deferred by user — until Version 1 implementation is complete)**.
  Verify durable local attempts/settlement and authorization with real PostgreSQL
  during final verification. Acceptance gates remain OPEN.
- Live paid provider call: UNRUN; no request sent by this verification.

Restart the API and reload the web app to adopt the change. For a request already
rejected before dispatch, start a new reviewed request and generate again.
