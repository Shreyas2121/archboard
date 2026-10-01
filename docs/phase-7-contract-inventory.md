# Phase 7 baseline and contract inventory

P7-01 baseline: `5726e72ed6b15a418cff5706a1a4844afbfc8cd1` on
`phase-7-presentation-portability`. Planning documents are included in that committed
baseline. This inventory describes source, not configured database or runtime acceptance.

## Sources of truth and binding gaps

| Surface                  | Existing owner / implemented source                                                                                                                                                                           | Partial or missing work and owning task                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Steps                    | `contracts/src/graph/schemas.ts`; document-model `commands/steps.ts`, text commands, deletion tombstones, undo origins                                                                                        | Create/edit/reorder already exist; validate full command references/concurrency/undo in P7-02. Keep `PresentationStep` and physical maps unchanged.                                                                           |
| Projection               | document-model `projection/project.ts` sorts `(order,id)` and removes deleted highlights/incident edges                                                                                                       | Check export compatibility with strict references and repeated references in P7-02/P7-06; do not weaken or globally tighten live concurrency validation.                                                                      |
| Presenter                | contracts `protocol/schemas.ts` has reserved acquire/step/release/server DTOs; existing room queue, socket ping/pong and permission service                                                                   | Transport excludes reserved controls today. No lease runtime/follow UI. P7-04 activates existing DTOs and connection-bound lease; P7-05 owns explicit following. No protocol version change in P7-01.                         |
| Checkpoints              | PostgreSQL foundation migration; boards `infrastructure/entities/checkpoint.entity.ts`; collaboration committed graph reader/queue                                                                            | No checkpoint controller, immutable transactional capture, list/detail/restore or query/view yet. P7-07 implements server routes; P7-08 implements UI.                                                                        |
| Export/import            | P7-01 contracts `portability/index.ts`; local editor Y.Doc/outbox remain graph/durability owners                                                                                                              | `packages/export` absent; UTF-8 byte cap, bounded parser and independent server import validation/creation absent (P7-06); JSON UX P7-08, controlled SVG/PNG P7-09. Schema parsing alone does not enforce the byte cap.       |
| Remapping                | document-model `projection/remap.ts`; fixtures template instantiator has another all-entity map                                                                                                               | Consolidate fresh graph validation/remapping for all creation sources in P7-06/P7-10; preserve live source history and namespaces.                                                                                            |
| Initialization/duplicate | boards `infrastructure/postgres-board-persistence.ts` and collaboration `room/committed-graph.ts` reconstruct committed state, remap and hydrate a fresh Y.Doc; board transactions enforce owner/cap/receipts | Reuse this transaction/queue/authority path for import/restore/template; retain committed-only duplicate and current authorization before successful replay. Existing cross-feature imports remain binding boundary findings. |
| Fixtures/templates       | `packages/fixtures/src/templates/web-application.ts` includes request flow and four steps                                                                                                                     | Event-processing/service-boundary missing; fixed server registry/template creation and demo integration P7-10.                                                                                                                |
| UI/query/recovery        | web board resource refresh/recovery includes `checkpoints`; editor-session owns durability; TanStack Query owns REST caches; static SW owns offline shell                                                     | Local authoring/playback P7-03; follow P7-05; checkpoint/file/account cancellation/recovery P7-08. No second editable graph or implicit opt-in. No authenticated checkpoint SW caching.                                       |

Imports, copies and restore exclude comments, members, invites, checkpoints, receipts,
credentials, presenter/viewport state, tombstones and CRDT history. Only graph projection
and validated metadata enter a new private board; imported sync labels confer no authority.

## Shared contracts and planned Swagger mapping

All paths below are under `/api/v1`. New schemas are exported from the contracts public
entry point. Existing `apps/api/src/platform/http/openapi.ts` is the Swagger source;
P7-01 adds no paths/components to that runtime document for unavailable routes.

| Method/path                                              | Schema mapping                                                                                      | Runtime availability at P7-01                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| GET `/boards/{id}/checkpoints`                           | `checkpointListQuerySchema`, `checkpointListResponseSchema`                                         | Planned P7-07                                                            |
| POST `/boards/{id}/checkpoints`                          | `createCheckpointSchema`, `checkpointSummaryResponseSchema`                                         | Planned P7-07                                                            |
| GET `/boards/{id}/checkpoints/{checkpointId}`            | `checkpointPathSchema`, `checkpointDetailResponseSchema`                                            | Planned P7-07                                                            |
| POST `/boards/{id}/checkpoints/{checkpointId}/duplicate` | `checkpointPathSchema`, `restoreCheckpointSchema`, `restoreCheckpointResponseSchema`                | Planned P7-07                                                            |
| POST `/imports`                                          | `importBoardSchema`, `importBoardResponseSchema`                                                    | Planned P7-06                                                            |
| POST `/boards/{id}/duplicate`                            | existing `duplicateBoardSchema`, `boardSummaryResponseSchema`                                       | Existing committed duplicate; shared creation integration P7-06          |
| POST `/boards`                                           | existing `createBoardSchema`; additive `createTemplateBoardSchema` with optional fixed `templateId` | Existing blank creation unchanged; wire template schema/Swagger in P7-10 |

Metadata returns ID, board ID, name, `createdBy: UserSummary`, server UTC creation time,
schema version 1 and exact decimal `throughSeq`; detail adds a strict portable projection,
never bytes. Lists use existing canonical timestamp/UUID cursor, default 30/max 100.
Creation accepts only trimmed name and canonical bigint `expectedSeq`; restore accepts
only title. New board results reuse the existing board summary envelope.

Use existing UUID `idempotencyKeySchema` at creation route headers, authenticated actor/
operation scope, exact request hashes and 24-hour transactional receipts. Do not put keys,
owner, creator, sequences or server times in import bodies. Uncertain responses keep the
original request/key; definitive sequence conflict requires explicit refreshed submission.

Safe error mapping reuses central codes: `VALIDATION_ERROR` (400), `UNAUTHENTICATED`
(401), `FORBIDDEN` (403), `NOT_FOUND` (404 without nonmember disclosure),
`BOARD_ARCHIVED` (403), `VERSION_CONFLICT` / `IDEMPOTENCY_CONFLICT` (409),
`PAYLOAD_TOO_LARGE` (413), `RATE_LIMITED` (429), `TEMPORARILY_UNAVAILABLE` (503).
Checkpoint cap uses `DOCUMENT_LIMIT` (409); presenter nonholder/role control uses
`FORBIDDEN`. No new strings or unimplemented error paths are advertised by P7-01.

Strict portability adds global entity-ID uniqueness, live endpoint checks, no self-loops,
correct-kind live highlights and no repeated references to the existing strict object,
text, count, geometry, enum, handle and HTTP(S)-URL schemas. Live graph schema retains
concurrency reference tolerance. String limits keep existing JavaScript UTF-16 counting.
Both supported sync labels are accepted as untrusted descriptive metadata.

Limits now centralize 5 MiB UTF-8 file / 5 MiB plus 64 KiB request overhead, checkpoint
name 120/cap 100, lease 30 seconds and raster 8,192 pixels per side/32 million pixels.
Later adapters enforce these before parsing/allocation; full JSON exports above import
cap remain downloadable with an explicit reimport warning. No truncation.

## Migration source decision

`1789300000000-InitialDatabaseFoundation.ts` already creates UUID/board/creator FKs,
nonnegative bigint `through_seq`, schema version, immutable-capture byte storage and
server creation time, plus `IDX_checkpoints_board_created_id (board_id, created_at, id)`.
Entity metadata matches those fields/index. No checkpoint table or index migration is
needed from this source review. Immutability, transactional cap and capture ordering
must be implemented in P7-07; a table alone does not enforce those application rules.
Source receipt support exists; P7-06/P7-07 must confirm each new operation can reuse it.
The historical retention migration finding remains unresolved; no configured inspection
or migration application occurred here.

## Runtime and inherited acceptance

Windows; Node 22.23.2; pnpm 11.24.0; exact workspace Zod 4.6.4, TypeScript 6.0.3,
Vitest 5.0.0. `pnpm-lock.yaml`, dependency pins and runtime protocol version unchanged.
Contracts runner is Node-only: `pnpm.cmd --filter @archboard/contracts test`.
Model/fixtures Node-only selections: `pnpm.cmd --filter @archboard/document-model test`
and `pnpm.cmd --filter @archboard/fixtures test`. API unit selections use the Jest unit
configuration, not integration configuration. Avoid workspace test aggregates.

Inherited audits: [Phase 2](phase-2-editor.md) OPEN (pan/human evidence),
[Phase 3](phase-3-identity-boards.md) historical PASS at its original P3 evidence,
[Phase 4](phase-4-collaboration.md) OPEN (visibility, retention migration, boundaries,
fault/combined preservation), [Phase 5](phase-5-offline.md) OPEN (presence fanout and
combined offline/account/worker evidence), [Phase 6](phase-6-discussion-sharing.md)
OPEN (A11/A19/A20, 32 inherited boundaries and deferred integrated proof).
Phase 6 audit boundary is `824aeee91c39546413730389617eba42bb9fd263`;
Phase 2–5 audit links retain their original evidence/build hashes. None is refreshed by
contracts tests. Authority, queue ordering, account preservation and receipt/migration
gaps bind later Phase 7 acceptance; independent performance gates stay visible.
