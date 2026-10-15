# AI-C11 — Bounded diagram drafts and deterministic layout

Implemented on `ai-diagram-integration` with subject
`feat(editor): map AI proposals to bounded diagram drafts`. Parent:
`9d6c96cf9a007de62cded23ea7b19ff53ff49a48` (AI-C10); its parent is
`23b33910694028fefbd6f3d72c009dcf16d6926e` (AI-C09). AI-C01 dependency:
`b57d165fdf9d671050bdb691ee108dc907a1583d`.
Resolve this evidence's introducing hash after commit using the index command.
AI-C12–AI-C19 and optional AI-X01 remain **NOT STARTED**. Acceptance stays **OPEN**
under the [verification policy](../../verification-policy.md).

## Delivered behavior

- Strict size-bounded proposals map semantic keys to fresh application UUIDs in
  stable order. Allocation checks all existing entity/tombstone roots and new IDs.
  One map binds nodes, edges, group boundaries and ordered step references. Model
  UUIDs, coordinates, dimensions, handles and parent IDs are rejected. Content,
  categories, technology, legal colors and edge properties preserve the shared
  contracts; application defaults supply sizes and gray background boundaries.
- Connection handles follow relative centers. Groups enclose their members with
  padding and never become parent nodes. Step viewports include highlighted edge
  endpoints, or the whole draft when empty. Finite coordinates/extents, exact node
  preservation, non-overlap and legal enclosing rectangles bound layout output.
- `elkjs` **0.12.0** is pinned through the existing catalog/lockfile. The
  [maintainer release](https://github.com/kieler/elkjs/releases/tag/0.12.0) and
  [official documentation](https://github.com/kieler/elkjs#usage) were reviewed.
  Its bundled layered engine supports topology and seeded deterministic layout
  without remote runtime assets or another worker dependency. The package uses
  EPL-2.0 with GPL-3.0-or-later as a secondary license. Installation adds one
  package with no runtime dependencies; no unrelated package upgraded.
- A Vite same-origin module worker receives bounded keys/topology/dimensions only,
  excluding prompt, titles, bodies, evidence, commentary and graph UUIDs. Stable
  ordering and a fixed seed make the pinned engine repeatable. Failure/invalid
  geometry/timeout yields a complete deterministic grid with honest status/reason.
  Success/error/message error/abort/five-second timeout terminate the worker and
  remove handlers/listeners/timers. Abort rejects without a draft; late callbacks
  cannot win. ELK's in-process shim has no terminate method: cleanup terminates
  the outer real worker instead. Replies contain geometry or a fixed failure flag
  without engine diagnostics; no provider content is logged.
- Preparation copies bounded full CRDT state including history and tombstones.
  Normal commands run on a detached candidate. Physical validation against the
  accepted snapshot, complete projected live capacity, one-MiB incremental update
  and ten-MiB full-state budgets must pass. Temporary documents are destroyed in
  finally blocks. Source documents never mutate or emit updates, including failures.
- The AI panel adds explicit local **Prepare diagram draft** after a retained
  diagram result. A read-only editor snapshot feeds preparation; counts/layout
  readiness are shown without board mutation, cloud requests or persistence.
  Drafts stay private React state. Proposal/revision changes invalidate readiness;
  unmount/proposal/revision changes abort work. Access and result expiry are checked
  again before accepting replies. Preview/Apply remain C12 work.

## Checks

| Check                                                                                     | Result                                                                       |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| All Node-only fixtures: `pnpm exec vitest run --config scripts/web-node/vitest.config.ts` | PASS — 128 tests, 21 suites                                                  |
| Final changed draft/layout Node fixtures                                                  | PASS — 17 tests, 2 suites, including factory-time cancellation               |
| `pnpm typecheck`                                                                          | PASS — workspace and Node fixture source; no integration execution           |
| `pnpm lint`                                                                               | PASS                                                                         |
| Final production web build with process-local HTTPS/WSS fixture origins                   | PASS — includes frontend types, worker and service worker; no served preview |
| `node scripts/check-ai-layout-assets.mjs`                                                 | PASS — worker isolation/reference/asset bound/CSP directive/precache         |
| Generated HTML CSP and public source/bundle secret scans                                  | PASS                                                                         |
| `pnpm boundary:check`                                                                     | PASS — 31 AI and 4 Phase 2 forbidden fixtures rejected                       |
| `pnpm format:check`, staged/unstaged whitespace checks                                    | PASS                                                                         |

Fixtures cover all content kinds, remapping/ID freshness, stable ordering, group/
step geometry, malformed references/model geometry/self edges, invalid/missing/
duplicate/overlapping/nonfinite/out-of-bounds positions, live capacity across all
entity kinds, invalid physical state, tombstones, encoded budgets, source
immutability, aborted preparation, late callbacks and worker cleanup/fallback.
The real pinned engine runs repeatably in Node with a cycle/disconnected node and
forty-node layouts; no browser worker or mounted UI ran.

The emitted worker is about **1.55 MB**, below the existing 2,097,152-byte per-asset
precache ceiling; the shell has **137** precache entries. CSP/cache policy is
preserved. The existing large-chunk advisory remains. Builds use approved access
outside the sandbox for Workbox's installed minifier. No environment file changed.
Initial engine cleanup/type/lint fixture findings were fixed and affected checks
rerun; failed checks do not substitute for deferred acceptance.

## Deferred acceptance and handoff

- Browser worker execution/termination under CSP, layout readability, focus,
  transitions during preparation and offline worker/shell cache behavior:
  **UNRUN (deferred by user)**. Static/Node fixtures do not establish browser proof.
- PostgreSQL/Neon/database-backed HTTP/auth/session/socket/schema/migration checks:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
  Existing prepared integration fixtures remain unexecuted. No database command
  or diagnostic ran.
- Live compatibility, quality, latency and cost evaluation:
  **UNRUN (requires separately authorized operator budget and reviewed inputs)**.

AI-C11 implementation is delivered. Browser/database/live-provider and original
Version 1 release gates remain **OPEN**. No push, merge, deployment, migration or
paid provider request was performed.

Next: [AI-C12 — preview and additive Apply](https://github.com/Shreyas2121/archboard/blob/37b663661045f8fe6cbed7db265141b84131718e/guide.md#ai-c12--preview-and-additive-apply),
depending on this introducing commit. Reuse `prepareAiDiagramDraft` for detached
preview; show all counts/commentary, including steps and fallback status. Capture
target/preconditions and recheck authority/archive/expiry, IDs, capacity and encoded
budgets immediately before Apply. Persist a distinct stable Apply intent/ID map in
the existing account/board namespace before normal domain-command mutation. Use
offline persistence and committed ACK semantics; repeated clicks/recovery must not
remap or silently duplicate a batch. C11 preflight is preparation evidence, not
authorization or durability proof for later Apply. Preserve reviewed creation
identity, neutral provider boundaries and both verification deferrals.
