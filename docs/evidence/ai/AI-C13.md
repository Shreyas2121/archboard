# AI-C13 — Grounded explanations, questions and private guidance

Branch: `ai-diagram-integration`.
Parent: `621543880a83a28c5f858cb0c1528a6c336be24a` (AI-C12).
Commit subject: `feat(ai): guide selected architecture with grounded questions`.
Scope: reviewed selected-object explanations, declared flow tracing, bounded private
follow-up history and local reference highlights. AI-C14–AI-C19 remain NOT STARTED.

## Changes and contracts

- The assistant offers Generate diagram and Understand selection modes. Both
  sessions remain mounted when switching modes, preserving existing frozen creation
  intent and additive Apply recovery. Guidance is initially owner/editor-only.
- Explicit selected connections include their endpoint cards; connections between
  selected cards are included. No neighbor traversal, boundaries, presentation
  steps, comments, membership or unrelated cards are included. The strict existing
  context schema copies all included fields, including code/note text and geometry,
  into a detached review. It uses no claimed server sequence (`null`).
- The user reviews the complete exact request, checks availability and explicitly
  requests guidance. Selection identity, task, prompt, history and relevant graph
  fields invalidate the review. Dispatch rechecks the current context after async
  authentication. Offline generation is not queued; uncertain recovery preserves
  the original reviewed body/key and existing receipt rules.
- Server prompt/schema versions advance to `ai-prompt-v2` / `ai-schema-v2`.
  Public contract schemaVersion remains 1. Guidance uses the narrower strict
  `archboard_guidance_v2` structured output (guidance or clarification only),
  existing task/result binding, evidence-key checks and reviewed highlight IDs.
  Other task kinds retain their existing shared result contract under the new
  versioned renderer. Cache identity includes these server versions.
- Instructions distinguish user-provided descriptions from observed behavior,
  supplied evidence from hypotheses, and declared directed paths from proposed
  links. They ask at most three focused questions, identify missing/conflicting
  facts, treat history/code/injection text as data, and prohibit file access, URL
  fetching, tool execution, hidden-field inference and security-proof claims.
  Structural validation cannot establish semantic truth; live model quality
  remains OPEN. The guidance UI currently supplies graph descriptions and history;
  it does not add a file/evidence-upload workflow. Supplied project evidence remains
  supported and tested at the existing API boundary.
- Keeping an exchange is explicit and session-only. Exact user prompt and validated
  assistant JSON are retained, with at most 12 messages, 4,000 characters per message
  and 24,000 aggregate history characters. An entire oversized exchange is rejected
  without truncation or summarization. Existing request byte limits and the
  coordinator's conservative UTF-8 input-token bound include instructions, history
  and structured schema before any durable intent, reservation or provider dispatch.
  Exact history and selected local fields remain part of the private cache key.
- Claims display provided/evidenced/proposed labels, evidence keys, assumptions
  and questions. Highlighting is an explicit private action. IDs must belong to
  reviewed context; current schema-parsed graph fields, selection and result expiry
  are rechecked. Highlight state is scoped by deployment/account/board/graph-version
  namespace and local revision; mismatched scopes/revisions and presentation mode
  suppress it. Leaving guidance, expiry, stale review or unmount clears it.
  Highlight styling leaves editor selection, awareness, camera, presenter, Y.Doc,
  graph commands, history and persistence untouched. Account/access transitions
  clear private requests/history using existing session fences and keyed mounting.
- No new provider dependency, database migration, shared persistence protocol,
  automatic mutation or paid provider call was introduced.

## Checks

| Command                                                                                                                                                                                                                        | Result                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `pnpm.cmd exec vitest run --config scripts/web-node/vitest.config.ts`                                                                                                                                                          | PASS — 154 tests / 23 Node suites                                       |
| `pnpm.cmd --filter @archboard/api test --runInBand --runTestsByPath src/modules/ai/application/prompt-renderer.spec.ts src/modules/ai/application/run-application.spec.ts src/modules/ai/application/private-identity.spec.ts` | PASS — 19 mock-only tests / 3 suites                                    |
| `pnpm.cmd --filter @archboard/api test --runInBand --testPathPatterns modules/ai`                                                                                                                                              | PASS — 238 unit tests / 15 suites; integration specs excluded           |
| `pnpm.cmd typecheck`                                                                                                                                                                                                           | PASS — workspace and Node fixture source                                |
| `pnpm.cmd lint`                                                                                                                                                                                                                | PASS                                                                    |
| `pnpm.cmd boundary:check`                                                                                                                                                                                                      | PASS — 31 AI and 4 Phase 2 forbidden fixtures rejected                  |
| `pnpm.cmd --filter @archboard/web build` with process-local HTTPS/WSS fixture origins                                                                                                                                          | PASS — production assets and service worker; no server/browser          |
| `node scripts/check-ai-layout-assets.mjs`                                                                                                                                                                                      | PASS — existing isolated layout asset/CSP/precache boundaries preserved |
| Prettier on changed files and `git diff --check`                                                                                                                                                                               | PASS                                                                    |

Fixtures cover a declared request flow, misleading security descriptions, injected
card/history text, provided/proposed claims and real supplied evidence keys, unknown
or omitted IDs, deleted/changed local fields, selected-context limits, three-question
and history budgets, exact history cache hits/misses, bounded invalid-output repair,
full-request token admission, post-auth stale dispatch and private scope/revision/
presentation isolation. Fixtures prove validation and policy wiring; they do not
measure real model reasoning or production authorization.

After extending the supplied-evidence grounding fixture, the run application suite
was rerun: PASS — 9 tests. Final `pnpm.cmd format:check` passes repository-wide.
The final stale-auth guard clears its confirmed-unsent intent so the user can
review again without losing retained conversation history; its focused Node suite
was rerun after that change.

## Deferred acceptance and prepared cases

Browser/native-browser/Playwright/served production-preview checks:
**UNRUN (deferred by user)**. Prepare final browser verification to:

1. Select cards/connections and inspect the full request; verify exact endpoint and
   internal-edge inclusion and omission of other cards, steps and boundaries.
2. Switch Generate/Understand tabs during pending and uncertain runs. Preserve
   each original identity, no duplicate generation, additive Apply recovery and
   explicit identical recovery. Change selection with the same resulting subset
   and confirm a new review is required.
3. Change local text, history, selection or account while authentication is pending;
   verify no stale request is sent. Exercise offline, expiry, archive, revocation,
   account/board changes and late replies; private content must be cleared/fenced.
4. Highlight known references and verify no shared selection, awareness, camera,
   presenter, history, graph mutation or cross-account/board leakage. Edit/delete a
   referenced object, change revision, close guidance and enter presentation mode;
   references must disappear. Exercise bidirectional flow and missing facts.
5. Keep exact exchanges, answer questions, review each new request and reject
   oversized whole exchanges. Verify provenance labels, capped questions, invalid
   references, conflicting descriptions and injected text with no file/URL actions.

PostgreSQL/Neon/database-backed HTTP/auth/session/socket/schema/migration verification:
**UNRUN (deferred by user — until Version 1 implementation is complete)**.
Existing prepared AI integration fixtures remain unexecuted. Final verification
must exercise guidance through real authenticated create/read/events/cancel routes,
current owner/editor authorization, actor/board/deployment cache isolation, exact
history changes, encrypted retention/expiry and bounded admission under races.
These gates and collaborative no-leakage proof remain **OPEN**.

Live provider compatibility, grounding quality, latency and cost:
**UNRUN (requires separately authorized operator budget and reviewed inputs)**.

## Handoff

AI-C13 implementation is delivered. Browser/database/live-provider acceptance and
the original Version 1 release gate remain **OPEN**; this task does not establish
the M00–M08 completion trigger. No push, merge, deployment, database check or paid
request was performed.

Next: [AI-C14 — scoped edits with field preconditions](https://github.com/Shreyas2121/archboard/blob/37b663661045f8fe6cbed7db265141b84131718e/guide.md#ai-c14--scoped-edits-with-field-preconditions).
Preserve strict reviewed context, private history, stale selection/dispatch fences,
server-owned admission/cache/accounting, existing graph commands and committed ACK
semantics. Resolve this evidence's introducing commit in the next index update.
