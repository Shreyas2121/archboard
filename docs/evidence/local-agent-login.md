# Local development login and AI reproduction

Date: 2026-10-06. Working-tree evidence.

The user approved a local development test account to let agents browse without
GitHub, following an explicit request to reproduce AI failures in a browser.
The narrow browser/application reproduction is authorized; unrelated browser
acceptance and database verification remain deferred.

Implemented a Better Auth plugin for POST /api/auth/sign-in/local, registered only
for a loopback API in development mode. The HTTP adapter checks actual socket peer
and exact allowed loopback Origin, including encoded/trailing-slash paths. The
endpoint creates/reuses one reserved account and issues standard HttpOnly session
cookies without returning a token. HomeRoute offers a development-only local login
button and uses the existing current-user query/account transition path afterward.
No caller-selected identity or permission bypass, credentials, schema migration or
production route registration was introduced. See ../local-agent-login.md.

## Verification

- PASS: local-development-login and configure-auth-http database-free Jest:
  23 tests. Covers development/production/test and public-host gating, IPv4/IPv6
  peers, foreign/missing origins, encoded paths, normal cookie/session round trips
  with Better Auth's memory adapter, identity override rejection and account reuse.
- PASS: focused ESLint, formatting, API/web type checks, API build and diff check.
- PASS: authorized isolated Chrome reproduction signed in through the actual local
  button; login returned 200 and /me returned 200. The test account created its own
  synthetic board through the normal authenticated API (201). No personal session
  was imported; diagnostics omit cookies, response tokens and project content.
- Validated docs/examples/ai-debug.project-context.json with the shared schema:
  two synthetic components, one connection, no private evidence.
- General browser acceptance: **UNRUN (deferred by user)** outside this explicitly
  authorized reproduction.
- Database suites/schema/migration inspections:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
  These were not resumed by a normal application reproduction.
- Broader acceptance gates remain OPEN.

## Finding from the reproduction

The first minimal JSON creation returned 202 after 45,884 ms. Its event request
returned 503 after 32,737 ms, and a status read returned 200 after 46,243 ms.
Inspection found that status reads used the same ledger preparation as accounting
mutations. This performs insert-if-missing and locks all quota period rows on each
read, contributing to long delays and subscription idle expiry.

AiIntentService.read now retains authorization, admission/fingerprint/run fencing
and payload validation but skips ledger preparation. Accounting mutations still
prepare/lock required rows. Focused database-free tests passed (57 tests across
the selected intent, coordinator and auth suites); the new regression confirms a
pending read does not prepare accounting and revoked board access is still denied.
No broad database acceptance claim follows from this source/unit evidence.

The follow-up isolated browser run also signed in successfully. JSON creation
returned 202 after 41,207 ms, events returned 200 after 24,353 ms (then the browser
aborted the stream), and status returned 200 after 27,306 ms. This is still too slow;
the AI generation/reconnect flow is not verified as working end to end. The login
mechanism is verified separately and is available for further diagnosis. Synthetic
boards from these authorized runs remain under the local test account.
