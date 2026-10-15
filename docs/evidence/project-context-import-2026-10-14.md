# Local project-context import and hosted AI retirement

October 14, 2026. Working-tree implementation; earlier recovery/layout changes
remain in place. No commit, push, deployment or database operation is part of this
change.

## Delivered behavior

- **Project JSON** replaces the AI assistant in the editor toolbar. It works in the
  local demo and editable server boards, including normal offline editing where
  the board/session permits it. Readers, narrow read-only views and unavailable
  editing cannot apply imports.
- Retain five diagram-focus options and optional extraction instructions. The
  copied prompt asks the user's own coding assistant to inspect the target project
  and produce the existing version-1 JSON format. Its final steps now describe
  local import rather than a second cloud generation request.
- File parsing, semantic/reference validation and automatic layout run locally.
  Every supplied component, connection and nonempty group becomes a card, directed
  edge or boundary. Descriptions and labels are preserved, without model rewriting
  or inferred relationships. Legacy files without `diagramFocus` remain accepted.
- The local importer accepts the context contract's full 100-component,
  200-connection and 20-group budgets instead of the former model output's
  40-node/80-edge/10-boundary ceiling. The worker receives topology and sizes only,
  has a five-second deadline and returns a complete grid fallback on failure.
- A separate interactive preview and full context review precede explicit Add.
  Its own React Flow provider isolates node/edge/viewport state from the editor;
  a Node SSR regression checks distinct real provider stores with only the DOM
  canvas stubbed. An unwrapped control verifies the test detects inherited state.
  Existing content remains, imports use fresh IDs, and the canvas moves to the
  added diagram. Changes to the reviewed graph invalidate Apply; access changes
  clear private state and cancel work. Repeated clicks cannot append the same
  prepared batch after its IDs have been created.
- Detached full-Y.Doc preflight includes existing objects, tombstones, capacity,
  encoded state and update limits. Apply repeats preflight with the actual writer
  ID before the existing structural domain command. No partial batch, direct
  React Flow mutation or second graph state store is introduced. Normal toolbar
  status owns device-saving versus committed server-saving feedback.
- Dashboard **Import JSON** accepts both portable board exports and project context.
  Context is laid out locally and converted to a portable envelope for the existing
  authenticated private-board import and immutable receipt/retry flow. Its file
  label is `local-only`, never a claim of server commitment. Default title and
  description respect board metadata limits; users can review the title before
  creation. Full evidence/constraints remain in the original context file, while
  the board stores diagram fields.
- The main editor no longer mounts any hosted AI panel. The API no longer registers
  AiModule, its controllers, providers, admission or maintenance runtime. OpenAPI
  no longer advertises hosted AI operations or response schemas. Old environment
  settings cannot reactivate it or impose model/credential configuration requirements.
- Legacy AI source, unit fixtures, contracts, database entities and migration history
  remain dormant as agreed. The common local layout/preflight code is reused through
  compatibility exports by old isolated fixtures. No stored AI records are read,
  decrypted, deleted or migrated. No provider call was made.
- Remove obsolete AI setup fields from `.env.example`; set existing local
  `AI_ENABLED` entries to false without displaying credentials or changing unrelated
  values. Update the home copy, README, usage/setup and portfolio walkthrough.
  Retired AI guides/plan are labeled as legacy references. Historical evidence is
  unchanged. No dependency was added.

The active workflow is documented in [Project JSON](../project-context.md).

## Supplied-file check

Read `archboard.project-context.json` without modifying it. SHA-256:
`3422556f5eb4f0eee212a5614a701dfd777b77a5946f527b7048210a524bc249`.

A disposable Node probe ran the actual context parser, direct mapping, installed
ELK engine, CRDT preflight, private-board import schema and controlled SVG renderer.
It was removed afterward; permanent synthetic tests cover the reusable behavior.

- Eleven cards, all 22 connections and all four groups preserved.
- All 22 connections routed; zero route segments intersected card interiors.
- Eighteen visible captions fit cleanly. Four lacked a clear caption rectangle;
  their full text remains available through normal edge inspection/hover.
- Observed preflight: 14,850 update bytes, 14,881 total state bytes. These are
  measurements for this run, not a fixed size guarantee.
- [Controlled SVG artifact](project-context-import-2026-10-14.svg): 4,204 × 918 pixels.
  This is an offline export from the supplied JSON, not a browser screenshot or
  live model result. Dense graphs can retain wire crossings.

## Verification

| Check                                                                  | Result                                                                                            |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Frontend Node suites                                                   | PASS — 241 tests across 32 files, including 14 direct-import tests and one preview-isolation test |
| Shared context/legacy AI contract Node suite                           | PASS — 48 tests                                                                                   |
| API root composition, config, OpenAPI and isolated legacy-module units | PASS — 52 tests across five suites; no application/database startup                               |
| Supplied-file disposable Node probe                                    | PASS                                                                                              |
| Workspace typecheck, including Node verification sources               | PASS                                                                                              |
| Production web/shared builds and API build                             | PASS                                                                                              |
| Focused ESLint and Prettier                                            | PASS                                                                                              |
| Dependency boundaries and negative fixtures                            | PASS                                                                                              |
| Static production worker/CSP/precache and retired-AI bundle scan       | PASS                                                                                              |
| Public source/build secret scan                                        | PASS — 370 files                                                                                  |
| Diff whitespace                                                        | PASS                                                                                              |

The production bundle emits only the active project-layout worker and native ELK
engine. The static check asserts `/ai/runs`, `/ai/availability` and `AI assistant`
are absent from the public main bundle; it also checks worker isolation, size,
references, CSP and precaching. The existing large-chunk build warning remains.
The build used approved execution outside the sandbox to read its installed
minifier dependency.

Relevant commands:

```text
pnpm.cmd exec vitest run --config scripts/web-node/vitest.config.ts
pnpm.cmd exec vitest run src/ai/contracts.test.ts             # cwd packages/contracts
node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.config.cjs --runInBand --runTestsByPath src/app.module.spec.ts src/platform/config/api-config.spec.ts src/platform/http/openapi.spec.ts src/modules/ai/provider.spec.ts src/modules/ai/persistence-composition.spec.ts
                                                             # cwd apps/api
pnpm.cmd typecheck
pnpm.cmd --filter @archboard/api build
pnpm.cmd --filter @archboard/web build                         # HTTPS/WSS test origins
pnpm.cmd boundary:check
node scripts/check-project-layout-assets.mjs
pnpm.cmd --filter @archboard/api security:scan
```

Browser/manual acceptance for file selection, clipboard, dialog/focus/keyboard,
stale-preview UI, repeated-click behavior, viewport fitting, rendering at different
zoom levels, reload durability and offline demo: **UNRUN (deferred by user)**.
Do not substitute the numeric geometry/Node result for rendered acceptance.

Database-backed authenticated HTTP/session/socket checks, real private-board import
and committed synchronization, PostgreSQL/Neon tests and schema/migration checks:
**UNRUN (deferred by user — until Version 1 implementation is complete)**. Runtime
HTTP retirement is established here by composition/OpenAPI units, not a live server
probe. Browser/database and original phase/release acceptance gates remain **OPEN**.

Restart running development/API processes to load the new composition. Use
**Project JSON** in the editor or dashboard **Import JSON** with the existing file.
