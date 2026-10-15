# AI focused regression and prepared acceptance

> Retired from the application runtime on October 14, 2026. This document is retained
> as a legacy implementation reference. Use [Project JSON](project-context.md) for
> the current local import workflow. Its old enablement steps do not activate hosted AI.

AI-C18 consolidates reproducible regression checks and the remaining acceptance
inventory. This is fixture/static implementation proof. Database, browser,
live-provider and Version 1 release gates remain OPEN under the
[verification policy](verification-policy.md). Completing AI-C18 or AI-C19 does
not establish the original M00–M08 implementation-completion trigger.

## Focused check sequence available now

Run from the repository root with the installed pinned workspace dependencies.
The following commands build/typecheck source, run Node fixtures, or inspect
static artifacts. None launches a browser, connects to a database, starts the
application, applies migrations or calls a real provider. Run build before tests
that consume package exports, and before artifact scans.

```powershell
# Static artifact fixture origins; these commands do not contact either host.
$env:VITE_API_ORIGIN='https://api.example.test'
$env:VITE_WS_ORIGIN='wss://api.example.test'
pnpm.cmd build
pnpm.cmd typecheck
pnpm.cmd lint
node node_modules/vitest/vitest.mjs run --root packages/contracts src/ai
node --experimental-vm-modules node_modules/jest/bin/jest.js --config apps/api/jest.config.cjs --runInBand --testPathPatterns modules/ai platform/config/ai-config
node node_modules/vitest/vitest.mjs run --root packages/document-model src/commands/atomic-commands.test.ts src/undo/undo.test.ts
pnpm.cmd exec vitest run --config scripts/web-node/vitest.config.ts scripts/web-node/features/editor/ai scripts/web-node/platform/api/ai-api.test.ts scripts/web-node/platform/layout/ai-layout.test.ts
node --test scripts/security/security-policy.node.test.mjs
pnpm.cmd boundary:check
pnpm.cmd --filter @archboard/api run security:scan
node scripts/check-phase5-cache-policy.mjs
node scripts/check-ai-layout-assets.mjs
```

Prettier-check the changed files separately. Commands are deliberately explicit;
there is no new aggregate that reports deferred children as passing. Inspect
package scripts/configs again if they change. The API unit Jest configuration
excludes `*.integration-spec.ts`. The web-node harness uses `environment: 'node'`
and files under `scripts/web-node`, rather than native browser test packages.
The scanner loads optional local operator environment only to compare secret
values; output contains counts, never those values. Node paths avoid package-local
Windows executable-resolution failures without changing installed dependencies.

The root `pnpm test`, browser runners, full phase verifiers, integration aggregate,
schema inspections and `phase5:verify --non-browser` remain excluded while paused.
Static build/worker/cache checks do not establish rendered behavior or real
service-worker caching acceptance.

## Regression coverage inventory

Paths below are relative to the repository root. Existing substantive suites are
reused; new cases exercise cross-layer behavior rather than duplicate isolated
implementation assertions.

| Boundary                                 | Primary fixture suites                                                                                                                   | What the set establishes                                                                                                                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public task/context/result contracts     | `packages/contracts/src/ai/contracts.test.ts`                                                                                            | Strict versions/unknown fields, bounds, semantic references, evidence and preconditions                                                                                                                                                  |
| Provider adapter/neutral contract        | `apps/api/src/modules/ai/infrastructure/providers/openai/openai-provider.spec.ts`, `application/provider-abstraction.spec.ts`            | Shared SDK/SSE and independent fixture contract, known/unknown usage, refusals, incomplete/partial streams, cancellation, unsupported capabilities; no account/key or future production provider                                         |
| Pricing and durable intent rules         | `application/admission-service.spec.ts`, `intent-service.spec.ts`                                                                        | Conservative full-attempt reservation, integer upward rounding across disjoint categories, separate reasoning, quota/funding rejection, receipt conflict/expiry, replay and unknown liabilities                                          |
| Private reuse and reviewed orchestration | `application/run-application.spec.ts`, `result-cache.spec.ts`, `private-identity.spec.ts`, `run-coordinator.spec.ts`                     | Actor/board/config/history isolation, one paid intent under concurrent public keys, cache reuse under quota, access recheck after lookup, no regeneration on receipt/unknown/expiry, bounded retry/repair and grounded output validation |
| Retention and operations                 | `application/maintenance.spec.ts`, `operations.spec.ts`, `infrastructure/kill-switch.spec.ts`, `ai.controller.spec.ts`                   | Fixed TTL/capacity, expired lease before total deadline, recovery fencing, marker policy, safe metrics, bounded shutdown and in-memory protected transport                                                                               |
| Mapping and normal graph commands        | `scripts/web-node/features/editor/ai/*.test.ts`, `packages/document-model/src/commands/atomic-commands.test.ts`, `src/undo/undo.test.ts` | Fresh IDs, bounded detached candidates, stale/permission/byte rejection, scoped edits/presentations, normal Undo, lost local Apply response after replica convergence without duplicate IDs                                              |
| Client transport and layout              | `scripts/web-node/platform/api/ai-api.test.ts`, `platform/layout/ai-layout.test.ts`                                                      | Private scope/recovery identity, bounded events, terminable layout/fallback; Node substitutes do not establish browser/network persistence                                                                                               |
| Static provider/privacy/cache boundaries | `scripts/ai-boundaries.mjs`, `scripts/security/security-policy.node.test.mjs`, public-secret/cache/worker scanners                       | SDK isolation with negative fixtures, AI credential names and configured values, recognizable synthetic key rejection, generated protected-route cache exclusion and isolated layout asset                                               |

The actual contract test filename and executed counts are recorded in task
evidence. `application/*` and `infrastructure/*` shorthand above refers to
`apps/api/src/modules/ai/`; document-model `src/undo` is in that package.

AI-C18's added token-partition case exercises every partition of four input tokens
across uncached/read/two write classes, with separate reasoning and fractional
micro-USD rounding. The public concurrency case combines replay, deduplication,
global concurrency, body conflict and another actor's fresh generation. The
unknown-usage case retains liability across a UTC day and honors the expired
receipt tombstone. The access-change case denies disclosure after a cache lookup,
then replays the same committed receipt when access is restored. These are
in-memory transaction fixtures, not proof of PostgreSQL locking/commit semantics.

## PostgreSQL and process acceptance — OPEN

Status: **UNRUN (deferred by user — until Version 1 implementation is complete)**.
Resume only after the entire original M00–M08 implementation is complete, or an
explicit later user exception. AI task completion, Node PASS or a non-browser
flag does not resume this verification.

1. Confirm the selected target is an isolated test PostgreSQL database. Review
   its nonsecret host/database identity privately; never print credentials. The
   prepared suite requires `DATABASE_DIRECT_URL` and creates a randomized
   `archboard_aic05_*` schema with its own migrations/auth fixture and cleanup.
   It is not a production migration command. Operator migration approval and
   deployment readiness remain separate from test authorization.
2. From `apps/api`, run only the prepared AI integration file once resumed:

   ```powershell
   node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.integration.config.cjs --runInBand --testPathPatterns ai-persistence.integration-spec.ts
   ```

3. Record the commit, schema/target designation, test case results and cleanup
   outcome. The prepared suite covers repository races, durable reservations,
   constraints/rollback, cache/index/savepoint capacity, protected real HTTP and
   session/SSE authority, terminal fencing, cleanup and migration round trip.
   AI-C18 adds two maintenance instances discovering an expired dispatch lease
   before its still-future total deadline, with one unknown settlement.
4. Exercise actual process crash/restart separately using a controlled fixture
   provider and isolated database. Kill before dispatch claim, after claim,
   during partial output and after provider terminal but before settlement commit.
   Restart the same namespace and let maintenance recover after lease expiry.
   Verify unsent versus unknown accounting, persistent receipts, no redispatch,
   writer fencing, and unchanged reserved liability through day/month rollover.
   Process/transaction stalls and real ownership loss must not be inferred from
   the in-memory shutdown tests. Follow the [operations runbook](ai-operations.md).
5. If interrupted, confirm the randomized schema and active processes before
   targeted cleanup. Do not retry a paid intent or reset production data as a
   cleanup mechanism. Re-run failing cases after fixes and record real outcomes;
   leave unfinished proof OPEN.

Configured migration state, original session/socket/auth regressions and any
Neon-specific acceptance are recovered during the consolidated Version 1 final
verification; this AI fixture suite does not replace them.

## Browser acceptance — OPEN

Status: **UNRUN (deferred by user)**. Resume only on an explicit later request to
resume browser verification; Version 1 implementation completion alone does
not resume it. There is no new AI browser runner claiming prepared automated proof.

Use two authenticated test accounts and controlled fixture inference in a clearly
labeled test deployment. Record rendered behavior, accessibility, network requests
and committed sequence acknowledgements for these scenarios:

- Prompt/form/context JSON review, consent and bounds; supplied, inferred,
  proposed and evidenced claims stay distinguishable; injection text is inert.
- Cancel, refusal, unknown outcome, expiry, marker disable and stream reconnect;
  retry reuses the same intent and does not automatically submit fresh paid work.
- Layout worker success/cancel/fallback, stale preview and repeated Apply; preserve
  collaborator edits, archive/revocation restrictions and additive graph content.
- IndexedDB/outbox persistence across reload/offline/late ACK, lost responses and
  receipt expiry; journal markers/CRDT presence alone do not establish committed
  server ACK. Account/board/deployment transitions cannot expose private history.
- Grounded guidance and local highlights do not move another user's viewport;
  scoped edits respect preconditions and Undo; reviewed append/replacement steps
  follow the presentation contract with no unsupported references.
- Public bundles/storage/network traces contain no server AI credentials;
  protected AI HTTP/SSE responses remain no-store and outside service-worker
  runtime caches. Check keyboard/focus/screen-reader and narrow-screen behavior.

After interruptions, recover the original run/application intent and current
authority before continuing. Never manufacture a new key, UUID batch or paid
request just to make the demonstration pass. Record failures as failures.

## Live-provider acceptance — OPEN

Status: **UNRUN (requires separately authorized operator budget and reviewed inputs)**.
Resume only with separately approved finite evaluation budget, reviewed sanitized
inputs, operator credentials/pricing/model capability configuration and current
provider data-policy review. Enabling AI or a mock test PASS does not authorize
paid evaluations. OpenAI is the only production adapter; real provider switching
remains out of scope until another adapter is implemented.

Use the plan's three-component description, supplied Archboard description,
incomplete description, misleading README, injection fixture and oversized
context. Evaluate grounding/unsupported claims, clarification quality, valid graph
rate, latency and known/unknown usage/cost. Verify schema compatibility and
capability-aware cache controls on the actual configured model. Cache-read/write
savings require measured live observations; do not pad, prewarm or run paid
background probes. Use normal admission for breaker recovery. Stop at the agreed
budget and retain unknown liability when interrupted; do not blindly resubmit.

Capture safe totals and reviewed outcomes, never keys, raw prompts or private
provider traces. Update evidence with actual results and remaining limitations;
fixture totals do not close any production/phase/release gate.
