# AI-C14 — Scoped edits with field preconditions

Branch: `ai-diagram-integration`.
Parent: `89a8ed5ecba8741866e21bccc461637939c960a0` (AI-C13).
Commit subject: `feat(editor): apply scoped AI edits with preconditions`.
Scope: reviewed scoped proposals, complete candidate preflight, field-aware stale
checks and normal editor mutation/history. AI-C15–AI-C19 remain NOT STARTED.

## Changes and contracts

- Understand selection adds Propose scoped edits alongside explanation and flow
  tracing. It reuses selected-object inclusion, exact reviewed context/history,
  availability, authentication, bounded transport and uncertain request recovery.
  Creating a proposal performs no board mutation. All proposed operations are
  shown with required before values and proposed after values in a separate review
  dialog, with a read-only candidate canvas, full JSON, stable addition IDs,
  explicit Reject/close and explicit Apply. Preview refresh retains addition IDs.
- The existing strict operation allowlist supports adding nodes/edges, renaming
  nodes, labeling edge label/protocol, component properties, code body/language,
  schema body and note body. Duplicate writes to the same existing target field
  are now rejected. Deletes, replacements, reconnection, kind/endpoint changes,
  geometry operations and arbitrary patches remain outside the allowlist.
  Reconnection continues to use the editor's existing replacement-edge semantics
  outside AI; this task introduces no AI replacement operation.
- Prompt/schema versions advance to `ai-prompt-v3` / `ai-schema-v3`; public
  schemaVersion remains 1. Scoped edits use `archboard_edits_v3`, a strict root
  result containing only an edit proposal or clarification. Server instructions
  require exact reviewed preconditions, fresh semantic additions, no authority
  from history, no files/URL fetching/execution and explicit human review. Existing
  request-bound grounding/reference checks run before cache retention; version
  changes invalidate previous exact cache identities.
- Apply compares touched title/content/label/protocol fields against reviewed
  values and checks live immutable node kinds, connection endpoints/handles and
  addition endpoints. Deletion, replacement or changed relevant fields rejects
  the complete proposal. Unrelated geometry, color and other objects' text may
  change without blocking a valid edit; those current fields are preserved. A
  server sequence is never the sole stale check. The preview indicates that its
  canvas is a local snapshot and can be refreshed to inspect unrelated changes.
- Additions receive application-owned UUIDs and existing kind-specific sizes in
  a deterministic bounded grid beside the current graph. New connection handles
  use right/left anchors. Existing reviewed node-binding keys can identify new
  connection endpoints. All physical IDs, including tombstones, fence allocation.
  Addition payloads/mappings must exactly match the reviewed semantic proposal;
  candidate graph validation checks endpoint liveness, references, capacity and
  geometry. No model-provided graph replacement or geometry is applied.
- A full CRDT state copy, including tombstones, is mutated through existing domain
  commands and validated against the accepted document before any live mutation.
  Encoded update/state ceilings and the actual live writer client ID are checked
  again immediately before Apply. Malformed/stale/over-budget candidates do not
  partially mutate the board. No asynchronous work separates this preflight,
  journal write and synchronous command application.
- The normal `EditorSession` writer/editability path performs mutation. Structural
  additions keep their existing structural origin outside generic Undo; existing
  field changes form one ordinary local-edit Undo entry. These are separate normal
  transactions after complete preflight, rather than weakening existing Undo rules.
  Text changes use minimal code-point-safe ranges through `editGraphText`, preserving
  Y.Text identity and unchanged characters. Concurrent unseen inserts converge and
  survive Undo in fixtures; already-received changes to touched fields reject Apply.
  Existing field/property commands, persistence, outbox and committed ACK semantics
  remain authoritative. No graph REST save or alternate Undo system is added.
- The existing deployment/account/board/graph-version Apply journal accepts an
  optional `scoped-edit` kind marker, safe IDs and prepared/applied state. Its
  existing 64-record and byte ceilings remain unchanged. Storage must succeed
  after preflight and before mutation. Any recorded attempt blocks replay, even
  after Undo/reload; an interrupted attempt is conservatively uncertain and needs
  board/persistence inspection instead of automatic reapplication. The recovery
  list distinguishes these records from additive diagram recovery. Prompts,
  history and edit text are not persisted in this journal or shared document.
- Apply rechecks live account/editability/archive/access, active run identity and
  expiry; status distinguishes local application from pending persistence/ACK.
  Explicitly keeping an edit exchange retains exact proposal JSON as private
  conversational data, including after Apply. Each follow-up needs a new reviewed
  current selection and history; old expected values are never authority for a
  later edit. Existing history/message/byte/token limits remain unchanged.
- No provider dependency, migration, database operation, browser session or paid
  provider call was introduced.

## Checks

| Command                                                                                   | Result                                                             |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm.cmd exec vitest run --config scripts/web-node/vitest.config.ts`                     | PASS — 167 tests / 24 Node suites; 13 scoped-edit cases            |
| `pnpm.cmd exec vitest run packages/contracts/src/ai/contracts.test.ts --environment node` | PASS — 47 shared AI contract fixtures                              |
| `pnpm.cmd --filter @archboard/api test --runInBand --testPathPatterns modules/ai`         | PASS — 240 mock-only tests / 15 suites; integration specs excluded |
| `pnpm.cmd typecheck`                                                                      | PASS — workspace source                                            |
| `pnpm.cmd exec tsc -p scripts/web-node/tsconfig.json --noEmit`                            | PASS — final Node fixture source                                   |
| `pnpm.cmd --filter @archboard/web typecheck`                                              | PASS — final frontend source                                       |
| `pnpm.cmd lint`                                                                           | PASS                                                               |
| `pnpm.cmd boundary:check`                                                                 | PASS — 31 AI and 4 Phase 2 forbidden fixtures rejected             |
| `pnpm.cmd --filter @archboard/web build` with process-local HTTPS/WSS fixture origins     | PASS — production assets and service worker; no server/browser     |
| `node scripts/check-ai-layout-assets.mjs`                                                 | PASS — isolated layout/CSP/precache boundaries preserved           |
| `pnpm.cmd format:check` and `git diff --check`                                            | PASS                                                               |

New fixtures cover all allowed field kinds, detached source preservation, stable
new IDs and existing endpoints, received collaborator/local changes, tombstones,
unrelated-field preservation, concurrent unseen inserts/convergence/Undo,
supplementary Unicode, duplicate writes, forged preconditions, unsupported patches,
malformed additions, self-loops, tombstone ID collisions, encoded ceilings and
writer-byte sizing, failed storage, scoped replay barriers including Undo/reload,
private history retention, narrow renderer output and exact cache binding to
current reviewed fields. Mock/unit fixtures do not prove production authorization,
database durability, real collaborative socket behavior or model quality.

## Deferred acceptance and prepared cases

Browser/native-browser/Playwright/served production-preview checks:
**UNRUN (deferred by user)**. Prepare final browser verification to:

1. Review selected context/history, request an edit proposal and inspect every
   before/after field, addition ID, full candidate and commentary. Reject without
   mutation, refresh a preview, then explicitly Apply using the normal writer.
2. Edit a touched field locally or from a collaborator, delete/replace a target or
   endpoint, archive/revoke access, switch account/board, clear the active run or
   expire content between review and Apply. Assert rejection without partial changes.
3. Change unrelated text/geometry/color; preserve it while applying valid touched
   fields. Exercise concurrent text inserts and ordinary Undo/Redo; additions
   remain outside Undo and presenter/awareness/camera state stays unchanged.
4. Double Apply, Undo then Apply, reload after journal preparation and crash between
   structural/field writes or before local persistence completes. Preserve original
   IDs and replay barriers; show uncertain inspection status and never allocate a
   replacement batch automatically. Simulate localStorage quota/unavailability.
5. Exercise encoded/live capacity limits, malformed complete candidates, forbidden
   deletion/reconnection/replacement and unknown references. No accepted subset of
   a rejected proposal may be applied. Verify local/pending/committed ACK status.
6. Keep a proposal exchange before/after Apply and request a fresh reviewed follow-up;
   preserve exact bounded private history with no authority from old preconditions.

PostgreSQL/Neon/database-backed HTTP/auth/session/socket/schema/migration verification:
**UNRUN (deferred by user — until Version 1 implementation is complete)**.
Existing prepared AI and sync integration fixtures remain unexecuted. Final
verification must cover scoped-edit creation/read/events under current authority,
actor/board cache isolation with changed preconditions/history, encrypted content
retention and real writer/outbox/collaborative convergence/committed ACK/reload.
Acceptance gates and the original Version 1 release gate remain **OPEN**.

Live model compatibility, grounding/operation quality, latency and cost:
**UNRUN (requires separately authorized operator budget and reviewed inputs)**.

## Handoff

AI-C14 implementation is delivered. It does not establish the original M00–M08
implementation-completion trigger or close browser/database/live-provider proof.
No push, merge, deployment, migration or paid request was performed.

Next: [AI-C15 — presentation proposals and recruiter guidance](https://github.com/Shreyas2121/archboard/blob/37b663661045f8fe6cbed7db265141b84131718e/guide.md#ai-c15--presentation-proposals-and-recruiter-guidance).
Preserve field-aware stale checks, normal command/history semantics, stable IDs,
scoped replay barriers, private conversations/highlights, operator admission/cache/
accounting and committed ACK behavior. Resolve this evidence's introducing commit
in the next index update.
