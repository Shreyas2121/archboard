# AI-C10 — Reviewed prompt, form and context JSON inputs

Implementation delivered on `ai-diagram-integration`. Introducing commit uses
`feat(web): add reviewed prompt form and context JSON inputs`; parent is
`23b33910694028fefbd6f3d72c009dcf16d6926e` (AI-C09), whose parent is
`5e494b60a9dab7f06e53014975a3ac636bb9e215` (AI-C08).
Resolve this file's introducing hash with the evidence index command after commit.
AI-C11–AI-C19 and optional AI-X01 remain **NOT STARTED**. Acceptance gates remain
**OPEN** under the [verification policy](../../verification-policy.md).

## Delivered behavior

- The account-board editor inspector has an AI tab built with existing shadcn
  primitives and semantic Tailwind tokens. Prompt-only, guided project/component/
  connection context, validated compact JSON export, and one UTF-8 JSON upload
  lead to an explicit request review. File selection only reads locally. Declared
  and actual file bytes are capped at 1 MiB; depth, forbidden keys, strict fields,
  normalized request limits and semantic references use existing contracts.
- The review shows the complete prompt and context, including groups, evidence
  paths/ranges/hash/excerpts, constraints and unknowns. Optional complete request
  JSON is plain escaped text. The cloud-processing explanation precedes Generate;
  no credential or provider setup is exposed. The current graph is not attached
  automatically. This task displays results without changing board documents.
- Availability and allowance reads are explicit and advisory. Generate requires
  a validated review, current editor authority, connectivity and positive
  availability. It performs a fresh server actor check before POST. Disabled,
  offline, failed, uncertain, cancelled, unknown and expired states have distinct
  feedback; no offline queue or automatic paid retry exists.
- Session-only private drafts, files, reviews, run content and creation intent
  remain outside persistent storage, query caches, graph state and sync outboxes.
  Account/board/session boundaries, sign-out, archive or authority loss clear or
  quarantine them. Board/account keyed composition and operation/file epochs fence
  late responses, including adapters ignoring abort. Tab changes retain the same
  private session; leaving the board disposes it. Expired content is cleared by
  the retention timer while receipt/run metadata remains available.
- One creation UUID and normalized body are frozen before submission. Duplicate
  clicks cannot create another request. Ambiguous creation failures permit only
  explicit recovery of that exact intent within the 24-hour receipt window.
  Definite first rejection allows an explicit new review; recovery errors do not
  erase earlier uncertainty. Expired receipt/content responses do not regenerate.
  Cancellation and reconnect address the existing run; unknown outcomes prevent
  silent replacement. REST has bounded response bytes and a 15-second deadline.
- The typed cookie/no-store API adapter validates request, result and run bindings,
  preserves safe errors/positive integer Retry-After and shares existing global
  unauthorized handling. SSE is incrementally decoded with fatal UTF-8, bounded
  bytes/frames, strict fields and matching run/event/sequence headers. Heartbeats,
  chunk splits and repeated snapshot IDs are supported. Text deltas never establish
  success. Every accepted notice triggers a fresh authorized run GET. Explicit
  reconnect uses Last-Event-ID as a snapshot marker, with no replay/gap inference
  or creation. Older replies cannot replace newer terminal/expired snapshots.

No dependency, provider SDK, secret configuration, database schema, graph command,
or persistence protocol changed. API-client extraction preserves existing callers.
Mapping/preview/Apply belong to AI-C11/C12.

## Checks

| Check                                                                     | Result                                                                       |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm exec vitest run --config scripts/web-node/vitest.config.ts`         | PASS — 112 tests, 19 suites; Node-only                                       |
| Focused review/API fixtures using that Node config                        | PASS — 30 tests, 3 suites, including existing API-client regression fixtures |
| `pnpm typecheck`                                                          | PASS — workspace and Node fixture source; no integration execution           |
| `pnpm lint`                                                               | PASS                                                                         |
| Production web build with temporary HTTPS/WSS fixture origins             | PASS outside sandbox; static bundle and service worker only                  |
| Dependency boundary scan including staged C10 files and negative fixtures | PASS                                                                         |
| Static public-source/bundle secret and generated HTML CSP scans           | PASS                                                                         |
| `pnpm format:check`, staged/unstaged whitespace checks                    | PASS                                                                         |

Fixtures cover local selection/export/review, invalid UTF-8/JSON/prototype keys,
file/prompt bounds and broken references, account/session clearing, late files and
responses, frozen recovery identity, offline interruption, fresh actor changes,
expired receipts, repeated SSE markers, terminal regression, strict/bounded event
parsing, reconnect headers, response bounds, safe errors and unresponsive request
deadlines. They never render/mount the UI or contact a provider/database.

The initial build rejected local HTTP origins under production CSP. A subsequent
sandbox build compiled the client but failed resolving Workbox's installed terser
dependency, matching prior repository evidence. Offline frozen-lockfile install
changed no manifest/lockfile; the same production build outside the sandbox passes.
Fixture origin overrides were process-local; no environment file changed. The
existing large-chunk advisory remains.

## Deferred acceptance and handoff

- Browser/Playwright/native browser/served-preview/download/focus/OAuth/SSE checks:
  **UNRUN (deferred by user)**. Prepared acceptance: complete keyboard review and
  JSON download/upload; verify no request on selection/edit/review; inspect cloud
  review and disabled/offline feedback; account/board/sign-out changes during file,
  POST and SSE work; cancellation/reconnect/unknown/expiry; actual cookie/CORS/CSP
  behavior; narrow-window/tab retention and accessible focus. No browser ran.
- PostgreSQL/Neon/database-backed HTTP/auth/session/socket/schema/migration checks:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
  C09's prepared real session/stream fixtures remain unexecuted. No database check
  or diagnostic ran.
- Live compatibility, quality, latency and cost evaluation:
  **UNRUN (requires separately authorized operator budget and reviewed inputs)**.

AI-C10 implementation is delivered. Browser/database/live-provider and original
Version 1 release gates remain **OPEN**. No push, merge, deployment, migration or
paid provider request was performed.

Next: [AI-C11 — proposal mapping and layout](https://github.com/Shreyas2121/archboard/blob/37b663661045f8fe6cbed7db265141b84131718e/guide.md#ai-c11--semantic-to-graph-mapping-and-deterministic-layout),
depending on this introducing commit and AI-C01. Map validated semantic proposals
to fresh graph IDs and bounded deterministic drafts, evaluate/pin elkjs and worker
termination/fallback, and preflight a detached candidate before live mutation.
Keep creation identity separate from C12's future stable Apply identity. Preserve
private scoping, explicit review, neutral provider boundaries and both verification
deferrals. C10 is not preview or Apply acceptance.
