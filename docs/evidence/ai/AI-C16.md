# AI-C16 — Provider prompt-cache optimization

Branch: `ai-diagram-integration`.
Parent: `7cd11865dd654ad3210b745ae7f79353aed1d948` (AI-C15).
Commit subject: `perf(ai): optimize provider prompt caching and usage accounting`.
Scope: opt-in per-model provider cache translation, static prefix stability,
disjoint usage accounting and conservative admission. AI-C17–AI-C19 remain NOT STARTED.

## Changes and contracts

- The optional server model-profile `promptCaching` setting defaults to `disabled`.
  It supports `openai-in-memory` for operator-confirmed legacy-compatible models
  and `openai-explicit-30m` for operator-confirmed modern explicit caching. This
  replaces the old deployment-wide disabled prompt-cache setting inside application
  result-cache policy. Retention is selected by the model/provider profile, never
  by a public request field. Unknown/extended settings fail configuration. Explicit
  mode requires positive `openai-30m` write pricing, and registry resolution requires
  the selected adapter's cache capability. No live model/account capability is inferred.
- OpenAI adapter translation emits only applicable native controls. Legacy opt-in
  sends an in-memory retention value and opaque routing key, without modern options
  or explicit breakpoints. Explicit opt-in uses explicit-only mode, a 30-minute
  minimum TTL and one breakpoint on static developer instructions. The reviewed user
  prompt, graph/context/evidence, step notes and private history follow the boundary
  without breakpoints. The existing strict output schema remains static. Disabled
  optimization omits cache keys/options/retention/breakpoints; native automatic
  provider caching may still occur. No extended retention, prewarming, padding,
  background requests or paid cache warmer is introduced.
- Static task instructions/schema are independent of private request changes.
  Presentation mode now stays in reviewed user data and is still validated by the
  request-bound local schema. Application identity constructs a separate opaque
  HMAC deployment/actor/target partition. The adapter hashes that partition, model,
  instructions, output schema, adapter version and cache mechanism for routing.
  User content and raw account/board identifiers never become routing metadata.
  Model/schema/instruction/partition changes invalidate routing; private user-data
  changes preserve a static prefix but always change exact application result identity.
- Prompt/schema versions advance to `ai-prompt-v5` / `ai-schema-v5`; structured
  names advance to v5. Adapter/policy advance to `ai-adapter-v2` / `ai-policy-v2`.
  Public schema remains 1. Exact actor-private result identity includes generation,
  policy and versions; current authorization still gates every result. Receipt
  identity remains in its separate operation/body domain, preserving replay behavior
  without dispatch under a changed configuration. Provider optimization never
  substitutes for private application result reuse or access control.
- Explicit usage normalization splits total input into uncached input, cache reads
  and the configured `openai-30m` write class. Writes replace ordinary input billing,
  rather than adding a second input charge. Counts must be safe, nonnegative and
  conserved; total input/output must match total tokens. Included reasoning is charged
  once inside output. Missing explicit write counts, inconsistent categories, malformed
  counts, unpriced writes or unsupported legacy writes remain unknown and follow the
  existing conservative liability path. Legacy omitted zero writes remain compatible.
- Existing integer pricing applies the immutable configured read/write/uncached/output
  rates and upward rounding. Existing reservations already cover the highest input
  category price, including write premiums and per-category rounding, over the full
  declared input/output and every allowed repair/rejection attempt. No cache-hit
  discount is assumed at admission. Coordinator input checks include conservative
  adapter cache/developer-block framing headroom; the extra bytes are an admission
  bound, not text sent to the model. Existing finite operator ceilings remain intact.
- Native cache options/breakpoints remain inside the OpenAI adapter. Static boundary
  protection adds both fields and negative fixtures. SDK version, no-tools policy,
  disabled SDK retries/logging, fixed endpoint, `store: false`, bounded transport,
  deadline, cancellation and authorized reviewed Apply behavior remain unchanged.
  No dependency, migration, provider request or real database operation was added.

## Documentation basis and limits

Used the OpenAI Docs skill and fetched the [official prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching),
then checked the installed SDK request/usage types. The implementation follows its
explicit developer-block boundary and disjoint cache-write accounting. Provider
30-minute TTL is a minimum, not an erasure deadline; provider retention may be longer.
Legacy implicit caching can include private user suffixes. Scoped routing keys are
optimization partitions, not security boundaries. Model/account access and retention
must be verified separately before enabling the appropriate operator assertion.
Fixtures contain synthetic models, requests, rates and transports; no hit-rate,
retention, latency or savings claim is made.

## Checks

| Command                                                                                          | Result                                                                             |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `pnpm.cmd --filter @archboard/api test --runInBand --testPathPatterns modules/ai`                | PASS — 256 mock-only tests / 15 suites; integration specs excluded                 |
| `pnpm.cmd --filter @archboard/api test --runInBand --testPathPatterns platform/config/ai-config` | PASS — 59 database-free configuration cases                                        |
| API pretest build                                                                                | PASS — contracts/fixtures/document-model/API compiled without a server or database |
| `pnpm.cmd exec vitest run --config scripts/web-node/vitest.config.ts`                            | PASS — 183 tests / 25 Node suites                                                  |
| `pnpm.cmd exec vitest run packages/contracts/src/ai/contracts.test.ts --environment node`        | PASS — 47 shared AI fixtures                                                       |
| `pnpm.cmd typecheck`                                                                             | PASS — workspace and Node fixture types                                            |
| `pnpm.cmd --filter @archboard/api typecheck`                                                     | PASS — final API source and fixture types                                          |
| `pnpm.cmd lint`                                                                                  | PASS                                                                               |
| `pnpm.cmd boundary:check`                                                                        | PASS — 33 AI and 4 Phase 2 forbidden fixtures rejected                             |
| `pnpm.cmd format:check` and `git diff --check`                                                   | PASS                                                                               |

Fixtures check stable prefix order, no user data before explicit boundaries,
mode/schema/model/instruction/partition changes, disabled and unsupported options,
cache capability and pricing configuration rejection, read/write/ordinary token
conservation, mixed/miss/write-premium pricing, missing/malformed/unknown usage,
conservative full-miss reservations and framing admission before intent/dispatch.
Existing fixture regressions preserve private result/receipt identity, authorization,
uncertain liability, reviewed proposals and replay recovery. They are implementation
proof, not browser, database or live-provider acceptance.

## Deferred acceptance and handoff

- Browser/Playwright/native browser/served-preview behavior, reviewed input and
  account/board UI transitions: **UNRUN (deferred by user)**.
- PostgreSQL/Neon/database-backed HTTP/auth/session/socket/schema/migration,
  durable cache/accounting coordination, multi-worker recovery and real receipt
  races: **UNRUN (deferred by user — until Version 1 implementation is complete)**.
- Real model/account capability, retention, usage compatibility, cache hit/miss/write
  observations, latency and actual billing/savings:
  **UNRUN (requires separately authorized operator budget and reviewed inputs)**.

All browser/database/live-provider acceptance gates and the original Version 1
release gate remain **OPEN**. No push, merge or deployment occurred.

Next: [AI-C17](../../../guide.md#ai-c17--cleanup-metrics-kill-switch-and-shutdown),
bounded retention cleanup, safe operational metrics, kill switch and shutdown.
Preserve immutable accounting/unknown liabilities independently of private payload
expiry, exact authorization and private reuse, optional finite ceilings, provider
capabilities/pricing, normal document commands and truthful committed ACK semantics.
