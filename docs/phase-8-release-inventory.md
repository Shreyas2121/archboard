# Phase 8 release baseline and source inventory

P8-01 source boundary: `71bd9c46d0c53882a9ecb0e3fc1797b7171f6631`.
Date: 2 October 2026. Authority: [plan.md](../plan.md) v1.1,
[phase8.md](../phase8.md) v1.0, [guide7.md](../guide7.md) v1.0, and the
[verification policy](verification-policy.md). This is an implementation inventory,
not a release audit or refreshed acceptance result. Release acceptance is **OPEN**.
The [verification inventory](phase8-verification.md) defines case IDs, execution
conditions, commands and fixtures. [P8-01 evidence](evidence/phase8/P8-01.md)
records the actual checks and branch boundary.

## Baseline and historical proof

The initial tree was clean on `main`; no Phase 8 branch existed. HEAD includes the
Phase 7 audit `2afa80726bc2850455cc04c08375dee2bc06af02`, verifier
`8ed437c3a8d20277bd56826f53b5eda1eb4f3aad`, Phase 6 audit
`824aeee91c39546413730389617eba42bb9fd263` and the consumed M00–M05 history.
HEAD commits `phase8.md` and `guide7.md`, replacing the tracked `phase7.md` and
`guide6.md`. Recover the old specifications from HEAD's parent when examining
historical contracts; do not reinterpret deleted-file links as current documents.
Use one branch, `phase-8-release-hardening`, without reset, rebase or assembly.

Windows/PowerShell; Node `v22.23.2`, pnpm `11.24.0`. Root engines specify
Node `>=22.12.0 <23`, pnpm `>=11.24.0 <12`; packageManager is `pnpm@11.24.0`.
The lockfile SHA-256 is
`F01249BA63453190B79940219F2F4DC4313E19384E3C809E002737924B4C2E47`.
No install, dependency, protocol, schema or runtime change belongs to P8-01.
Manifests and `pnpm-workspace.yaml` retain React 19.3.0, React Flow 12.11.6,
Vite 8.3.0, Tailwind 4.3.3, Yjs 13.6.32, Zod 4.6.4, Nest 12.0.1,
Better Auth 1.7.4, TypeORM 1.1.1, pg 8.23.0, ws 8.21.3,
TypeScript 6.0.3 and Vitest 5.0.0. These are source pins, not new compatibility proof.

| Audit / original evidence boundary                                                                                                                                 | Inherited observation                                                                                                                                                                                                                | Current disposition / owner                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Phase 2](phase-2-editor.md), [P2-12](evidence/phase2/P2-12.md), [index](evidence/phase2/README.md)                                                                | OPEN; reference Windows/i5-9300H/Chrome production pan p95 **83.3 ms / 32 ms**; opening/drag scoped PASS; spoken screen-reader and additional rendered cases missing                                                                 | P8-04 performance; P8-03/P8-12 keyboard/spoken, large-delete confirmation and text-storage failure. No remeasurement                                 |
| [Phase 3](phase-3-identity-boards.md), [index](evidence/phase3/README.md), [provider follow-up](evidence/phase3/real-github-browser.md)                            | Historical PASS at P3-12 and later provider/user-reported spoken follow-up; base `9dc8100afc2db16829909a506e1d1c72838610ae`                                                                                                          | Retain scoped PASS; it does not close Phase 2 or current release authority/session proof. P8-06/P8-11/P8-12                                          |
| [Phase 4](phase-4-collaboration.md), [P4-12](evidence/phase4/P4-12.md), [index](evidence/phase4/README.md)                                                         | OPEN; base `353306913f59fd4470bb32463bae1a55a90f1c95`; P4-13 rerun visibility **4,876 ms / 500 ms** (P4-12 was 6,598 ms); remote DB/CDP latency was not measured same-region RTT; 11 historical imports; retention migration pending | P8-02 boundaries, P8-04/P8-12 A26, P8-07/P8-11 literal kill/lock-loss; P8-05/P8-11 socket timeout/causal gap. Current configured schema uninspected  |
| [Phase 5](phase-5-offline.md), [P5-06](evidence/phase5/P5-06.md), [index](evidence/phase5/README.md)                                                               | OPEN; base `740d0ff8939bcb0fa0015e699fcbb580a6094326`; real downgrade denial scoped PASS, broader auth-websocket **31 PASS / 1 FAIL** protected presence fanout; combined recovery/worker/account gaps                               | P8-06 repairs/inventory, P8-11 fresh session/fanout and P8-12 actual pending bytes/cache/worker proof. A later focused result is not blanket closure |
| [Phase 6](phase-6-discussion-sharing.md), [verification](phase6-verification.md), [index](evidence/phase6/README.md)                                               | OPEN; P6-11 `039842e677743c4ef3be3fbc2cd2e366a731e698`: **430 tests; 22 PASS / 1 FAIL / 10 UNRUN**, 32 boundaries; P6-03 failed invocation and corrected focused rollback cases distinct                                             | Current A11/A19/A20, resource hint/fanout, query plans and role/conflict/privacy/combined recovery remain deferred. P8-02/P8-06/P8-11/P8-12          |
| [Phase 7](phase-7-presentation-portability.md), [P7-11](evidence/phase7/P7-11.md), [report](evidence/phase7/P7-11-report.json), [index](evidence/phase7/README.md) | OPEN; P7-11 **628 passing tests; 24 PASS / 1 FAIL / 14 UNRUN**; same 32 findings; source fingerprint, subsequent prepared assertions and final docs have separate boundaries                                                         | A16–A18/A21 and three reviewed rows remain OPEN. P8-10 must wire validated evidence; P8-11/P8-12 supply actual observations                          |

Original task/index hashes remain the authority for each historical build. P8-01
does not rerun those aggregates or rewrite old reports. Current boundary scan:
**FAIL, 32 findings; four negative fixtures PASS**, at the source boundary above.

## Product capabilities and owners

Paths in tables are repository-relative; directories identify the existing owner,
not a proposed second implementation. Case IDs resolve in the verification inventory.

| ID / capability       | Current source and test/procedure                                                                                                                                                                | Inherited gap / Phase 8 owner                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P01 Identity          | `apps/api/src/modules/auth/`; `apps/web/src/features/auth/`; `auth-websocket.integration-spec.ts`, `me.integration-spec.ts`; provider follow-up                                                  | Historical provider proof only; fresh expiry/revocation/cookie/origin/account negatives. P8-06, DB-01, UI-03                                                                    |
| P02 Board management  | API `modules/boards/application/board-service.ts`, `infrastructure/postgres-board-persistence.ts`; web `features/boards/`; `boards.integration-spec.ts`, `board-persistence.integration-spec.ts` | Source implements lifecycle/copy/cap/receipts; race, archive, uncertain-response and rendered checks deferred. P8-02/P8-06, DB-02, UI-01                                        |
| P03 Diagram editing   | `packages/document-model/src/commands/`; web `features/editor/{canvas,selection,connections,history}`; `commands.test.ts`, `atomic-commands.test.ts`, P2 procedures                              | Existing numeric geometry and keyboard connection form; complete selection/focus/keyboard path and performance remain open. P8-03/P8-04, UI-01/UI-07/PERF-01                    |
| P04 Technical content | Contracts `graph/schemas.ts`; model text commands; web `cards`, `inspector`, platform highlighting; `convergence.test.ts`, `text-draft.test.ts`                                                  | Inert text/highlighting source present; composition/storage-error/access/contrast proof needs real editor. P8-03/P8-06, UI-03/UI-07                                             |
| P05 Boundaries        | Model commands/projection; web `features/editor/boundaries/`; `commands.test.ts`, P2-09                                                                                                          | Flat coordinates implemented; rendered numeric/selection/legibility/keyboard coverage incomplete. P8-03/P8-12, UI-01/UI-07                                                      |
| P06 Collaboration     | API `modules/collaboration/`; `packages/sync-client/src/transport/`; web presence overlay; worker/queue/gateway units and real DB/socket suites                                                  | Commit/receipt/queue owners present; literal faults, protected fanout, socket timeout/causal gap, same-region visibility missing. P8-04–P8-07, DB-03–DB-07/PERF-02              |
| P07 Offline           | Sync-client `persistence`, `locking`; web `platform/update`, cached-board dashboard, editor application and app/editor recovery; native browser suites, P5 procedures                            | Combined offline/account/quota/eviction/update and original-byte preservation missing. P8-06, UI-02/UI-03/UI-04                                                                 |
| P08 Authorization     | API board permission/authority transaction, invite service/repository; web sharing/member/invite features; permissions/invites/auth-websocket integration                                        | Current authority across REST/WS/fanout and invite races need current real sessions. P8-06, DB-01/DB-02/UI-05                                                                   |
| P09 Discussion        | API discussion service/repository/controller; web `features/editor/discussion/`; `discussion.integration-spec.ts`, P6-08/09/10 harnesses                                                         | Conflict/draft policies present; real winning rows, fanout/refetch, all roles and spoken UI deferred. P8-03/P8-06, DB-02/UI-05                                                  |
| P10 Presentation      | Model `commands/steps.ts`; API `application/presenter-lease.ts`, gateway; web `features/editor/presentation/`; steps/convergence units, P7-03/05                                                 | Authoring/local/follow present; ordering alternatives/focus review and real lease/session/camera proof. P8-03/P8-06, DB-07/UI-06                                                |
| P11 Checkpoints       | API checkpoint service/repository/controller; web `features/editor/portability/`; checkpoint/controller units, boards integration, P7-08/11                                                      | Immutable committed capture/cap/restore implemented; actual transaction and offline-original isolation deferred. P8-02/P8-06, DB-02/UI-06                                       |
| P12 Portability       | `packages/export/src/`; contracts portability; model fresh/remap; API imports; web portability/platform adapters; export/model units and P7-08/09/11                                             | Strict parser/full recovery/controlled SVG/bounded PNG source; actual host/images/cleanup/above-cap/download/uncertainty proof incomplete. P8-05/P8-06, DB-02/UI-03/UI-06/UI-08 |
| P13 Templates         | `packages/fixtures/src/templates/`, fixed API registry and fresh initialization; dashboard/demo; template/model units, P7-10                                                                     | Three templates exist; actual legibility/theme/narrow/keyboard/creation replay awaits proof. P8-03/P8-12, UI-06/UI-07                                                           |
| P14 Quality           | Shared limits, queue/worker policies, recovery UI, health/lock/shutdown, phase verifiers, README/evidence                                                                                        | Partial: 32 boundaries; missing M08 accessibility/performance/security/ops/backup/verifier deliverables. P8-02–P8-10, all release cases                                         |

## Contracts, limits and relational source alignment

The public `packages/contracts/src/index.ts` exports graph/protocol/REST/portability
schemas, enums, errors and limits. Consumers use public packages; editable state
stays in Y.Doc/domain commands, durability in IndexedDB/outbox and PostgreSQL.
Camera/presence/following and REST views do not become editable graph copies.
`apps/api/src/platform/http/openapi.ts` owns Swagger, with
`openapi.spec.ts` and `product-http.spec.ts` as source-level checks.

| Contract / budget authority                                                                                                                                                         | UI / API / WS / export consumption                                                                           | Source gap / future proof                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contracts/src/graph/schemas.ts`, `graph/index.ts` enums, `limits/index.ts`: 500 nodes / 1,000 edges / 50 boundaries / 50 steps; UTF-16 field counts; fixed handles, geometry, URLs | Model validation/commands; card/edge/boundary/step inspectors; validation worker; portable projection/export | Strict live schema tolerates concurrent references; portability additionally rejects dangling/wrong-kind/repeated references and global duplicate IDs. Preserve distinction. P8-02 alignment; P8-05 whole hidden/history candidate negatives |
| 10 MiB encoded Yjs / 1 MiB decoded update / 16 MiB frame                                                                                                                            | Protocol schemas, gateway/upgrade bounds, worker candidate validation; sync-client limits                    | Verify rejection before expensive processing and hidden/tombstoned state accounting. P8-05; DB-05/DB-06                                                                                                                                      |
| 10 connections / 20 rooms; content 20/sec burst 40; presence 15/sec; 2 workers / 20 queued validations / 2 s timeout                                                                | Gateway rate state, room registry, validation-worker-pool; ready limit DTO and error/recovery policies       | `platform/config/operational-defaults.ts` repeats some numeric constants; gateway rate refill uses Date.now. P8-05 review centralization/clock/abuse controls. No new budget in P8-01                                                        |
| `collaboration/application/collaboration-limits.ts`: 32 MiB socket buffered, 4 MiB pending-room bytes / 128 updates, 16 MiB activation / 40 frames                                  | Gateway/registry admission and transient buffering                                                           | Local derived transient budgets exist; test safe overload, causal order and unrelated-room progress. P8-05                                                                                                                                   |
| REST strict schemas: board 100 active-owned; 2,000 threads / 500 comments; checkpoints 100, name 120; cursor default 30/max 100; UUID request keys / 24 h receipts                  | Board/discussion/checkpoint transactional repositories; dashboard/dialogs; OpenAPI                           | Real concurrent caps/authorization-before-replay/version/lock ordering deferred. Archived storage budget needs operator ownership. P8-05/P8-07                                                                                               |
| Portability 5 MiB UTF-8 / request overhead 64 KiB; image 8,192 px side / 32,000,000 px                                                                                              | Export bounded parser/layout; product HTTP canonical `/api/v1/imports`; web file/image adapters              | Ordinary product JSON 64 KiB verified by product HTTP adapter; import whole-file and allocation-before-canvas negatives; full recovery never truncated. P8-05/P8-06, UI-03/UI-08                                                             |
| Presenter lease 30 s; socket pong timeout 45 s; session reevaluation 30 s                                                                                                           | Protocol presenter DTOs, lease/gateway and web explicit follow policies                                      | Current connection/session/role/archive authority and silent expiry must be proved without graph sequence/outbox effects. DB-01/DB-07                                                                                                        |

Relational source: `apps/api/src/migrations/1789300000000-InitialDatabaseFoundation.ts`
and `1790426800000-RetainCompactedUpdateReceipts.ts`; entities in board and collaboration
infrastructure; Better Auth `platform/database/auth-schema.sql` and auth runtime.
Foundation covers metadata/membership/invites/discussion/checkpoints/idempotency,
snapshot/log/update receipts and their source indexes. Retention drops receipt-to-log
foreign keys so compaction retains lifetime receipts; its down migration restores
those constraints and is not a harmless rollback after compaction.
Checkpoint source has through-sequence/schema/creator/encoded-state and
board/created/id index; service/repository owns immutable capture and cap.
No new source migration is demonstrated by P8-01, and no configured schema has
been inspected. P8-02 must check controller/schema/entity/Swagger mapping without
assuming source definitions prove configured state. DB-08 later separates
isolated migration proof, configured retention status and auth compatibility.

The Phase 7 [creation fix](evidence/phase7/fix-portability-creation-boundary.md)
corrected `/boards/import` to `/imports` and strict import/restore summary responses
(`memberCount` is detail-only). Preserve that fix; historical P7-06/P7-07 evidence
does not become corrected-route HTTP proof. Checkpoint routes remain board scoped;
restore is `POST /boards/:id/checkpoints/:checkpointId/duplicate`.

## Interaction, performance, security and operational surfaces

| Surface                             | Actual source / current scope                                                                                                                                                                                                                         | Missing or partial / owner                                                                                                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accessible connections and geometry | `features/editor/connections/keyboard-connection-flow.tsx`: source/target + four fixed handles, review/create, self-loop error; `selection/selection-geometry-panel.tsx`: numeric path; history shortcuts and actions                                 | Reuse these, rather than introducing a second connection form. Full creation/selection/step reorder/focus-return/error associations/announcement/reduced-motion/theme/narrow matrix needs P8-03 and UI-07                                                     |
| Dialogs/status                      | Checked-in shadcn Dialog/Select/Button, app icon-button; save/recovery/pending dialogs and text draft policies                                                                                                                                        | Source labels and Node policies cannot prove trap/return/spoken usability. Check owner/editor/viewer/archive/offline/demo/empty/pending/recovery; P8-03/P8-12                                                                                                 |
| Fixtures and hooks                  | `fixtures/src/graph/fixtures.ts`: typical 200/400/20/20 and limit 500/1,000/50/50; limits/malformed/concurrency fixtures; three templates; model convergence/fresh/portability; canvas render cache; collaboration numeric timing                     | P8-04 must inventory history-heavy encoded workloads, separate text/count/history budgets, hashes/seeds, stage timestamps and reference method. No fabricated fresh benchmark                                                                                 |
| Measurements                        | `scripts/phase2-measure.mjs`; `apps/api/scripts/p4-12-measure-browser.mjs`; `measure-validation.mjs`, `measure-reconstruction.mjs`                                                                                                                    | Render/open need real browser; durable visibility includes DB/peer application. Reconstruction is DB-backed. Same-region 5-user 100 ms RTT setup missing from old local results. PERF-01/PERF-02                                                              |
| Origin/cookies/authority            | API auth runtime/configure-auth-http; websocket-upgrade services; permission transactions and current-session gateway checks                                                                                                                          | Source present; real cookie/CSRF/Origin/role/session/denied fanout proof deferred. Historical presence fanout FAIL retained. P8-06/DB-01                                                                                                                      |
| HTTP/logging                        | `platform/http/product-http.ts`: bounded parsing/query/target, invite throttling, safe template log fields/no-referrer; exceptions redact details; collaboration-metrics accepts arbitrary event/scalar maps                                          | Production auth/proxy log sanitization and bounded metric labels need review. Invite URL/token/body must not reach logs. P8-06/P8-07/UI-08                                                                                                                    |
| CSP and host routes                 | `apps/web/vercel.json`: no-referrer globally, invite no-store and invite-only rewrite; Vite preview referrer headers; index.html meta CSP permits self scripts, wasm, inline styles, blob images/workers and broad HTTPS/WSS connections              | Meta CSP exists; host configs have no CSP response header and no selected Compose/Caddy package. Production connect policy needs scoping. Editor/checkpoint/API/static rewrite and worker/export URL policy need P8-06/P8-07, not a preview-derived host PASS |
| Cache and account scopes            | `apps/web/vite.config.ts`: static precache, empty runtimeCaching, prompt worker update, explicit root/demo/boards navigation allowlist; no invite/checkpoint precache fallback; sync-client board-cache/account scopes and web platform/update fences | Intended checkpoint online-only; actual proxy direct route required. Late responses, cache/IndexedDB namespace, update/eviction/quota/pending bytes need UI-02/UI-03/UI-04. P8-06                                                                             |
| Packaging/readiness                 | No tracked Dockerfile/Compose/Caddy/backup assets found. `health.controller.ts` checks initialization/lock/migrations and a required-table subset; live is process response                                                                           | Schema/table subset omits discussion/checkpoints; readiness does not explicitly share write-admission shutdown state. P8-07 implements compatible-schema/admission readiness and one-writer same-origin package                                               |
| Lock/shutdown                       | Dedicated direct DB advisory lock; connection error sends SIGTERM, heartbeat calls isReady; shutdown stops upgrades/gateway/room admission, waits workers/drains/maintenance then rooms                                                               | No explicit finite shutdown deadline in current shutdown service; process lock-loss/kill/compaction/second-writer proof missing. P8-07/DB-03/DB-04                                                                                                            |
| Backup/restore                      | No repeatable backup schedule, tooling, isolated A29 fixture/harness or runbook found                                                                                                                                                                 | P8-08 implements consistent DB backup, daily schedule, retention/access/checksum/failure signals and isolated restore/reopen. JSON/browser caches are not backups; DB-09/UI-09                                                                                |
| Setup/product guidance              | Root README, `.env.example`, API source config, prior run guides/evidence; README still selects Vercel/Render/Neon and links removed phase7.md/guide6.md                                                                                              | Governing plan selects Compose/Caddy/single Nest/PostgreSQL; P8-07/P8-09 reconcile topology, commands, OAuth callbacks, upgrade/rollback/backup and truthful demo. Old docs remain historical                                                                 |
| Consolidated verification           | Existing phase6/7 check-plan/verifier and required missing manual rows; no registered phase8:verify or phase8 verifier source                                                                                                                         | P8-10 must wire all A01–A30 and validated reviewed inputs, fail closed, report OPEN partial modes, provide implementation inventory. P8-01 creates only inventories                                                                                           |

## Recovered dependency findings

The fresh checker reproduces the P7-11 count, with no whitelist or checker change.
All findings belong to P8-02; preserve meaningful tests when moving them to an
allowed owner. Prefix frontend paths with `apps/web/` and API paths with
`apps/api/src/modules/`. Each numbered row corresponds to one checker finding.

| #   | Offending owner path                                                              | Violation                                                                              |
| --- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | `src/app/editor/board-editor-loader.test.ts`                                      | Forbidden frontend automated test location                                             |
| 2   | `src/app/editor/editor-status-policy.test.ts`                                     | Same                                                                                   |
| 3   | `src/app/theme/theme-provider.test.ts`                                            | Same                                                                                   |
| 4   | `src/features/auth/auth-transition-coordinator.test.ts`                           | Same                                                                                   |
| 5   | `src/features/editor/application/editor-session.test.ts`                          | Same                                                                                   |
| 6   | `src/features/editor/canvas/canvas-gestures.test.ts`                              | Same                                                                                   |
| 7   | `src/features/editor/canvas/canvas-render-cache.test.ts`                          | Same                                                                                   |
| 8   | `src/features/editor/history/editor-shortcuts.test.ts`                            | Same                                                                                   |
| 9   | `src/features/editor/inspector/text-draft.test.ts`                                | Same                                                                                   |
| 10  | `src/features/editor/state/editor-ui-store.test.ts`                               | Same                                                                                   |
| 11  | `src/platform/api/api-client.test.ts`                                             | Same                                                                                   |
| 12  | `src/platform/theme/theme-preference-storage.test.ts`                             | Same                                                                                   |
| 13  | `vitest.node.config.ts`                                                           | Forbidden frontend automated test configuration                                        |
| 14  | `boards/boards.controller.ts`                                                     | Cross-feature `../auth/authenticated-session.js` bypasses public application API       |
| 15  | `boards/boards.module.ts`                                                         | Cross-feature `../collaboration/infrastructure/validation-worker/index.js`             |
| 16  | `boards/infrastructure/postgres-board-persistence.ts`                             | Cross-feature `../../collaboration/infrastructure/room/committed-graph.js`             |
| 17  | Same persistence owner                                                            | Cross-feature `../../collaboration/infrastructure/validation-worker/index.js`          |
| 18  | `boards/invites.controller.ts`                                                    | Cross-feature `../auth/authenticated-session.js`                                       |
| 19  | `collaboration/application/collaboration-shutdown.service.ts`                     | Application imports infrastructure package `@nestjs/common`                            |
| 20  | Same shutdown owner                                                               | Application imports outer validation-worker layer                                      |
| 21  | Same shutdown owner                                                               | Application imports outer websocket gateway layer                                      |
| 22  | Same shutdown owner                                                               | Application imports outer collaboration-upgrade layer                                  |
| 23  | `collaboration/application/collaboration-update-service.ts`                       | Application imports `@nestjs/common`                                                   |
| 24  | Same update owner                                                                 | Application imports outer validation-worker layer                                      |
| 25  | `collaboration/application/room-maintenance.service.ts`                           | Application imports `@nestjs/common`                                                   |
| 26  | Same maintenance owner                                                            | Application imports outer room-compactor layer                                         |
| 27  | `collaboration/collaboration.module.ts`                                           | Cross-feature `../boards/board-authority.module.js`                                    |
| 28  | Same module owner                                                                 | Cross-feature `../boards/application/board-access-notification.js` bypasses public API |
| 29  | `collaboration/infrastructure/persistence/postgres-durable-update-persistence.ts` | Cross-feature boards `infrastructure/board-transaction.js`                             |
| 30  | Same durable persistence owner                                                    | Cross-feature boards `infrastructure/entities/board.entity.js`                         |
| 31  | `collaboration/infrastructure/room/postgres-room-compactor.ts`                    | Cross-feature boards `infrastructure/board-transaction.js`                             |
| 32  | Same compactor owner                                                              | Cross-feature boards `infrastructure/entities/board.entity.js`                         |

P8-02 may repair module exports/providers and test ownership, not relax the four
negative fixtures or move editable graphs into UI stores. Binding authority,
ordering, capacity, preservation and schema failures keep dependent acceptance OPEN.

## Implementation-complete inventory definition

P8-01 **does not** trigger database verification. P8-10 must record, for every row,
actual source paths/commit, meaningful tests/harnesses, fixture/setup, documentation,
verifier case/mode and implemented/missing state. Missing mandatory implementation
blocks the trigger; unexecuted acceptance alone does not. Acceptance then requires
DB-01–DB-09, UI-01–UI-09 and PERF-01–PERF-02, with separate browser resumption.

| Deliverable                                                                                          | Current inventory / remaining owner                                                                                            |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| M00–M04 foundations, all P01–P06/P08 source and invariants                                           | Consumed history and sources above; source/contracts/boundaries repairs P8-02; authority/fault/admission hardening P8-05–P8-07 |
| M05 offline and M06 discussion/sharing                                                               | Delivered sources; combined preservation/cache/current-authority repairs and prepared integration P8-06                        |
| M07 steps/lease/checkpoint/portability/templates                                                     | Delivered sources; A16–A18/A21 and three reviewed rows remain required; owner P8-03/P8-05/P8-06/P8-10                          |
| Full keyboard/focus/status/theme/narrow paths                                                        | Partial existing controls; P8-03 must finish and prepare spoken protocol                                                       |
| Seeded typical/limit/history/hostile workloads and measured-stage hooks                              | Existing fixture helpers; P8-04 inventory/extend and repair bottlenecks; no substitute frame measurement                       |
| Central safe rate/size/cap/worker/admission/retry policies                                           | Existing controls; P8-05 reconcile and prepare race/overload proof                                                             |
| Origin/CSP/cache/log/inert export/account recovery integration                                       | Partial host/privacy/recovery surfaces; P8-06                                                                                  |
| Production Compose/Caddy/build/env package, readiness, finite shutdown, metrics and upgrade/rollback | Missing package and incomplete lifecycle contract; P8-07                                                                       |
| Daily consistent backup mechanism, schedule/runbook, isolated restore fixture/procedure              | Missing; P8-08                                                                                                                 |
| Local/OAuth/env/migration/operations/product/recovery/demo documentation                             | Existing README conflicts and stale links; P8-09                                                                               |
| Phase 8 fail-propagating modes, every case and reviewed input validation; initial OPEN audit/index   | Missing verifier; P8-10. P8-13 final audit follows actual verification                                                         |

Required reviewed Phase 7 inputs remain unwired: `combined-A10-A22-A24-recovery`,
`A18-host-and-image-limits`, `A28-and-template-legibility`. Preserve their complete
[original requirements](phase7-verification.md#required-missing-evidence-and-full-mode-blockers).
No task completion, unit result, local commit or integration closes these gates.
