# Focused fix — Portable creation routes and response envelopes

Commit subject: `fix(portability): align creation routes and response envelopes`
Commit: mapped in final evidence index; do not amend solely for self-hash.
Parent: `c58458c2aa6ab51c3e7b0e30409b03c7cedfc9b6`
Branch: `phase-7-presentation-portability`
Environment: Windows, Node 22.23.2, pnpm 11.24.0. Database/browser runtime UNRUN.

## Introducing and exposing commits

P7-06 `27537c2988ce3fa247f7d18af28cd4fecc5629cd` exposed import under
`/api/v1/boards/import`, whereas `plan.md` section 13 and `phase7.md` section 12.1
specify `/api/v1/imports`. Source comparison during P7-07 identified this discrepancy.
P7-06 import and P7-07 `c58458c2aa6ab51c3e7b0e30409b03c7cedfc9b6` checkpoint restore
passed an internal `BoardDetail` into a strict summary response schema. A new controller
unit failed with the unknown `memberCount` key; the response would be unavailable in
actual HTTP handling. Earlier service/worker units did not exercise that serialization
boundary; real HTTP acceptance had remained deferred.

## Smallest correction

Register the canonical authenticated `/api/v1/imports` controller and remove the incorrect
board-scoped import route. Update the existing bounded UTF-8 import parser path, OpenAPI,
route assertions and prepared HTTP tests together. Creation delegates to the unchanged
BoardService import/receipt/fresh-initialization path. No request contract or security
rule is substituted and no specification amendment is necessary.

Map internal details explicitly to the documented summary DTO before strict import/restore
response validation. The mapper copies metadata and removes only detail-only `memberCount`;
it validates the remaining summary without mutating the original object. Blank/committed
duplicate APIs continue returning their existing detail envelopes. New controller units
assert canonical route metadata, validated actor/key/body delegation, strict response
serialization, retained original detail and rejection of invalid keys/authority injection.

No migration, dependency, graph protocol, checkpoint bytes, transaction/permission/cap/
receipt behavior or frontend source changed. P7-08 should consume `/api/v1/imports` and
`POST /api/v1/boards/:id/checkpoints/:checkpointId/duplicate` for restore-as-new.

## Checks

- From `apps/api`, `node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.config.cjs --runInBand imports.controller.spec.ts checkpoints.controller.spec.ts product-http.spec.ts openapi.spec.ts portability.spec.ts checkpoint-service.spec.ts`
  — PASS, 6 suites / 22 tests, 4.576 s, no database, HTTP server or browser.
  Initial controller run had 20 PASS / 1 FAIL, exposing the strict `memberCount` defect;
  the mapper correction and checkpoint regression now pass.
- `pnpm.cmd --filter @archboard/api build` — PASS, about 8 s.
- `pnpm.cmd --filter @archboard/api typecheck` — PASS, about 8 s, including prepared tests.
- `pnpm.cmd lint` — PASS, about 10 s. Initial relocation left two unused imports;
  removed and subsequent build/types/lint passed.
- `node node_modules/prettier/bin/prettier.cjs --check .` — PASS, all matched workspace files, about 12 s.
- `git diff --check` and `git diff --cached --check` — PASS before commit.

The P7-07 Node queue/worker/in-memory transport proof remains 8 suites / 71 tests PASS;
this focused fix changes controller route/serialization only. `pnpm.cmd boundary:check` — FAIL, exactly 32 inherited findings, no new controller finding; 4 negative fixtures PASS. The inherited dependency
boundary findings remain OPEN, with no checker weakening.

## Deferred boundaries and evidence effect

From `apps/api`, after all M00–M08 implementation:
`pnpm.cmd test:integration -- boards.integration-spec.ts board-persistence.integration-spec.ts`
— **UNRUN (deferred by user — until Version 1 implementation is complete)**.
Prepared import/restore cases use the canonical routes and documented summaries, preserving
the private owner/sequence/fresh-ID/rollback/cap/replay/denial assertions. Use isolated test
schemas on reviewed paired connections. Configured database/schema/migration checks and
database-backed socket/session regressions retain the same deferral.

Browser file/recovery/direct-route/account-cache/A16 acceptance remains
**UNRUN (deferred by user)** and belongs to P7-08/integrated verification. No database or
browser test was executed. Historical P7-06/P7-07 evidence is retained at its original
boundary; this fix resolves the P7-07 recorded import-route gap and adds serialization
proof without claiming PostgreSQL, browser or phase/release acceptance. All inherited
Phase 2–6 gates and full Phase 7 acceptance remain OPEN. No push/merge/deployment occurred.

## Next

P7-08 — checkpoint and JSON portability UI can consume the corrected creation boundary.
