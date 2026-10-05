# AI-C12 — Preview and additive Apply

Branch: `ai-diagram-integration`.
Parent: `889bc95c4ac7cf87fc37af5ce182b8c60e3f176d` (AI-C11).
Commit subject: `feat(editor): preview and apply additive AI diagrams`.
Scope: isolated proposal review, additive editor mutation, stable local Apply recovery,
and authorized new-private-board import. AI-C13–AI-C19 remain NOT STARTED.

## Changes and contracts

- A dedicated read-only React Flow instance reuses existing card and boundary
  renderers, with no editor selection store, Y.Doc, awareness, presenter or sync
  bindings. The dialog shows all four entity counts, layout/fallback status,
  explanation, assumptions, questions, complete graph and claims. Discard changes
  no board. Generated diagrams are placed beside the existing graph by default.
- Apply captures the reviewed projection and rechecks current account scope,
  editability, role/archive/access state, result expiry and projection identity.
  It checks immutable IDs, current full-state validity, live capacity and encoded
  update/state ceilings before mutation. Apply-time preflight uses the actual
  writer client ID to avoid undercounting variable-width CRDT identifiers.
- One structural transaction wraps existing graph and presentation-step commands
  through `EditorSession` and its existing writer/persistence/outbox path. Existing
  objects remain intact. Structural additions remain outside Undo; existing
  delete/restore is the subsequent editing path. No graph REST save or replacement
  protocol is introduced.
- A synchronous localStorage journal uses the existing deployment/account/board/
  graph-version namespace key, outside Y.Doc. The original semantic-to-UUID map
  must persist before mutation; a failed write blocks Apply. Double Apply and
  reload recovery recognize the same IDs, including tombstoned objects. Partial
  recovery and fresh-ID collisions fail without allocating a replacement batch.
  Completion is recorded after the existing local writer becomes idle; a crash
  before that record recovers from immutable IDs instead. Status distinguishes
  local mutation, pending persistence and committed server acknowledgment.
- The journal retains at most 64 proposal intents per board and 1,048,576 JSON
  characters; an outstanding import body is at most 524,288 characters. Capacity
  pressure blocks new intents instead of evicting replay barriers. Safe applied
  metadata is retained, so the 64-intent limit is a deliberate per-board lifetime
  limit in this implementation. Browser storage/quota errors block new mutation.
- New-private-board creation reuses the existing `/imports` authorization,
  validated portability envelope, idempotency key, account authentication,
  receipt window, unknown-outcome classification, inspection and navigation.
  Optional persistence was added to the existing creation hook. The exact reviewed
  body/key are retained before submission. Reload changes pending to uncertain;
  only explicit identical retry is allowed. Confirmed creation stores the new
  board ID and drops the body. Expired import bodies are removed on the next
  journal read after 24 hours; safe unknown-outcome metadata remains. Expiry never
  automatically submits a new request.
- The private recovery view restores recorded run IDs via authorized GET, or
  previews/retries an outstanding original import directly after result expiry.
  Run recovery never calls model creation. Outstanding import recovery can resume
  within its original receipt window under current account/board authority, since
  its body was already reviewed. Conversations/prompts remain session-only and
  do not enter the journal or shared graph. The retained import body contains the
  reviewed generated graph in local browser storage, scoped to its original account.
- Server-owned provider/admission/cache/budget infrastructure and public contracts
  are unchanged. No paid provider call, database operation or browser was run.

## Checks

| Command                                                                                                                                                                       | Result                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `pnpm.cmd exec vitest run --config scripts/web-node/vitest.config.ts`                                                                                                         | PASS — 142 tests / 22 Node suites before the final two substantive cases      |
| `pnpm.cmd exec vitest run --config scripts/web-node/vitest.config.ts scripts/web-node/features/editor/ai scripts/web-node/features/editor/application/editor-session.test.ts` | PASS — final 48 tests / 4 suites, including recovery authority guards         |
| `pnpm.cmd exec vitest run --config scripts/web-node/vitest.config.ts scripts/web-node/features/editor/ai/ai-apply-intent.test.ts`                                             | PASS — final 12 cases including exact writer byte sizing and journal capacity |
| `pnpm.cmd typecheck`                                                                                                                                                          | PASS — workspace and Node test source                                         |
| `pnpm.cmd --filter @archboard/web typecheck` and `pnpm.cmd exec tsc -p scripts/web-node/tsconfig.json --noEmit`                                                               | PASS — frontend typecheck and final Node fixture tsc check                    |
| `pnpm.cmd lint`                                                                                                                                                               | PASS                                                                          |
| `pnpm.cmd boundary:check`                                                                                                                                                     | PASS — 31 AI and 4 Phase 2 forbidden fixtures rejected                        |
| `pnpm.cmd --filter @archboard/web build` with process-local HTTPS/WSS fixture origins                                                                                         | PASS — production assets and service worker; no served preview                |
| `node scripts/check-ai-layout-assets.mjs`                                                                                                                                     | PASS — bounded isolated layout worker, references, CSP and precache           |
| `node scripts/check-phase5-cache-policy.mjs`                                                                                                                                  | PASS — 137 static precache entries, protected routes excluded                 |
| `pnpm.cmd format:check` and `git diff --check`                                                                                                                                | PASS                                                                          |

Node fixtures prove persist-before-mutation, repeated Apply, reload and deletion
recovery, account/access/writer/stale-projection rejection, storage failure, fresh
ID conflicts, malformed late-step atomic rejection, partial recovery, exact
CRDT byte sizing, journal capacity, namespace isolation, import body/key retention,
receipt expiry, confirmed new-board identity, no fresh inference on recovered run,
and late reply fencing. Editor-session fixtures verify routing through the writer,
one structural local update, existing-graph preservation, Undo exclusion, revoked/
archived rejection and save-state calculation. The fake writer/sync ACK tests do
not prove real IndexedDB outbox durability, collaborative delivery or server ACKs.

Initial fixture/layout and readonly-array type findings were corrected. The first
production build could not resolve installed Workbox/Terser inside the sandbox;
the approved-access rerun passed. The existing large-chunk advisory remains.
Intermittent sandbox executable-resolution failures were rerun with approved
access. No environment file, dependency or verification aggregate changed.

## Deferred acceptance — prepared scenarios

All browser cases below are **UNRUN (deferred by user)**. Resume only when the user
explicitly restores browser verification. Use the existing authenticated editor/
portability browser harness with a fixture AI run; do not require live inference.

1. Open a retained diagram, review counts/claims/assumptions/questions, pan/zoom the
   isolated preview, check keyboard dialog focus and discard. Assert source Y.Doc,
   awareness and collaborators' viewports/selections did not change.
2. On an owner/editor board with existing content, apply once, double-click and
   retry. Assert one additive update/batch, original graph preserved, no structural
   Undo, all node/edge/boundary/step references valid and a normal pending outbox.
3. Disconnect before Apply. Observe local persistence and pending acknowledgment;
   reconnect and await the real committed ACK before the UI reports server saved.
   A second authenticated browser must receive exactly the same created IDs.
4. Crash/reload after intent persistence before mutation, after mutation before
   local update persistence, and after local persistence before completion metadata.
   Recover from the journal without fresh IDs or a second batch. Delete generated
   objects and recover again: tombstones must prevent recreation.
5. Change account, revoke membership, archive the board, lose the writer lock,
   expire the result or edit the graph between preview and Apply. Assert rejection,
   private-state isolation and no graph mutation. Inject fresh-ID conflicts,
   partial IDs, full capacity, encoded ceilings and storage failure.
6. Create a private board from a reviewed preview. Assert the source remains
   unchanged and creation uses `/imports`. Drop the response, reload and explicitly
   retry the same key/body; check one new board, retained unknown outcome, and no
   automatic new request on reconnect. Expire the receipt and inspect results
   before any explicit replacement submission. Verify confirmed identity prevents
   a second creation from the same proposal and account transition fences replies.

PostgreSQL/Neon/database-backed HTTP/auth/session/socket/schema/migration verification:
**UNRUN (deferred by user — until Version 1 implementation is complete)**.
Existing prepared API integration fixtures remain unexecuted. Real collaborative
Apply/ACK, authorized imports and durable receipt/graph reload proof stay OPEN.

Live model compatibility, quality, latency and cost evaluation:
**UNRUN (requires separately authorized operator budget and reviewed inputs)**.

## Handoff

AI-C12 implementation is delivered; browser/database/live-provider and original
Version 1 release acceptance remain **OPEN**. The first C00–C12 implementation
slice does not establish a verified release or the original M00–M08 completion
trigger. No push, merge, deploy, migration or paid request was performed.

Next: [AI-C13 — grounded guidance](../../../guide.md#ai-c13--grounded-explanations-questions-and-private-guidance),
depending on the introducing AI-C12 commit. Preserve stable Apply identity,
review-before-mutation, private account namespaces and committed ACK semantics.
Resolve this task's introducing hash in the next evidence index update.
