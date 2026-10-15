# AI-C15 — Presentation proposals and recruiter guidance

Branch: `ai-diagram-integration`.
Parent: `2908c26ffe07ca6aed1c95e875ef9af8033f0ba4` (AI-C14).
Commit subject: `feat(ai): propose reviewed architecture presentation steps`.
Scope: reviewed presentation proposals, bounded semantic mapping and normal
presentation commands. AI-C16–AI-C19 remain NOT STARTED.

## Implementation

- Understand selection adds Recruiter walkthrough with explicit append (default)
  and replace-reviewed modes. Append sends only the selected graph subset.
  Replacement explicitly includes every current step, its notes/rectangle/references
  and all referenced live cards/connections/endpoints in the cloud review. Missing
  references or context ceilings reject review rather than silently dropping data.
  Boundaries and unrelated cards remain excluded. The existing exact private history,
  reviewed creation intent, bounded transport, authentication and uncertain-request
  recovery paths are reused.
- The optional public `presentationMode` field is accepted only for presentation
  requests; omission means append. Request-bound validation requires matching result
  mode, empty append preconditions or every reviewed replacement step ID, unique
  keys/references and only reviewed node/edge UUIDs. Existing step count, title,
  notes, reference, result-byte and history ceilings remain authoritative.
  Prompt/schema versions advance to `ai-prompt-v4` / `ai-schema-v4`, invalidating
  earlier exact cache identities. Public schema version remains 1. The strict
  `archboard_presentation_v4` root permits only presentation or clarification.
  Server instructions distinguish declared/evidenced/proposed statements, deny
  files/URL fetching/tools and authority from history, and never claim saved steps,
  observed runtime behavior or proven security.
- Application-owned fresh UUIDs map semantic step keys; proposal array order defines
  ordered steps. IDs cannot collide with any physical object or tombstone. Append
  orders follow the current maximum; replacement starts at zero. Bounded viewport
  rectangles are derived from reviewed card geometry and referenced connection
  endpoints with existing padding. Empty references frame the complete reviewed
  subset. The model cannot supply numeric order or rectangles. Refresh preserves
  original mapped IDs and rejects changed target geometry/content/references.
- Prepare mutates a detached full CRDT state through existing presentation commands,
  validates the transition against the accepted state, and checks the complete graph,
  live-step capacity and encoded update/state ceilings. It leaves the live document
  unchanged. The separate review dialog shows a read-only candidate canvas, ordered
  titles/notes, exact references/rectangles, every old replacement step, full JSON,
  mapping and byte sizes. Reject/close makes no durable mutation.
- Apply preflights again with the actual writer client ID, compares every referenced
  live node and edge with reviewed semantic/geometry fields, and rejects deletion,
  changed targets, invalid geometry/order or exceeded capacity before recording
  intent. Replacement compares the complete reviewed step set and all fields with
  current steps; additions/deletions/text/order/rectangle/reference changes reject
  the replacement. Append preserves unrelated edits and existing steps. A changed
  maximum order requires explicit candidate refresh.
- The existing EditorSession writer performs one normal structural transaction:
  tombstone reviewed old steps for replacement, then create mapped steps. It retains
  existing structural Undo policy, local persistence, outbox and committed ACK
  semantics. No alternative graph persistence or presenter command is added.
  Status states local application and pending persistence/ACK honestly.
- The bounded deployment/account/board/graph-version Apply journal adds a presentation
  marker and safe IDs. Storage must succeed before mutation. Any recorded attempt
  blocks automatic replay, including reload and uncertain persistence; recovery
  requires inspecting normal saved steps. Account, editability/archive/access,
  active result identity and expiry are checked through existing session guards.
  Exact proposal JSON can be retained explicitly as private follow-up data, never
  authority for another replacement.
- Private per-step highlights use the existing ephemeral UI store and scope/revision
  guards. They do not mutate selection, awareness, document, camera or presenter
  state; stale/scope changes clear or suppress them. Existing presenter/follow
  permission and participation behavior is unchanged. No provider call, dependency,
  migration or database operation was introduced.

## Checks

| Command                                                                                   | Result                                                                                                                      |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd exec vitest run --config scripts/web-node/vitest.config.ts`                     | PASS — 183 tests / 25 Node suites; 14 presentation cases and same-board/auth review cases for presentation and scoped edits |
| `pnpm.cmd exec vitest run packages/contracts/src/ai/contracts.test.ts --environment node` | PASS — 47 shared AI fixtures                                                                                                |
| `pnpm.cmd --filter @archboard/api test --runInBand --testPathPatterns modules/ai`         | PASS — 243 mock-only tests / 15 suites; integration specs excluded                                                          |
| `pnpm.cmd typecheck`                                                                      | PASS — workspace source and Node fixture types                                                                              |
| `pnpm.cmd exec tsc -p scripts/web-node/tsconfig.json --noEmit`                            | PASS — final Node fixture source                                                                                            |
| `pnpm.cmd lint`                                                                           | PASS                                                                                                                        |
| `pnpm.cmd boundary:check`                                                                 | PASS — 31 AI and 4 Phase 2 forbidden fixtures rejected                                                                      |
| `pnpm.cmd --filter @archboard/web build` with process-local HTTPS/WSS fixture origins     | PASS — assets and service worker; no server/browser launched                                                                |
| `node scripts/check-ai-layout-assets.mjs`                                                 | PASS — isolated bounded worker, CSP compatibility and precache                                                              |
| `pnpm.cmd format:check` and `git diff --check`                                            | PASS                                                                                                                        |

Fixtures cover detached review, fresh/stable UUID mapping, reference integrity,
derived rectangles, order/capacity/text limits, malformed candidates, stale/deleted
targets, changed replacement notes, unrelated append edits, order refresh, encoded
budgets, live client-ID byte equivalence, storage failure, replay after reload,
account/board journal isolation, exact private history, reviewed mode and asynchronous
authentication guards. Mock API tests prove strict presentation rendering, exact
private reuse, mode invalidation and rejection of invented references before cache
retention. These fixtures do not establish multi-client database durability or
browser acceptance. The build reports its existing large-chunk advisory.

## Deferred acceptance and handoff

- Browser/Playwright/native browser/served-preview review, keyboard/visual checks,
  local highlights, presenter/follow behavior and account/board transitions:
  **UNRUN (deferred by user)**.
- PostgreSQL/Neon/database-backed HTTP/auth/session/socket/schema/migration,
  real collaborative stale-target races, persistence/outbox/committed ACK and
  reload recovery: **UNRUN (deferred by user — until Version 1 implementation is complete)**.
- Live model compatibility, recruiter quality, latency, grounding and cost:
  **UNRUN (requires separately authorized operator budget and reviewed inputs)**.

All browser/database/live-provider acceptance gates and the original Version 1
release gate remain **OPEN**. No push, merge or deployment occurred.

Next: [AI-C16](https://github.com/Shreyas2121/archboard/blob/37b663661045f8fe6cbed7db265141b84131718e/guide.md#ai-c16--provider-prompt-cache-optimization), optional
capability-aware provider prompt-cache optimization. Preserve exact actor-private
result caching, reviewed context, optional finite operator ceilings, conservative
admission/accounting, normal commands and truthful durability. Do not pad/prewarm,
add paid background requests or infer live cache performance from fixtures.
