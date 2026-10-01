# Phase 3 identity and board lifecycle audit

> Current verification timing (October 1, 2026): all database checks/tests, including
> database-backed session/socket and schema/migration checks, are deferred until the
> entire Version 1 implementation (M00–M08) is complete. Browser checks remain paused
> independently. Follow the [shared policy](verification-policy.md); it overrides earlier
> instructions to rerun these checks. Historical results below remain unchanged;
> implementation may proceed with deferred acceptance gates OPEN.

Status: **PASS for Phase 3**. Automated checks passed on the P3-12 tree. After P3-13, the user
configured development GitHub OAuth and completed the real provider flow in Chrome, including a
served optimized build; the API recorded authenticated `/me` and board requests during the local
run. The user also reported a passing spoken screen-reader check. See the
[real GitHub follow-up](./evidence/phase3/real-github-browser.md) for the observation limits. The
inherited [Phase 2 audit](./phase-2-editor.md) remains open on its separate pan-performance and
human/browser gates. This is neither a release nor a claim of server-backed collaborative graph
editing.

## Base, history, and environment

The branch `phase-3-identity-boards` forked `main` at
`9dc8100afc2db16829909a506e1d1c72838610ae`. P3-01 through P3-12 form a linear planned
sequence, as mapped by the [evidence index](./evidence/phase3/README.md). The additional
`2d1a4f9256f92cb766cc4c3317914cea3f907d38` (`feat: added agents`) sits between P3-08 and
P3-09 and is identified separately; it is not attributed to a planned task. No focused Phase 3 fix
commit or intermediate `main` merge appears in this history.

| Recorded environment                                                         | Evidence                                                                                                          |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Windows; Node.js 22.23.2; pnpm 11.24.0                                       | [P3-12 aggregate gate](./evidence/phase3/P3-12.md)                                                                |
| PostgreSQL 18.6, configured direct endpoint; process-unique isolated schemas | [P3-12 integration and plans](./evidence/phase3/P3-12.md)                                                         |
| Google Chrome 153.0.8010.53, headless; served Vite build at `127.0.0.1:4173` | [P3-10](./evidence/phase3/P3-10.md), [P3-11](./evidence/phase3/P3-11.md), [P3-12](./evidence/phase3/P3-12.md)     |
| Real GitHub provider/callback and browser cookies                            | **PASS**; user-operated Chrome flow with API observations ([follow-up](./evidence/phase3/real-github-browser.md)) |

The committed manifests and `pnpm-lock.yaml` are the dependency authority. Phase 3 added the
frontend's `@tanstack/react-query` and `better-auth` dependencies and the API's `supertest` and
`@types/supertest` test dependencies. The existing API Better Auth, Nest, TypeORM, PostgreSQL,
Yjs, and shared contract pins were not upgraded for this phase. Frozen installation passed in the
P3-12 gate.

## Verification record

The automated regression results below come from the clean committed P3-12 tree. The real provider
and spoken screen-reader results were added after P3-13 at the user's request, as detailed in the
follow-up evidence. The aggregate automated gate was not rerun on the documentation-only commits.

| Command or proof                                                                                                | Latest recorded result                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm phase3:verify`                                                                                            | **PASS**: frozen install, format, lint, strict types, workspace units, Chrome package tests, real PostgreSQL integration, auth schema, migration state, API/web/workspace builds, boundaries, API asset scan, and web bundle scan ([P3-12](./evidence/phase3/P3-12.md)) |
| `pnpm test` through the aggregate                                                                               | **PASS**: contracts 67, fixtures 16, document-model 49, sync-client 19, API 55 ([P3-12](./evidence/phase3/P3-12.md))                                                                                                                                                    |
| `pnpm test:browser` through the aggregate                                                                       | **PASS**: 19 Chrome-backed sync-client package tests ([P3-12](./evidence/phase3/P3-12.md))                                                                                                                                                                              |
| `pnpm test:integration` / API filtered integration through the aggregate                                        | **PASS**: 10 suites, 60 tests on real PostgreSQL; last full run 182.04 s ([P3-12](./evidence/phase3/P3-12.md))                                                                                                                                                          |
| `pnpm auth:schema:check`; `pnpm db:migration:show`                                                              | **PASS**: generated Better Auth SQL matches committed SQL; `[X] 1 InitialDatabaseFoundation1789300000000` ([P3-12](./evidence/phase3/P3-12.md))                                                                                                                         |
| `pnpm --filter @archboard/api build`; `pnpm --filter @archboard/web build`; `pnpm build`; `pnpm boundary:check` | **PASS** as named aggregate children ([P3-12](./evidence/phase3/P3-12.md))                                                                                                                                                                                              |
| `pnpm phase1:verify`; `pnpm phase2:verify`                                                                      | **PASS** as regression commands on the P3-12 tree; these do not change the open Phase 2 product audit ([P3-12](./evidence/phase3/P3-12.md))                                                                                                                             |
| Real GitHub callback and served-build browser session lifecycle                                                 | **PASS** in user-operated Chrome; local API `/me` and board requests were observed during the development run. The served-build repeat is user-reported ([follow-up](./evidence/phase3/real-github-browser.md))                                                         |
| Spoken screen-reader review                                                                                     | **PASS, user-reported**; product/version and detailed path were not supplied ([follow-up](./evidence/phase3/real-github-browser.md))                                                                                                                                    |

The P3-12 production web build was served in Chrome with synthetic API interception. Its
`VITE_API_ORIGIN` and `VITE_WS_ORIGIN` were set to nonsecret local test values. Initial session
resolution, dashboard states, keyboard/focus, and narrow viewport behavior passed only within that
synthetic boundary. The later [real GitHub follow-up](./evidence/phase3/real-github-browser.md)
records a separate user-operated provider run through the optimized served build. OpenAPI 3.1
exposes 16 product operations with cookie security and strict
shared schemas; authenticated HTTP integration checks its paths, statuses, and redaction
([P3-09](./evidence/phase3/P3-09.md)). The API asset scan covered 219 files and the production
web bundle scan covered 127 JS/CSS/HTML assets with no protected settings or secret values found
([P3-12](./evidence/phase3/P3-12.md)).

## Deliverables and exit criteria

| Phase 3 contract or exit criterion                                                                                                 | Direct evidence and decision                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Strict shared user, board, cursor, invite, idempotency, and error contracts                                                        | [P3-01](./evidence/phase3/P3-01.md) — **PASS**                                                                                                                                                                                             |
| GitHub provider configuration, Better Auth handler, safe `/me`, sign-out, server session actor                                     | [P3-02](./evidence/phase3/P3-02.md), [P3-09](./evidence/phase3/P3-09.md), [real follow-up](./evidence/phase3/real-github-browser.md) — **PASS**                                                                                            |
| Central role permission and graph-write authority; A11 viewer, nonmember, cross-board denial without state or existence disclosure | [P3-04](./evidence/phase3/P3-04.md), [P3-12](./evidence/phase3/P3-12.md) — **PASS** at the Phase 3 durable-update boundary; production room transport is Phase 4                                                                           |
| Transactional private blank board, valid snapshot, owner limit, idempotent concurrent create                                       | [P3-03](./evidence/phase3/P3-03.md), [P3-05](./evidence/phase3/P3-05.md), [P3-12](./evidence/phase3/P3-12.md) — **PASS**                                                                                                                   |
| Accessible list/search/archived cursor order, board detail, no other-board leak                                                    | [P3-05](./evidence/phase3/P3-05.md), [P3-12](./evidence/phase3/P3-12.md) — **PASS**                                                                                                                                                        |
| Versioned metadata, archive/restore, committed-state duplicate with fresh graph IDs                                                | [P3-05](./evidence/phase3/P3-05.md), [P3-06](./evidence/phase3/P3-06.md), [P3-12](./evidence/phase3/P3-12.md) — **PASS**                                                                                                                   |
| Owner derivation, member roles/removal/self-leave, board-scoped subordinate lookups                                                | [P3-04](./evidence/phase3/P3-04.md), [P3-07](./evidence/phase3/P3-07.md), [P3-12](./evidence/phase3/P3-12.md) — **PASS**                                                                                                                   |
| Invitation entropy, hash-only storage, one-time exposure, expiry/revoke/upgrade and single-use A19 race                            | [P3-08](./evidence/phase3/P3-08.md), [P3-12](./evidence/phase3/P3-12.md) — **PASS** with two signed-in users and independent connections                                                                                                   |
| A27 archive/update commit orders, database board lock, rejected-state integrity                                                    | [P3-06](./evidence/phase3/P3-06.md), [P3-12](./evidence/phase3/P3-12.md) — **PASS** with observed PostgreSQL lock waits                                                                                                                    |
| Standard REST envelopes, safe logs, readiness, auth/schema checks, exact OpenAPI                                                   | [P3-09](./evidence/phase3/P3-09.md), [P3-12](./evidence/phase3/P3-12.md) — **PASS**                                                                                                                                                        |
| Frontend signed-out, loading, empty, active, archived, conflict, network, expired session, role controls, isolated `/demo`         | [P3-10](./evidence/phase3/P3-10.md), [P3-11](./evidence/phase3/P3-11.md), [P3-12](./evidence/phase3/P3-12.md), [real follow-up](./evidence/phase3/real-github-browser.md) — **PASS** within the recorded synthetic and real browser scopes |
| Keyboard focus, announcements, narrow screen, spoken review                                                                        | [P3-12](./evidence/phase3/P3-12.md), [real follow-up](./evidence/phase3/real-github-browser.md) — Chrome checks **PASS**; spoken review **PASS, user-reported**                                                                            |
| Migration, rollback, mixed query plans, clean builds, secret scans, Phase 1/2 regression commands                                  | [P3-03](./evidence/phase3/P3-03.md), [P3-09](./evidence/phase3/P3-09.md), [P3-12](./evidence/phase3/P3-12.md) — **PASS** on P3-12 tree                                                                                                     |

The mixed query fixture held 700 boards, 320 memberships, 1,200 invites, and 3,000 idempotency
records. After `ANALYZE`, accessible active/cursor pages used the committed active-board index;
invite and idempotency lookups used committed indexes. The small archived/member scans did not
justify another migration on this fixture. [P3-12](./evidence/phase3/P3-12.md) gives plans and
measured timings. These are local observations, not production latency targets.

## Exit decision and remaining work

Phase 3 is **PASS** on the recorded implementation, automated checks, and subsequent real GitHub
browser follow-up. The browser and spoken screen-reader results are user-reported where stated;
the API separately recorded authenticated `/me` and board access. No actual provider-session
expiration was awaited: expiration behavior is supported by the existing API and synthetic browser
checks. The separate Phase 2 audit remains open on pan performance and its missing human/browser
proof. Passing Phase 3 does not certify Phase 2 or release readiness.

The board metadata and initial/duplicate snapshots are durable in PostgreSQL. This phase does not
claim production collaborative graph rooms, server-backed live graph editing, production offline
navigation, finished sharing UI, or deployment readiness. No secrets, cookies, OAuth codes,
database URLs, invitation tokens or hashes, or private user data are included in this audit.
