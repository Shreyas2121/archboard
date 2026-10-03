# P8-02 source alignment

Source parent: `4dcf5e33d3cca9f407fb163d4bad936f5f15c993` on
`phase-8-release-hardening`. This supplements the historical
[P8-01 inventory](phase-8-release-inventory.md); it does not replace its findings.
Configured database state is **uninspected**. Release acceptance remains **OPEN**.

## Dependency repairs

All 32 inherited findings are resolved without changing the checker, negative
fixtures, package directions, dependency versions or lockfile.

| Inherited findings                                                                           | Repair and ownership                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 12 frontend Node tests and one Node config inside the browser owner                          | Move all existing tests and assertions to `scripts/web-node`, retaining their relative owner paths. Run Vitest with the explicit Node environment and web package resolution. Root typecheck includes their separate strict TS project. Phase 6/7 check plans use the new runner. |
| Boards/invites reaching into auth guard/session implementations                              | Import the existing public auth application interface.                                                                                                                                                                                                                            |
| Collaboration application importing Nest and infrastructure lifecycle runtimes               | Move shutdown and room maintenance, with their tests, to infrastructure/lifecycle. Keep the pure update service framework independent and inject the public `CandidateValidator` port through a factory.                                                                          |
| Board persistence importing collaboration reconstruction/worker implementations              | Inject public `CommittedGraphCopier`, backed by the existing bounded worker and committed-record reconstruction adapter. Copy retains fresh graph IDs and safe invalid/temporary error mapping.                                                                                   |
| Collaboration persistence/compaction importing board entities and transaction implementation | Boards own `BoardSequenceAccess`; its adapter performs the same row lock and sequence/timestamp write. Both features use the shared platform transaction lifecycle. All calls retain the caller's transaction manager.                                                            |
| Collaboration module importing another feature's module and internal notification types      | The application composition root supplies board authority. Public application exports provide sequence and access-notification contracts; provider aliases preserve shared reader/worker instances.                                                                               |

The generic transaction helper only owns connect/start/commit/rollback/release.
Feature services still own authority, actor/board lock order, resource caps and
idempotency. Durable append advances the sequence, inserts the update and retains
the receipt on the same runner. Compaction locks the board before sequence comparison,
snapshot replacement and log deletion. No extra transaction or graph store was added.

## Contract and schema decisions

| Surface                               | Governing source and decision                                                                                                                                                                                                                                                           | Supporting proof / deferred boundary                                                                                                                                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/v1/boards`                 | `plan.md` section 13 requires a board summary at 201. Existing strict `boardSummaryResponseSchema` now controls serialization, Swagger and frontend creation. The internal service can still return detail; the controller uses existing `boardSummaryFromDetail`.                      | Controller unit covers creation/replay, strict parsing and malformed/unauthorized calls; OpenAPI unit and frontend fetch stub verify the public shape. Real blank/template/replay HTTP cases are prepared in `boards.integration-spec.ts`. |
| Board detail and duplication          | Detail GET retains `memberCount`. The existing duplicate response remains detail; the plan specifies a new private board without prescribing a different envelope. Dialog validation distinguishes creation summary and duplicate detail, retaining new-private-board checks.           | Prepared blank/template cases assert absence of `memberCount` in creation and count 1 through an authorized detail GET. Existing duplication, denial, owner caps and replay assertions remain.                                             |
| Committed graph capture/copy          | Shared graph schema, limits, fail-closed reconstruction, latest-sequence completeness and fresh-ID copy semantics stay unchanged. Worker directives remain infrastructure-only; application input uses the pure validator port.                                                         | Real worker unit on a fake transaction covers all-kind copy semantics and missing-sequence rejection. PostgreSQL reconstruction/copy/compaction cases use the new ports and close their shared workers; execution is deferred.             |
| Entity/migration source               | Existing board bigint sequence, positive metadata version, DB timestamps, update/receipt uniqueness and snapshot schema ownership match the unchanged writes. The forward receipt-retention migration removes log foreign keys as already documented. Synchronization remains disabled. | Reviewed migration/entity source only. No demonstrated new schema/index gap warrants a migration. Applied migrations, configured receipt retention and auth schema remain uninspected.                                                     |
| Other shared enums, errors and limits | Existing contracts remain the source of truth. No new DTO, enum, budget or unchecked write path was introduced.                                                                                                                                                                         | Contract/controller/worker units are supporting source proof. Admission, privacy, operations and backup findings remain with P8-05–P8-08.                                                                                                  |

## Final verification handoff

Prepared real regressions retain actual AppModule/auth/permissions/database wiring:
`boards.integration-spec.ts`, `board-permissions.integration-spec.ts`,
`postgres-room-loader.integration-spec.ts`, `postgres-durable-update-harness.integration-spec.ts`,
`auth-websocket.integration-spec.ts` and the existing migration/retention checks.
Run only after the entire M00–M08 implementation and isolated-target prerequisites
are complete. Exact available selections and case IDs remain in the
[verification inventory](phase8-verification.md).

Database proof: **UNRUN (deferred by user — until Version 1 implementation is complete)**.
Browser proof: **UNRUN (deferred by user)**. Fake runners and Nest composition stubs
prove lifecycle ordering and DI, not PostgreSQL locking, live auth, sockets or served UI.
No inherited performance, presence, configured-retention or reviewed-browser gap is
closed by these repairs. P8-03/P8-04 implementation can proceed; dependent acceptance
and the release gate remain **OPEN**.
