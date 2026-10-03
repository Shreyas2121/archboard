# AI implementation guide — commit-by-commit agent handoff

Date: **3 October 2026**. Branch: **`ai-diagram-integration`**, to be created or
selected by the implementing agent. This planning session remains on `main`.

Authority: [plan-ai.md](./plan-ai.md), the user's later requirement for
provider-independent infrastructure, caching, and rate limits, and the repository
[verification policy](./docs/verification-policy.md). Read the applicable
[API instructions](./apps/api/AGENTS.md) and
[frontend instructions](./apps/web/AGENTS.md) before touching those applications.

This guide specifies future implementation commits. Tasks and tests listed here
are **not implemented or verified merely because they appear in this document**.
GitHub is the only login. AI uses operator-managed server credentials and controls.

## 1. Branch, task selection, and handoff rules

The user explicitly assigned branch creation/switching to the implementing agent.
Start by inspecting the working tree and current branch:

```powershell
git status --short
git branch --show-current
git log -5 --oneline
```

If the implementation branch is absent, create it from the intended current
baseline; the baseline at guide creation was `main`,
`c725dce16695251d0cf67a1dd3b972f29646a3f5`. Check for newer accepted work rather than
resetting to that hash.

```powershell
git switch -c ai-diagram-integration
```

If it already exists, inspect its history and use `git switch ai-diagram-integration`.
Never overwrite another agent's work, force-reset the branch, or silently stash
unrelated edits. At guide creation, `plan-ai.md` and the empty `guide.md` were
untracked task files. The completed documents should be preserved by the first
documentation commit.

Implement one selected commit at a time, on top of its dependencies. A handoff to
another agent uses the same implementation branch and the latest actual commit.
Do not have multiple agents switch branches in one shared working directory.
Separate worktrees are necessary only if simultaneous work is explicitly requested.

For every task:

1. Read the task, source of truth, relevant existing code, and nearest tests.
2. Resolve routine implementation choices within the stated architecture.
3. Implement the whole task, including error/permission paths and needed fixtures.
4. Run only relevant allowed checks; prepare deferred acceptance tests without
   executing them.
5. Add task evidence and update the evidence index for inclusion in this commit.
6. Review the diff, stage exact files, and make the listed commit.
7. Hand off the next task, actual commit/parent, checks, and remaining OPEN proof.

Use `docs/evidence/ai/AI-CNN.md` and an index at
`docs/evidence/ai/README.md`; create them in AI-C00. Do not embed a commit's own hash
inside the same commit. Record its parent and subject, then map the actual hash in
the next handoff/index update. Record later fixes as new commits, not amendments to
historical evidence.

Do not push, merge, deploy, run configured migrations, spend on model evaluations,
or expand to optional helper work solely because the guide mentions those actions.
An implementation request selects tasks; this guide is not a command to execute
all optional work.

## 2. Required architecture

### 2.1 Provider independence is required in the first integration

Support **OpenAI GPT through Responses** and **Anthropic Claude through Messages**
using distinct backend adapters. Both use operator-owned API accounts. Switching
the active provider/model is a validated server configuration change, not a
frontend, graph, contract, or orchestration rewrite.

Separate these concerns:

| Layer                   | Responsibility                                                     | Must not contain                                 |
| ----------------------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| Shared public contracts | Context, task, proposal, run/event, error, allowance DTOs          | SDK types, keys, raw provider endpoints          |
| AI application service  | Authorization, lifecycle, cache policy, admission, settlement      | OpenAI/Anthropic request/response field handling |
| Provider port           | Neutral input, output, usage, failure and capability types         | React, TypeORM, HTTP controller behavior         |
| Provider adapters       | SDK/HTTP translation, stream completion, error/usage normalization | Board writes or payer selection                  |
| AI infrastructure       | Transactions, run store, budgets, cache persistence                | Model prompting in repositories                  |
| Frontend                | User intent, reviewed context/proposal, local highlights           | Provider credentials or raw SDK results          |
| Document model          | Validated graph operations                                         | Provider/client/database dependencies            |

Keep provider code in `apps/api/src/modules/ai/infrastructure/providers/`.
Start pure diagram mapping beside frontend AI application code if it has one
consumer; extract `packages/ai-core` only for demonstrated reuse, with boundary
checks updated deliberately. Shared DTOs belong in `packages/contracts/src/ai/`.

Conceptual provider port, to be finalized in AI-C02:

```ts
type AiProviderId = 'openai' | 'anthropic';

type ProviderEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'completed'; text: string; usage: NormalizedUsage }
  | { type: 'refused'; code: string; usage: NormalizedUsage | null }
  | { type: 'incomplete'; reason: string; usage: NormalizedUsage | null };

interface AiProvider {
  readonly id: AiProviderId;
  capabilities(model: string): ProviderCapabilities;
  stream(request: NormalizedProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>;
}
```

Public clients never submit `AiProviderId`, arbitrary model IDs, credentials,
endpoint URLs, provider-native parameters, or cost figures as authority. The
server resolves all of them and stores the resolved configuration version on
each run. Configuration changes apply to new runs; they do not redirect an
in-progress call.

Neutral input includes instructions, bounded text/history, an optional versioned
JSON schema, maximum output tokens, task, and a total deadline. System/developer
instruction placement and cache controls are adapter details.

Normalize usage into disjoint billable categories, including uncached input,
cache reads, cache writes, and output, with provider-specific write classes when
their prices differ. Track reasoning usage without charging it twice when it is
already included in output. Preserve only safe provider request IDs for diagnosis.
Represent missing usage as unknown, never as zero.

Use one adapter contract suite with fixture transports for completion, incomplete
output, refusal, mid-stream error, cancellation, unknown usage, and unsupported
schema/model capabilities. No real account/key is needed for those tests.

### 2.2 Structured output and provider limits differ

OpenAI structured output uses its Responses `text.format` schema route. Anthropic
documents `output_config.format` on Messages, with `max_tokens` for its output
budget. Capability and schema compatibility must be checked for each configured
model; do not send one provider's request shape to another.
[OpenAI structured output](https://developers.openai.com/api/docs/guides/structured-outputs),
[Anthropic structured output](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)

Adapters hide those differences. Always run application Zod/domain validation on
the assembled output. A provider schema guarantee does not establish factual
accuracy or authorize an edit.

Provider prompt caching also differs. OpenAI documents prefix reuse and
model-dependent cache settings, and cached tokens still count toward its rate
limits. Anthropic documents explicit cache controls, cache-write/read accounting,
and model-specific input/output rate limits.
[OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching),
[Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching),
[Claude rate limits](https://platform.claude.com/docs/en/api/rate-limits)

Keep stable instructions/schema before varying context. Translate the caching
policy only inside adapters. Do not promise exact discounts, cache hits, or quotas.
Do not pad prompts or prewarm caches by default merely to qualify for caching:
both can increase spending.

### 2.3 Runtime and graph boundaries

Preserve NestJS, TypeORM/PostgreSQL, React Flow, Yjs, existing editor commands,
offline persistence/outbox, and committed ACK semantics.

The AI service generates proposals. It cannot write PostgreSQL graph arrays,
replace the full live Y.Doc, persist provider identities, execute source code,
or introduce another graph synchronization protocol. Provider calls have no
filesystem/shell/database tools.

No provider SDK or credential enters the public bundle. SDK imports outside the
two provider adapters should fail a boundary/static check. Server-only AI
configuration cannot appear in `VITE_*` variables.

AI starts disabled until validated operator configuration and budget exist.
Mocked provider mode is allowed only in tests or an explicitly labeled development
fixture; it must not silently power a production AI button.

## 3. Caching contract

Use distinct mechanisms and names so agents do not confuse caching with
idempotency or authorization.

| Mechanism                 | Purpose                                                | Policy                                                               |
| ------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| Idempotency receipt       | Retry the same run creation without another execution  | Actor + operation + key; same key/different request is 409           |
| In-flight deduplication   | Identical simultaneous intent under different keys     | Same actor/board/exact configuration; return one existing active run |
| Application result cache  | Avoid another model call for an exact reviewed request | Private validated semantic result, fixed short TTL, bounded storage  |
| Provider prompt cache     | Reuse processing of a stable prompt prefix             | Adapter-specific, metered; still generates output                    |
| HTTP/service-worker cache | Public delivery caching                                | Protected AI routes use `Cache-Control: no-store`                    |

### 3.1 Exact cache keys and access

Build a keyed hash from a canonical encoding of:

- Deployment namespace, actor identity, board/new-board namespace, access policy version.
- Task and exact normalized prompt, project context, selected graph fields and history.
- Resolved provider, model, prompt/schema/adapter versions, generation settings,
  product policy, and configuration fingerprint.
- Selected graph/precondition fingerprint, including relevant unsynchronized edits.

Use a dedicated server secret for keyed hashes. Do not log hashes of private
content, keys, prompts, or ciphertext. Do not include secrets in canonical input.

Canonicalize object-key order; preserve array and text order where meaningful.
Do not lowercase prompts, discard user constraints, or use approximate/embedding
similarity for cache reuse. Two users on the same board do not share private results.

Authenticate and check current board access before lookup or return. A cache hit
cannot bypass viewer/archive restrictions or revocation. Also recheck before
returning a newly completed result. Changes to graph content/configuration make
a different cache key; apply-time preconditions remain necessary.

### 3.2 Contents, retention, and capacity

Cache only completed, validated **semantic proposals/guidance**, not raw partial
streams, errors, refusals, provider tokens, prompts, generated graph UUIDs, layout
measurements tied to an old viewport, or application receipts.

Generate/remap graph IDs for each genuinely new proposal application. A cache hit
does not reuse another run's graph IDs or produce an already-applied graph batch.

Use the existing PostgreSQL infrastructure for the authoritative result/run
payload store and exact-cache index. Avoid retaining two plaintext copies of the
same result. Store bounded payloads encrypted with an operator-managed content
key, separate from the cache-key secret; bind encryption associated data to
deployment/actor/run/schema. A stolen database must not reveal cached project
descriptions or generated private content.

Starting limits, adjustable by operator configuration:

| Cache area                | Default                                                                    |
| ------------------------- | -------------------------------------------------------------------------- |
| Result TTL                | 15 minutes, fixed from creation; hits do not extend it                     |
| One result payload        | 512 KiB serialized maximum                                                 |
| Cache entries             | 128 per deployment; at most 16 per actor                                   |
| Cache bytes               | 16 MiB ciphertext per deployment; 4 MiB per actor                          |
| Optional process-local L1 | Disabled initially; if added, bounded and non-authoritative                |
| Content cleanup           | Bounded periodic batches and expiry checks on every read                   |
| Creation receipts         | 24 hours, containing safe run metadata rather than expired private content |

Enforce both entry and byte capacity. Existing run results may be evicted/expired
before metadata; GET must honestly report content expiry. Eviction must not
resubmit inference or erase spend/idempotency records. After receipt expiry,
old paid intent is not retried automatically; require an explicit new request.

The payload byte ceiling covers unique private result payloads backing both runs
and cache entries, not just the lookup index. Cached runs can reference an existing
authorized payload rather than duplicating it. Capacity pressure may remove an
older result while preserving its safe run/accounting status; it cannot cause
unbounded storage of non-cacheable run output.

A cache capacity or write failure may reduce reuse, but a valid run result must
not cause a second paid generation. Unknown outcomes are never cacheable.
Cache expiry is not financial-reservation expiry.

## 4. Admission, cost, retries, and lifecycle

### 4.1 Admission order

Every public endpoint gets bounded inexpensive request admission. For creation:

1. Check runtime/feature availability, request target/body limits, and cheap
   pre-auth network admission.
2. Resolve the GitHub-authenticated actor and authorization for supplied board context.
3. Validate/normalize the request; resolve server provider/model/capability/pricing.
4. Apply actor request-frequency limits, including cached requests.
5. In a short transaction, authorize before idempotency replay, lock/check the
   receipt, and return an existing run for the same key and body.
6. Check exact result cache and in-flight deduplication under current authorization.
7. On a miss, atomically reserve fresh-call/token/concurrency/spending capacity
   and persist immutable dispatch intent.
8. Commit; perform the external provider call outside the transaction.
9. In another short transaction, settle usage once, record terminal status, and
   persist an eligible result/cache entry.
10. Return only under current actor/board authority.

An active fingerprint unique constraint or equivalent locked scope must serialize
different-key races; a process-local Map is not sufficient. Cache-hit races and
new paid admission must be rechecked under the relevant lock so there is one
paid intent. Use feature-owned infrastructure; do not expand the existing
boards idempotency operation to include a long provider network request.

Reuse the shared `PostgresTransaction` lifecycle and established board permission
service. Define one AI lock order before writing repositories. Preserve existing
board lock order: board authorization locks before AI-owned coordinator locks;
then global/actor admission rows in a documented deterministic order, fingerprint
scope, run/receipt, and reservation records. Review every creation, cancellation,
settlement, and cleanup path for inversions. Provider I/O is never under those locks.

### 4.2 Rate and monetary budgets

Initial defaults are small portfolio budgets, not provider guarantees:

| Control                       | Initial recommendation                                                    |
| ----------------------------- | ------------------------------------------------------------------------- |
| Authenticated create requests | 10 per minute per actor, burst 3                                          |
| Fresh generation starts       | 3 per minute and 20 per UTC day per actor                                 |
| Concurrent paid runs          | 1 per actor, 2 per deployment                                             |
| Provider admission            | Configured RPM and input/output token ceilings below the account's limits |
| Run deadline                  | 120 seconds including allowed retries/repair                              |
| Repair                        | At most 1, inside the same total deadline and reserved allowance          |
| Active/accepted queue         | No unbounded queue; reject or return an already admitted run              |
| Status polling                | Bounded independently, e.g. 30 per minute per actor                       |
| SSE                           | At most 2 connections per actor, bounded subscribers/events/bytes         |
| Money                         | Required operator-set daily/monthly/global and optional actor ceilings    |
| AI disable switch             | Stops new paid requests immediately; documented treatment of cached reads |

Cheap rate limits can use bounded process-local structures under the current
single-writer deployment, with eviction and trusted-proxy handling matching existing
HTTP code. Fresh-call, token, concurrency, and financial admission are durable and
atomic in PostgreSQL. Restarts do not refill monetary or fresh-call quotas.

Use safe app errors and `Retry-After` for transient time windows. Permanent budget
exhaustion has a distinct code/message; do not invent a reset time for an unknown
provider limit. Provider rate limits do not replace our own protection.
OpenAI recommends bounded exponential backoff with jitter and notes unsuccessful
requests still consume its per-minute limits.
[OpenAI rate-limit guidance](https://developers.openai.com/api/docs/guides/rate-limits)

Cache hits/idempotent replays consume cheap request limits, but do not increment
fresh-call quotas or reserve another paid amount. A genuinely new inference,
retry, or repair uses the relevant provider and cost admission; a “repair” is not free.

Money uses integer minor units, such as micro-USD in PostgreSQL bigint with
decimal-string serialization, and upward rounding where needed. Pricing is a
versioned operator table, not floating-point arithmetic or values reported by
the browser.

Reserve conservatively for full uncached input, output, reasoning where billable,
provider cache-write premiums, and any allowed repair/retry. Do not assume a
provider prompt-cache hit to fit within budget. A tokenizer/counting method must
include rendered instructions/schema and documented overhead; an unproven
characters-divided-by-four estimate is not an authoritative cap.

Missing pricing, unsupported token/cost bounds, or unavailable durable admission
fails closed before dispatch. Explain that an app budget bounds admitted estimated
liability under configured prices; provider invoicing and future price changes
still require operator reconciliation.

### 4.3 Crash and unknown-outcome rules

Record `dispatching` intent before network I/O. A crash after that point may have
sent the call, even if no response bytes were recorded. Do not promise exactly-once
external inference.

Use execution ownership/leases to prevent concurrent local dispatch. Lease expiry
allows a worker to mark an uncertain run `outcome-unknown`; it never authorizes
another provider call. Fence late completion and ensure settlement is once-only.

Keep maximum financial liability reserved for unknown usage/outcomes until safely
reconciled. Carry outstanding liability across UTC day/month boundaries; resetting
a period must not reset uncertain spending. Retain run and accounting metadata
after private result expiry.

Prove definitely unsent failures separately from uncertain transmission. Disable
SDK auto-retries. Permit at most one explicitly classified pre-generation rejection
retry, honoring backoff/Retry-After and total deadlines. Do not automatically retry
transport timeouts, disconnected started streams, provider-internal uncertainty,
or switch to another provider.

On cancellation, abort local I/O and stop result application. Settle known usage;
unknown provider execution keeps conservative liability. Releasing local execution
capacity is separate from releasing financial reservation. Disconnecting an SSE
viewer must not automatically cancel another tab's run.

PostgreSQL outage blocks new paid dispatch. If outage occurs after provider work,
keep the run recoverable/uncertain and never report committed success or regenerate.
Use bounded recovery attempts without retaining unbounded content or worker queues.

## 5. Commit sequence

Commit titles below are the intended subjects. Dependencies refer to task IDs;
each task includes its own evidence file and index entry.

| ID     | Commit subject                                                     | Depends on                | Milestone            |
| ------ | ------------------------------------------------------------------ | ------------------------- | -------------------- |
| AI-C00 | `docs(ai): record provider-independent implementation handoff`     | Current accepted baseline | Planning baseline    |
| AI-C01 | `feat(contracts): define AI context proposal and run schemas`      | C00                       | Foundation           |
| AI-C02 | `feat(api): add AI provider port and operator configuration`       | C01                       | Foundation           |
| AI-C03 | `feat(api): implement OpenAI Responses adapter`                    | C02                       | Providers            |
| AI-C04 | `feat(api): implement Anthropic Messages adapter`                  | C03                       | Providers            |
| AI-C05 | `feat(api): persist AI run and accounting intent`                  | C02                       | Cost infrastructure  |
| AI-C06 | `feat(api): enforce AI admission quotas and spending reservations` | C05                       | Cost infrastructure  |
| AI-C07 | `feat(api): coordinate bounded AI execution and recovery`          | C04, C06                  | Orchestration        |
| AI-C08 | `feat(api): cache private validated AI results`                    | C07                       | Caching              |
| AI-C09 | `feat(api): expose authenticated AI run and event endpoints`       | C08                       | Transport            |
| AI-C10 | `feat(web): add reviewed prompt form and context JSON inputs`      | C09                       | Generation UI        |
| AI-C11 | `feat(editor): map AI proposals to bounded diagram drafts`         | C01, C10                  | Graph/layout         |
| AI-C12 | `feat(editor): preview and apply additive AI diagrams`             | C11                       | First vertical slice |
| AI-C13 | `feat(ai): guide selected architecture with grounded questions`    | C12                       | Guidance             |
| AI-C14 | `feat(editor): apply scoped AI edits with preconditions`           | C13                       | Follow-up edits      |
| AI-C15 | `feat(ai): propose reviewed architecture presentation steps`       | C14                       | Presentations        |
| AI-C16 | `perf(ai): optimize provider prompt caching and usage accounting`  | C15                       | Cost refinement      |
| AI-C17 | `feat(api): add AI retention cleanup and safe operational metrics` | C16                       | Operations           |
| AI-C18 | `test(ai): cover provider cache quota and recovery boundaries`     | C17                       | Hardening            |
| AI-C19 | `docs(ai): document operator setup usage and deferred acceptance`  | C18                       | Handoff              |
| AI-X01 | `feat(context): export reviewed local project descriptions`        | C19; separately selected  | Optional helper      |

Tasks C01–C19 are the main AI extension. X01 is not required for prompt/JSON
generation. The first end-to-end implementation slice is C00–C12; it includes
both adapters and cost controls rather than exposing a paid endpoint early.

All statuses begin **NOT STARTED** except the documents authored during planning.
A task is “implemented” when its code/evidence lands; acceptance remains OPEN
where required proof is deferred.

### AI-C00 — Documentation baseline and branch handoff

**Scope:** select/create the branch as described above; preserve `plan-ai.md` and
`guide.md`; create the AI evidence index and this task's evidence. Record scope,
actual base/parent, provider-independent requirement, and verification deferrals.
Do not modify application code or initialize paid accounts.

**Check:** formatting and Markdown links/anchors for changed docs; confirm branch
and exact staged file list. No runtime checks are needed.

**Exit:** another agent can pick C01 using a real branch/commit and truthful
implementation/acceptance status.

### AI-C01 — Shared input, output, lifecycle, limits

**Touch:** `packages/contracts/src/ai/`, its public exports, relevant fixtures,
and existing error/limit modules.

**Implement:** strict `ProjectContextV1`, semantic proposal, clarification/guidance,
run creation/status, SSE event, availability, and allowed operation contracts.
Normalize optional input arrays without relaxing unknown-field rejection.
Define semantic keys separately from UUID graph IDs.

Bound prompt/context/evidence/graph output and event sizes. Include request/run
schema versions, content expiry, safe error categories, and decimal-string cost
fields where exposed. The public request cannot contain provider/key/endpoint
configuration. Define maximum encoded HTTP body separately from the JSON-file
limit; an escaped JSON string wrapper can exceed its original file size.

**Check:** contracts Vitest/Node tests for malformed input, duplicate keys,
unresolved references, unknown fields, future versions, size/token preflight
interfaces, and privacy-safe response/event validation.

**Exit:** all API/frontend imports use the same contracts; no SDK or UI dependency
enters contracts. C01 fixes schema names/versions for downstream tasks.

### AI-C02 — Operator configuration and provider port

**Touch:** AI application interfaces/DI tokens, config/index, existing
`api-config.ts` and tests, boundary checker, sanitized env documentation.

**Implement:** normalized provider port, capabilities, usage/failure types,
fake fixture provider, and registry selecting `openai` or `anthropic`. Resolve
model/quality profiles server-side. Define stable prompt/schema/adapter/policy
versions and configuration fingerprints.

Validate active provider key/model/pricing, limits, cache-key secret, result
encryption key, and feature enablement without printing secret values. Inactive
provider credentials need not exist. Disabled AI allows normal app startup;
enabled misconfiguration fails safely. No production mock fallback.

Use explicit server-only names such as `AI_ENABLED`, `AI_PROVIDER`, `AI_MODEL`,
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AI_CACHE_KEY_SECRET`,
`AI_CONTENT_ENCRYPTION_KEY`, and required integer money-limit settings. Put only
empty placeholders/descriptions in example env files. Model/pricing profiles
must be operator-owned versioned configuration, not fetched from browser input.

Prefer maintained provider SDKs inside adapters, pinned exactly; add dependencies
only where needed. Keep auto-retry configuration explicit. Do not add a generic
provider gateway or depend on one provider's SDK types in the port.

**Check:** config/DI tests and boundary negative fixtures. No live calls.

**Exit:** registry can select either adapter once registered; adding another
provider does not change public DTOs or application service logic.

### AI-C03 — OpenAI adapter

**Touch:** OpenAI provider adapter, versioned prompt/schema renderer, contract
suite/fixture transport.

**Implement:** neutral-to-Responses translation, structured-output support,
`store: false`, output/deadline bounds, abort propagation, usage normalization,
and SDK retries disabled. Assemble bounded output and accept only terminal
completion. Map refusal, incomplete output, quota, bad request, authentication,
overload, and uncertain transport to application failures without leaking bodies.

Capabilities are configured/tested for supported model profiles. Use server
instructions, not user input, as instruction authority. No hosted tools or file
uploads are necessary.

**Check:** shared provider suite, partial stream/error/refusal/abort fixtures,
usage without double counting, request fields, response size caps, and safe diagnostics.

**Exit:** application code consumes only neutral events/errors. Live compatibility
remains UNRUN unless separately authorized under an operator budget.

### AI-C04 — Anthropic adapter and actual switchability

**Touch:** Anthropic adapter, registry wiring, fixture transports, shared suite.

**Implement:** neutral-to-Messages translation, `output_config.format` where
supported, `max_tokens`, system instruction placement, content-block assembly,
stop-reason handling, stream usage finalization, abort, and disabled SDK retries.
Normalize cache-read/write usage correctly rather than treating `input_tokens`
as the entire billed input.

Run the same application fixture once through each adapter. Switching the configured
provider must preserve request/response DTOs and diagram validation. Unsupported
schema/model combinations fail closed or use one explicitly tested validated
fallback, never a raw provider parameter passthrough.

**Check:** same contract suite as C03 plus provider-switch tests. Verify no OpenAI
assumption in shared instructions, history, completion status, or usage types.

**Exit:** OpenAI ↔ Claude requires only validated operator configuration. This
means implemented/tested adapters, not an interface with an empty Claude stub.

### AI-C05 — Durable runs, receipts, and accounting intent

**Touch:** AI infrastructure entities/repositories, forward migration sources,
entity registry, bounded encrypted payload adapter, prepared integration tests.

**Implement:** durable runs, idempotent creation metadata, active fingerprint
coordination, reservations/settlement records, rate/concurrency scopes, and budget
periods. Separate short-lived private payloads from long-lived safe accounting.
Store immutable provider/model/config/pricing versions with each run.

Recheck authority before receipt/result disclosure. Reuse shared transaction
lifecycle and receipt semantics, but not a provider call inside
`IdempotencyService.execute`'s transactional effect. Define/record lock order and
once-only settlement constraints.

Preserve migration history and no schema synchronization. Do not import the
configured datasource or run migration inspections to “check” the change.

**Check now:** repository/service units with transactional in-memory adapters and
source/schema alignment review.

**Prepare, do not run:** PostgreSQL uniqueness, locks, atomic intent/receipt,
encrypted payload isolation, rollback, and migration tests.

**Exit:** durable dispatch intent can be represented without network I/O under
transaction locks. Real DB evidence remains OPEN.

### AI-C06 — Durable rate, token, concurrency, and spending gates

**Touch:** AI admission/budget services, pricing calculations, repositories,
config constants, prepared race/rollback tests.

**Implement:** section 4's quota rules with fixed UTC periods and injectable clocks.
Reserve global/actor monetary and token capacity atomically, including cache-write
premiums and configured repair/retry maximums. Track uncached input/cache writes/
reads/output as disjoint billing quantities with integer arithmetic.

Handle unknown reservations across period rollover. Default money ceilings are
required operator values, not invented published provider prices. Missing prices
or unavailable admission stops dispatch. Finish classification for HTTP rate errors
and Retry-After without leaking provider internals.

**Check now:** fake-clock quota behavior, contention simulation at the service
interface, cost-rounding boundaries, reserve/release/settle once, rollover with
unknown liability, zero/missing budget, and cancelled/failed attempt accounting.

**Prepare, do not run:** real concurrent PostgreSQL budget/rate/concurrency tests.

**Exit:** no execution path can bypass admitted funding or reset liabilities
through retry, restart, or a calendar transition.

### AI-C07 — Run orchestration and recovery

**Touch:** AI run/application coordinator, runtime admission/shutdown integration,
provider dispatch and settlement/reconciliation adapters.

**Implement:** state transitions, bounded output/history, execution claims,
deduplication, deadline/abort, one allowed repair, definitive-rejection retry,
and unknown-outcome recovery. Select and freeze provider/model/config per run.

Persist intent first; call provider after commit; settle after network completion.
Disable hidden SDK retries. A dead worker or expired lease cannot redispatch.
Late completion is fenced and settlement remains once-only.

Cancel and drain safely during shutdown using existing runtime admission.
Do not tie run ownership to one SSE connection. Bound retained event/output memory
and subscriber queues; drop/close slow subscribers with a recoverable run status.

**Check now:** fake provider call counts for retry/reconnect/crash/cancel scenarios,
authority changes during generation, settlement failures, no provider call under
active transaction, and bounded shutdown.

**Prepare, do not run:** DB/process crash/fault and lease races.

**Exit:** paid call accounting is safe across ambiguous outcomes. No endpoint is
enabled before this orchestration and C06 admission are wired.

### AI-C08 — Exact result cache and private retention

**Touch:** canonical/keyed hashing, cache services/store/index, encrypted content
retention/expiry, run result retrieval.

**Implement:** section 3's exact keys, current-authority checks, bounded fixed TTL,
entry/byte caps, encrypted validated result storage, and active same-scope request
coalescing. Recheck under coordination before admitting another paid miss.

Separate response caching from graph UUID generation and applied receipts.
Expiration or invalidation cannot trigger inference from GET. Cache new provider
configuration under a different fingerprint. Do not cache invalid, refused,
partial, failed, cancelled, or uncertain results.

**Check now:** actor/board isolation, cache miss after any meaningful input/config
change, canonical object order versus meaningful array order, expiry/eviction,
secret rotation behavior, no call on replay/hit, cap enforcement, and access revocation.

**Prepare, do not run:** DB cache/index/byte-counter concurrency and cleanup races.

**Exit:** reuse saves a provider call without sharing private results or bypassing
admission/access checks. Cache hit metrics never expose private fingerprints.

### AI-C09 — REST, body limits, SSE, and availability

**Touch:** AI thin controllers/module, auth actor lookup, central HTTP boundary,
error mapping, OpenAPI, application registration, endpoint unit fixtures.

**Implement:** the five routes in plan-ai, strict request/header/path schemas,
idempotency keys, safe result expiry, Retry-After, no-store, and current permissions.
Use actor-based limits; cheap network limits trust forwarded headers only under
explicit existing proxy policy.

The current ordinary body cap in
`apps/api/src/platform/http/product-http.ts` is **65,536 bytes**. Add an AI-specific
bounded route allowance so reviewed 1 MiB context files can be represented in the
request envelope. Preserve the ordinary cap, import limit, Better Auth handler
ordering, and schema validation; do not raise all request limits globally.

SSE uses same-origin HttpOnly session cookies, bounded subscribers, heartbeat,
event IDs/safe snapshot resumption, and documented terminal events. Do not expose
raw provider streams. Reconnect only reads state and never creates a run. Recheck
authorization during delivery and avoid private event replay after revoked access.

**Check now:** in-memory Nest/controller transport tests, malformed/oversized JSON,
forged IDs, unauthenticated/cross-user/viewer/archive access, no-store headers,
event bounds, and reconnect without generation.

**Prepare, do not run:** real DB-backed HTTP/session/stream permission tests.

**Exit:** the AI feature is controllable through server configuration and cannot
be used as an unbounded authenticated or anonymous proxy.

### AI-C10 — Prompt, form, JSON review, and typed transport

**Touch:** `apps/web/src/features/editor/ai/`, existing editor panel/action
composition, typed platform API/SSE adapter, pure Node tests.

**Implement:** prompt input, guided context form/export, single JSON upload,
validation errors, readable context review, explicit Generate, and availability/
allowance feedback. Selecting a file does not submit. Show the reviewed content
and cloud-processing explanation without provider credential setup.

Use existing shadcn primitives, Tailwind tokens, accessible labels/focus, and
editor UI state conventions. Session-only drafts must be cleared/quarantined on
account/board transition according to existing recovery rules.

Maintain one run creation key/body until its outcome is known. Cancel/reconnect/
unknown/expired states must preserve intent without automatic paid retries.
Network errors and offline mode disable creation; they do not queue future calls.

**Check now:** Node tests for JSON parsing/review state, account switching,
file/request size handling, stale response rejection, idempotency retry identity,
SSE parsing/reconnect, and drafts clearing. No mounted/rendered browser checks.

**Exit:** users can prepare and review a request, and frontend transport reflects
actual lifecycle/errors rather than assuming delta text is success.

### AI-C11 — Semantic-to-graph mapping and deterministic layout

**Touch:** pure mapping/geometry utilities, worker adapter, contracts/fixtures,
document-model commands only where required.

**Implement:** UUID allocation/remapping, component/category/content mapping,
legal handles, optional visual boundaries, default sizes/colors, and graph capacity
validation. Map semantic keys consistently across nodes/edges/groups.

Evaluate/pin `elkjs`; build its worker through existing Vite/CSP/offline-shell
patterns. Keep provider context out of worker diagnostic logs. Terminate timed-out
layout work; a Promise race alone does not stop expensive synchronous work.

Use stable ordering and bounded finite geometry. Compute boundaries as background
rectangles, not parent nodes. Fall back to a small deterministic layout if the
worker fails, with an honest status rather than dropping objects.

Preflight the complete projected candidate, physical-state limits and encoded
update bytes on a detached candidate document before a live transaction.
Do not accept model-generated coordinates/UUIDs as authority.

**Check now:** pure mapping and layout fixture tests, malformed references, ID
freshness, bounds/capacity/update-size limits, disconnected components, and no
mutation when preflight fails. Static build/CSP/worker checks are allowed.

**Exit:** a validated proposal becomes a bounded diagram draft ready for preview.
Browser layout readability remains deferred.

### AI-C12 — Preview and additive Apply

**Touch:** preview renderer/modal, editor command/session integration, new-board
import path, result/apply state guards.

**Implement:** isolated preview, counts/assumptions/questions, discard, additive
Apply, and create-new-board through existing authorized import/create behavior.
Default generation does not overwrite the existing graph.

Capture relevant context/preconditions and recheck current editability, account,
board/archive state, existing IDs, and budgets before applying. Apply one reviewed
batch through domain commands and normal persistence/sync. Fix the proposal's
ID mapping for that apply intent so repeated clicks/reload recovery cannot create
another batch silently.

Persist the stable apply intent/ID mapping before mutation in the existing
account/board-scoped local namespace, outside Y.Doc. Couple completion evidence to
the existing local update/outbox persistence boundary, or recover by checking the
same immutable created IDs after reload. A crash between graph mutation and a
UI-only “applied” flag must not cause allocation of new IDs on retry. Record a
locally applied proposal separately from one acknowledged by the server.

Preserve structural Undo exclusions. Use preview before Apply and existing
delete/restore afterward. Do not label draft/generated content “Saved to server”
before committed ACK. Handle import unknown outcomes under existing portability
recovery semantics.

**Check now:** editor-session/domain Node tests for double Apply, access/account
change, fresh-ID conflicts, new-board creation intent, rejection without mutation,
normal outbox routing, and truthful save state.

**Prepare, do not run:** multi-browser collaborative Apply/ACK/reload acceptance.

**Exit:** first useful vertical slice is implemented with both provider adapters,
admission/cache controls, reviewed inputs, valid layout, and normal graph mutation.
Record browser/database acceptance as OPEN.

### AI-C13 — Grounded explanations, questions, and private guidance

**Touch:** guidance prompt/schema version, run task policy, private assistant UI,
selected-object context builder and local highlight state.

**Implement:** explain a selection, trace a request flow, identify missing facts,
ask up to three focused questions, and distinguish provided/evidenced/proposed
claims. Bound conversation history/tokens and include exact history in cache keys.

Highlights and assistant text stay local/private. The model cannot read files,
fetch referenced URLs, infer hidden board fields, or mutate the board. Changes in
selection/history create new reviewed context.

**Check now:** grounded fixture scenarios, misleading descriptions, prompt
injection, nonexistent entity references, history/token budgets, and private state
isolation across account/board changes.

**Exit:** questions and guidance improve architecture explanation without being
misrepresented as observed code or proven security.

### AI-C14 — Scoped edits with field preconditions

**Touch:** strict operation contracts, candidate validation/apply commands,
reviewable diff UI, stale-result handling.

**Implement:** narrowly allow add/rename/label/property operations needed by the
product. Immutable endpoints/kinds remain immutable; reconnect uses replacement
edge semantics. No arbitrary field patches or whole-document replacement.

Preconditions compare reviewed target fields and relevant local changes, not only
server sequence. Review/reject stale proposals. Shared text edits use existing
field-level Y.Text commands and respect existing history semantics.

Keep deletes/replacement out of the initial allowlist unless a separate explicit
review operation is implemented with proper tombstone/reference behavior.

**Check now:** domain convergence/Node tests for collaborator changes, local edits,
tombstones, unsupported operations, duplicate Apply, and malformed complete
candidate with no partial mutation.

**Exit:** follow-up requests cannot silently erase another collaborator's changes.

### AI-C15 — Presentation proposals and recruiter guidance

**Touch:** presentation proposal contract/task, semantic step mapping,
existing presentation commands/review UI.

**Implement:** propose named ordered steps, notes, node/edge references, and
viewport rectangles derived from validated geometry. Apply only after review.
Honor step count/text/reference limits and clarify whether reviewed steps are
appended or replaced.

Guided local highlights must not start shared presenter mode or move other users'
viewports. Retain existing live-follow permission/participation behavior.

**Check now:** reference remapping, order/rect bounds, capacity, stale/deleted
targets, private guidance versus committed steps, and account/board transition.

**Exit:** a recruiter walkthrough can be created from reviewed architecture
without inventing unsupported components or bypassing presentation contracts.

### AI-C16 — Provider prompt-cache optimization

**Touch:** adapter cache policy translation, stable prompt renderer, capability
configuration, usage/pricing categories, fixtures.

**Implement:** provider-specific cache controls for stable reusable instructions/
schema where supported. Keep sensitive user context out of reusable cross-user
prefixes. Configure expiry/retention policy per model/provider, not one shared
request field.

Measure cache-read/write usage with sanitized fixtures, account for write premiums,
and maintain conservative admission on misses. Do not pad prompts, prewarm, use
extended retention, or add a background paid cache warmer by default.

**Check now:** stable prefix ordering, changed schema/model invalidation,
unsupported cache-option omission, usage category conservation, unknown usage,
and pricing with read/write/noncached tokens.

**Exit:** optimization is optional and capability-aware. Disabling provider
prompt caching changes performance/cost, not application correctness or privacy
of the app result cache. Real hit-rate/cost claims remain UNRUN.

### AI-C17 — Cleanup, metrics, kill switch, and shutdown

**Touch:** bounded cleanup scheduler, application runtime lifecycle,
privacy logger/metric adapters, operator diagnostics/runbook draft.

**Implement:** fixed TTL cleanup and byte/entry accounting, payload encryption-key
rotation procedure, expired result responses, safe run/usage diagnostics, operator
kill switch, provider circuit breaker, and bounded shutdown/cancellation recovery.

Keep unknown spending metadata and receipts independently of private content
expiry. Breakers are per provider/model configuration and probe only under normal
budget admission; no automatic cross-provider failover or paid background probes.

Metrics include application cache hits/misses, deduped starts, refused admission,
fresh calls, billable cache-read/write/output categories, cost reservations,
unknown outcomes, latency, cancellations, and cleanup backlog. No content labels,
user emails, token-bearing URLs, or unbounded high-cardinality fingerprints.

**Check now:** fake-clock expiry and breaker behavior, capacity after cleanup,
log/metric redaction, kill-switch policy, bounded shutdown, and secret scans.

**Prepare, do not run:** DB/process failure and restart accounting/cleanup tests.

**Exit:** the operator can understand and disable spending, while retention and
recovery remain truthful.

### AI-C18 — Focused regression and prepared acceptance

**Touch:** meaningful provider/cache/quota/orchestration/domain fixtures, prepared
integration tests, AI verification inventory, static boundary/secret checks.

**Implement:** consolidate a small regression set covering both adapters,
race/idempotency/deduplication, price rounding, private cache boundaries, unknown
outcomes, graph apply safety, and prompt grounding. Add missing substantive cases
rather than repeating implementation assertions.

Document recoverable database/browser/live-provider acceptance procedures and
precise resume conditions. Do not create an aggregate that silently reports
skipped children as PASS or runs blocked checks by default.

**Check now:** focused allowed suites and any required type/build/boundary checks
affected by new fixtures. Inspect aggregate children before use.

**Exit:** no known failing focused checks; acceptance inventory preserves all
deferred proof. Provider-switch test uses both real adapter implementations with
fixture transports.

### AI-C19 — Operator and product handoff

**Touch:** setup/usage/portfolio/operations docs as relevant, AI evidence index,
final implementation inventory and OPEN gate list.

**Implement:** operator provider switching, key setup/rotation, pricing/budget
configuration, cache/retention policy, limits, disable/recovery procedures, input
example/template, prompt starters, and recruiter walkthrough instructions.

Explain description-based inference limits, cloud data flow, cost uncertainty,
structural Undo, offline behavior, and result expiry in plain language. Show which
configuration changes invalidate caches and how in-progress runs retain their
original provider.

Record exact delivered commits and current evidence, separate mocked proof from
real provider/database/browser proof, and leave all applicable gates OPEN.

**Check:** changed-document formatting, local links/anchors, script/source
agreement, no leaked configuration values. Do not run unrelated runtime tests
for a documentation-only finish.

**Exit:** another developer can configure either provider and reproduce the
documented workflow subject to existing verification conditions. Do not announce
a verified production release from this implementation handoff.

### AI-X01 — Optional local context-export helper

Implement only when separately selected. Branch from/continue the accepted AI
baseline, preserving main feature scope.

**Touch:** optional local-helper package, shared context serialization only if
real reuse needs it, root-confined static parsers, sample repositories, usage docs.

**Implement:** read-only selection of documentation/manifests/entrypoints,
TypeScript/JavaScript/Nest relationships, ignores/exclusions, Windows root
confinement, bounded evidence/excerpts, local preview, and context JSON export.
No provider credentials, direct local inference, dependency installation,
repository scripts, database connections, or background upload.

Users upload the exported context in Archboard and choose Generate under the
same server-owned AI policy. Unsupported language analysis is reported as
incomplete rather than invented.

**Check now:** Node fixture repositories, symlink/junction/traversal escapes,
secret exclusions, budgets, evidence keys, and valid normalized JSON export.
Browser helper preview checks, if introduced, remain deferred.

**Exit:** local projects can prepare context without publishing the repository
or giving a hosted service unrestricted filesystem access.

## 6. Allowed checks and required evidence

Check the actual package scripts/configs before execution. The current root
`pnpm test` and full phase verifiers are not allowed substitutes for targeted
checks. Do not assume a script is database-free because its name says unit or
non-browser.

### 6.1 Focused command patterns

Formatting for changed docs/files:

```powershell
pnpm.cmd exec prettier --check --ignore-path .gitignore guide.md plan-ai.md
```

The existing `.prettierignore` excludes `guide.md`. This explicit ignore-path
override checks the requested guide without changing unrelated formatting policy.

For implementation commits when affected:

```powershell
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd build
pnpm.cmd boundary:check
```

Run builds needed for public package exports before targeted consumers. Example
database-free contract/adapter/model checks, after those paths/tests exist:

```powershell
pnpm.cmd --filter @archboard/contracts exec vitest run src/ai
pnpm.cmd --filter @archboard/api test --runInBand --testPathPatterns modules/ai
pnpm.cmd --filter @archboard/document-model exec vitest run src/commands/ai-proposal.test.ts
pnpm.cmd exec vitest run --config scripts/web-node/vitest.config.ts scripts/web-node/features/editor/ai
```

The API pretest builds dependencies and the API; inspect it before changes.
Frontend Node tests belong in the existing `scripts/web-node` harness, not a new
browser runner under `apps/web`. Adapt the model-test path to the actual file
chosen in C11/C14 and record the exact command. A “no tests found” pass is not
meaningful evidence.

Static checks after a relevant build can include:

```powershell
node scripts/check-phase5-cache-policy.mjs
pnpm.cmd --filter @archboard/api run security:scan
```

Inspect the scanner's current environment/source behavior; do not print secrets.
No lint/build/static success proves real AI quality, DB atomicity, rendered
accessibility, or browser behavior.

### 6.2 Deferrals remain mandatory

Record in each relevant evidence file:

- Browser/Playwright/native browser/served-preview/OAuth-browser checks:
  **UNRUN (deferred by user)**.
- PostgreSQL/Neon/real HTTP/auth/session/socket/schema/migration verification:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
- Live model requests/evaluation:
  **UNRUN (requires separately authorized operator budget and reviewed inputs)**.

Do not run `pnpm test`, `pnpm test:browser`, `pnpm phase4:quick`, full phase
verifiers, `pnpm test:integration`, schema/migration inspections, or
`pnpm phase5:verify --non-browser` while the corresponding pause applies.
Preparing migration source and integration fixtures does not authorize executing
them or querying a configured database.

Completing these AI commits does not establish original M00–M08 completion.
The amended [Phase 8 closure](./docs/phase-8-closure.md) leaves that trigger and
production acceptance OPEN. Ask only about an actually blocking missing constraint;
do not ask to resume deferred checks during an ordinary task handoff.

### 6.3 Evidence template

```markdown
# AI-CNN — Task title

Branch: ai-diagram-integration
Parent: actual SHA before this task
Commit subject: intended/actual subject
Scope: concrete behavior delivered

## Changes and contracts

Explain behavior, touched boundaries, provider/cost/cache consequences.

## Checks

Record exact allowed command, result, and relevant source boundary.
Distinguish fixture/in-memory proof from real integration proof.

## Deferred acceptance

List browser, database, and live-provider cases with required UNRUN wording.
Keep corresponding acceptance gates OPEN.

## Handoff

Next task/dependencies; material limitations; actual commit reported after commit.
```

## 7. Agent prompt

Use this prompt with a selected task; do not give an agent an ambiguous request
to implement the entire guide.

```text
Implement AI-CNN from F:\Shreyas\archboard\guide.md only.

Read plan-ai.md, root AGENTS.md, docs/verification-policy.md, and the applicable
apps/api or apps/web AGENTS.md. Select/create ai-diagram-integration as the guide
instructs; preserve unrelated work. Verify task dependencies against actual commits.

Keep GitHub as the only login and all AI credentials/provider/model/budget controls
server-owned. Use the provider-independent port and both implemented adapters.
Preserve exact private caching, durable admission, unknown-outcome accounting,
graph commands, offline persistence, and server ACK semantics.

Do the whole selected task and meaningful allowed unit/Node/static checks.
Prepare required DB/browser/live-provider tests but do not run deferred checks
or incur provider spending. Add docs/evidence/ai/AI-CNN.md and update the index.

Commit exact task files with the listed subject. Stop after this task and report
commit/parent, behavior, checks, UNRUN proof, OPEN gates, and the next dependency.
Do not push, merge, deploy, or continue optional tasks.
```
