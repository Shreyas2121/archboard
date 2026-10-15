# Separate database relationships and storage infrastructure

October 14, 2026. Working-tree implementation following review of the supplied
`archboard.project-context.json` and `archboard-Project5.png`.

## Delivered behavior

- Project JSON now offers **Database relationships** and **Storage infrastructure**
  as separate extraction types. The existing `database` value remains accepted;
  the additive `storage` value is accepted by the shared version-1 contract.
- Database extraction asks for meaningful entities, important join tables and
  supported relationships. Infrastructure extraction asks for stores and verified
  service/worker access flows. Both have matching, parser-valid JSON examples.
- The prompts request concise labels and actual evidence for constraint/delete,
  policy, encryption and vector/index claims. Missing proof belongs in unknowns;
  stores sharing a provider do not receive an invented connecting edge.
- The two prompts produce `archboard.database-context.json` and
  `archboard.storage-context.json`. Other extraction types retain the original
  default filename. The prompt card displays the selected filename.
- The selector is explicitly labeled **Diagram type for extraction**. Its help
  states that each file is imported separately and changing the selector does not
  filter a loaded file or modify a board. Import continues to preserve the file's
  complete graph; legacy mixed files remain compatible.
- Legacy inactive AI focus helpers recognize the additive value for type and
  review compatibility. Hosted AI is still absent from active runtime/bundles.

## Supplied context partitions

The original JSON was not rewritten. Its SHA-256 remains
`67b4eb8212d68c2e2f46e4754d2ea7aba0f29e4a852f73116327d5ee745858fc`.

Two importable files partition its known entity/store keys, preserving intra-view
connections, relevant groups and referenced evidence:

| File                              | Cards | Connections | Groups | Offline SVG                                                     |
| --------------------------------- | ----: | ----------: | -----: | --------------------------------------------------------------- |
| `archboard.database-context.json` |     9 |          13 |      3 | [4074 × 720](project-context-separated-database-2026-10-14.svg) |
| `archboard.storage-context.json`  |     2 |           0 |      1 | [504 × 604](project-context-separated-storage-2026-10-14.svg)   |

Database file SHA-256:
`590cdb2b1b664925a5020ddb4d245a4f772b91093144383745e995a90d76996f`.
Storage file SHA-256:
`faf83ed131e74699e18d1f209f8b673aeb4724301bd29e08b36040a9eeb8e1f3`.

The database copy retains the original relationship descriptions and claims,
including combined-table cards and relationships whose foreign-key/delete proof
is incomplete. Its unknowns call out that limitation. These copies are partitions
of supplied material, not new analysis of the Citeleaf repository. The storage
descriptions omit unsupported encryption/RLS/index details and its unknowns list
missing evidence. Its two stores remain disconnected because no verified
store-to-store or service-access flow was supplied for that isolated view.

An offline disposable Node probe passed both files through the actual bounded
parser, direct mapping, installed ELK engine, full document preflight, private-board
import schema and controlled SVG renderer. It preserved all scoped graph counts
and produced the linked artifacts. The probe was removed afterward. A fixture-root
path error in its first run was corrected before the successful run.

These artifacts demonstrate separation, not a completed schema audit or rendered
acceptance. The relationship view remains wide because it retains the supplied
topology and verbose labels. Regenerate against the target source with the new
focused prompt to improve evidence and scope further.

## Verification

| Check                                                    | Result                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------- |
| Focused frontend Node suites                             | PASS — 37 tests across four files                                      |
| Shared context/legacy contract Node suite                | PASS — 48 tests, including all focus values and absent legacy metadata |
| Both separated files through actual local import/export  | PASS — disposable Node probe                                           |
| Workspace and Node verification type checks              | PASS                                                                   |
| Focused ESLint and Prettier                              | PASS                                                                   |
| Dependency boundaries, including negative fixtures       | PASS                                                                   |
| Shared contract build and production web build           | PASS                                                                   |
| Production worker/CSP/precache and retired-AI asset scan | PASS                                                                   |
| Diff whitespace                                          | PASS                                                                   |

The production build initially could not resolve its installed Terser dependency
inside the sandbox. The approved build outside the sandbox completed, including
PWA generation and the static asset check. The existing large-chunk warning remains
(main bundle approximately 1350.96 kB raw / 413.02 kB gzip).

Relevant commands:

```text
pnpm.cmd --filter @archboard/contracts build
pnpm.cmd exec vitest run --config scripts/web-node/vitest.config.ts project-context ai-diagram-focus ai-local-context-prompt
pnpm.cmd exec vitest run src/ai/contracts.test.ts              # cwd packages/contracts
pnpm.cmd typecheck
pnpm.cmd exec eslint <changed TypeScript files>
pnpm.cmd exec prettier --check <changed source/docs/JSON files>
pnpm.cmd boundary:check
pnpm.cmd --filter @archboard/web build                        # HTTPS/WSS test origins
node scripts/check-ai-layout-assets.mjs
git diff --check
```

Browser acceptance for select/file/clipboard interactions, preview rendering,
accessibility, viewport fitting and persisted board behavior:
**UNRUN (deferred by user)**.

Database-backed import/auth/session/socket checks, PostgreSQL/Neon integration
tests and live schema/migration inspections:
**UNRUN (deferred by user — until Version 1 implementation is complete)**.
No database or provider request was made. Browser/database and phase/release
acceptance gates remain **OPEN**.
