# AI operator configuration

AI-C17 adds optional server-only `AI_KILL_SWITCH_FILE`, an absolute local marker
path controlled by the operator. Presence disables creation and protected result
reads; authorized cancellation and maintenance continue. Unset means no marker
check. See the [operations runbook](ai-operations.md) for circuit breakers,
safe diagnostics, bounded shutdown/recovery and payload-key rotation.

AI-C02 defines configuration and a neutral provider port. AI-C03 registers the
OpenAI Responses adapter when AI is enabled; disabled composition has no adapter.
Provider resolution checks the configured profile's capabilities. AI-C09–AI-C15
deliver authenticated run/event routes and reviewed diagram, guidance, scoped-edit
and presentation workflows. Live compatibility remains unverified.
AI-C04 requires native structured output in both the selected profile and adapter
at registry resolution; a profile with `structuredOutput: false` cannot dispatch.
There is no validated plain-text/schema fallback or automatic provider/model switch.
Claude, other production providers, production mocks and automatic failover are
unavailable. GitHub remains the only login. Do not initialize an account or submit
paid requests merely to exercise configuration.

The adapter pins the official SDK, disables SDK retries and SDK logging, uses
`store: false`, and supports only configured model IDs and the versioned schema.
It sends server instructions separately from user data, enables no tools, and
uses the fixed official API endpoint. Native structured output fails closed for
profiles without that capability; there is no untested fallback. Output tokens,
UTF-8 result bytes, total deadline and raw transport bytes are bounded. Refusal,
incomplete output and uncertain transport do not become successful results.

The model renderer returns a strict `{ result: ... }` wrapper around the shared
result contract. Orchestration parses it with `aiModelOutputSchema`,
unwrap `result`, and validate task, context, grounding and authorization locally.
JSON Schema does not replace Zod refinements. OpenAI cached input is split from
uncached input; output includes reasoning once. Missing/inconsistent usage or
nonzero unpriced cache writes stay unknown and require conservative settlement.
Configured capabilities are operator assertions tested with fixtures, not proof
of model/account access. Live requests require separate budget authorization.

AI settings are server-only. [.env.example](../.env.example) contains empty
placeholders. Omitted, blank or `false` `AI_ENABLED` disables AI without requiring
other AI settings. Only exact `true` enables it. Disabled configuration ignores
inactive provider settings, but rejects AI-related `VITE_*` names in every mode.
Disabled AI has no cached reads under the initial policy. Existing application
configuration remains required independently of AI.

An enabled deployment requires `AI_PROVIDER=openai`, an explicit `AI_MODEL`,
`AI_DEPLOYMENT_NAMESPACE`, `AI_CONFIG_VERSION`, `AI_CONTENT_KEY_VERSION`, and
`AI_MODEL_PROFILES`. Namespace and version/model identifiers are bounded ASCII
identifiers; no browser input controls them. Model profiles must name distinct
models and qualities, with exactly one `standard` and optionally one `higher`.
The default `AI_MODEL` must occur in those profiles. Quality resolution is an
internal server operation; public requests do not gain a model/quality override.

`AI_MODEL_PROFILES` is a JSON array bounded to 64 KiB. Every profile requires these
fields; unknown properties are rejected:

The optional `promptCaching` profile field defaults to `disabled`. It is specific
to the selected OpenAI model, with these supported operator assertions:

| Value                 | Adapter behavior                                                                                                                                         |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `disabled` / omitted  | Omit optimization key, retention, options and breakpoints; native automatic provider caching may still occur                                             |
| `openai-in-memory`    | Legacy-compatible `in_memory` retention and an opaque scoped routing key; no modern options/breakpoints                                                  |
| `openai-explicit-30m` | Explicit-only caching with one breakpoint after static developer instructions, before all reviewed user data; `30m` TTL and an opaque scoped routing key |

Use the legacy setting only for models/accounts supporting in-memory retention.
Use explicit mode only for models supporting the modern explicit API. The profile
does not infer capability from a model name or prove live compatibility. Unknown
settings, extended retention and explicit caching without a positive
`prices.cacheWrites` rate for `writeClass: 'openai-30m'` fail configuration.
Adapter capability must also agree before admission. Enabling a legacy model does
not provide an explicit cache boundary: native implicit caching can include user
suffixes. Reviewed cloud data remains private under application authorization;
the routing key is an optimization partition, not an access-control mechanism.

Explicit mode places static authority in a developer text block; user prompt,
context, evidence, graph, notes and history follow in user data without a breakpoint.
The output schema and task instructions are stable across private input changes;
presentation mode is read from reviewed user data and remains locally validated.
Routing uses a hash of model, instructions, schema, adapter version, cache mechanism
and a server HMAC of deployment/actor/target. No raw account IDs or private content
appear in cache metadata. Changing model/schema/authority/partition invalidates
routing; exact actor-private application result reuse still requires every reviewed
field and current authorization independently.

The adapter normalizes ordinary input as total input minus disjoint cache reads and
writes. Explicit writes use the configured `openai-30m` rate instead of ordinary
input pricing; reasoning included in output is charged once. Missing/inconsistent
explicit write counts, unpriced writes and new unsupported categories remain unknown
and keep conservative liability. Admission reserves the maximum of uncached/read/
write rates for the full input and all allowed attempts, including per-category
rounding; it never assumes a cache hit. Existing finite operator ceilings apply.

This implementation follows the [official OpenAI prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching).
Its modern `30m` TTL is a minimum lifetime, and provider retention may be longer;
legacy in-memory retention is provider-managed. `store: false` does not disable
prompt caching. There is no padding, prewarming, extended-retention option or paid
background cache work. Live compatibility, retention, hit rate and savings remain
UNRUN pending separate budget authorization and reviewed inputs.

The required profile fields are:

| Field                                                                       | Value                                                                                                 |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `quality`                                                                   | `standard` or `higher`                                                                                |
| `model`                                                                     | Operator-selected explicit model ID                                                                   |
| `pricingVersion`, `tokenCountingVersion`                                    | Operator-owned bounded version identifiers                                                            |
| `contextWindowTokens`, `maximumInputTokens`, `maximumOutputTokens`          | Positive safe integers, at most 10,000,000 each; input plus output must fit the window                |
| `structuredOutput`                                                          | Boolean; the registered adapter must support the selected schema/capabilities                         |
| `prices.uncachedInputMicroUsdPerMillion`, `prices.outputMicroUsdPerMillion` | Positive integer micro-USD per million tokens as canonical decimal strings                            |
| `prices.cacheReadMicroUsdPerMillion`                                        | Nonnegative integer micro-USD per million tokens as a decimal string                                  |
| `prices.cacheWrites`                                                        | Array of distinct `{ writeClass, microUsdPerMillion }` entries; empty when none are supported         |
| `prices.separateReasoningMicroUsdPerMillion`                                | Nonnegative decimal string or null when reasoning is already included in output/not separately billed |

Use reviewed pricing and a supported counting implementation for the actual model.
The configuration loader validates local shape and bounds; it does not establish
live account access, factual pricing, tokenization accuracy, or provider capability.
Admission fails closed when authoritative bounds/pricing are unavailable.
Test profiles under API `infrastructure/testing` are synthetic and excluded from
production builds. The registry accepts fixtures only in test mode.

Supply `OPENAI_API_KEY` through the operator secret store. Local validation checks
bounded nonblank printable text and rejects placeholder keys, without authenticating
the account. `AI_CACHE_KEY_SECRET` and `AI_CONTENT_ENCRYPTION_KEY` are distinct
32-byte secrets encoded as 64 hex characters; neither can equal the provider key.
The result-key version is required separately. Secrets are omitted from normal JSON
serialization of the AI config and are absent from resolved policy snapshots.
Never log the full configuration, stringify secret objects, or publish fingerprints
as metrics/content labels. Configuration errors and startup diagnostics name fixed
settings without rejected values or nested JSON content.

The user made spending and provider ceilings optional during AI-C02. Omitted or
blank `AI_DAILY_BUDGET_MICRO_USD`, `AI_MONTHLY_BUDGET_MICRO_USD`, and
`AI_GLOBAL_BUDGET_MICRO_USD` use finite defaults of `1000000` ($1 daily), `5000000`
($5 monthly), and `10000000` ($10 lifetime/global). Explicit overrides must be
positive canonical decimal strings. `AI_ACTOR_DAILY_BUDGET_MICRO_USD` remains
optional; omitted/blank means no separate per-actor money ceiling, while global
spending and per-actor frequency/concurrency limits still apply. Money is bounded
by PostgreSQL signed bigint without floating-point conversion.

Omitted or blank `AI_PROVIDER_RPM`, `AI_PROVIDER_INPUT_TPM`, and
`AI_PROVIDER_OUTPUT_TPM` use application ceilings of 3 requests/minute, 60,000
input tokens/minute, and 10,000 output tokens/minute. Explicit overrides remain
positive bounded integers. These are application defaults, not measured provider
quotas; lower them when necessary to fit the account's reviewed limits. A profile's
per-run input/output caps must fit the resolved ceilings; if they exceed defaults,
reduce the profile bounds or explicitly raise the relevant ceiling. C06 reserves
all configured attempts, so the default RPM now covers the initial attempt plus
one repair and one definitive-rejection retry. All overrides remain optional.
Durable admission enforces these ceilings and reserves all allowed attempts before
dispatch. Unknown usage retains the money liability through UTC budget rollover;
neither cancellation nor content expiry refunds uncertain work. The global ceiling
is lifetime spending, not a monthly reset. See [admission](ai-admission.md).

| Optional setting                                      | Default       | Bound/relationship                                                                    |
| ----------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------- |
| `AI_CREATE_PER_MINUTE`, `AI_CREATE_BURST`             | 10, 3         | Positive; burst cannot exceed rate                                                    |
| `AI_FRESH_PER_MINUTE`, `AI_FRESH_PER_DAY`             | 3, 20         | Positive; minute allowance cannot exceed daily allowance                              |
| `AI_ACTOR_CONCURRENCY`, `AI_GLOBAL_CONCURRENCY`       | 1, 2          | Positive; actor cap cannot exceed global cap                                          |
| `AI_DEADLINE_MS`                                      | 120,000       | Positive, at most 120,000; includes all allowed repair/retry                          |
| `AI_REPAIRS`, `AI_REJECTION_RETRIES`                  | 1, 1          | Each 0 or 1; no SDK auto-retry authority                                              |
| `AI_POLLS_PER_MINUTE`, `AI_SSE_CONNECTIONS_PER_ACTOR` | 30, 2         | Positive bounded integers                                                             |
| `AI_CACHE_TTL_MS`                                     | 900,000       | Fixed from settlement; use at most 900,000 for durable runs (see below)               |
| `AI_CACHE_ENTRIES`, `AI_CACHE_ACTOR_ENTRIES`          | 128, 16       | Positive; actor cap cannot exceed global cap                                          |
| `AI_CACHE_BYTES`, `AI_CACHE_ACTOR_BYTES`              | 16 MiB, 4 MiB | Each at least one 512 KiB payload, at most 64 MiB; actor cap cannot exceed global cap |

General rate/count controls cap at 1,000,000; provider token ceilings cap at
10,000,000. Receipt retention is fixed at 24 hours and result payloads at 512 KiB.
Use `AI_CACHE_TTL_MS` no greater than **900,000** (15 minutes): both the environment
loader and durable run snapshot reject higher values. Leaving the default or lowering it is the supported operational
configuration. Capacity eviction can expire results sooner. Process-local L1 is
disabled; provider prompt caching is optional as described above. The exact private
cache enforces retention/capacity; disabled reads never trigger fresh generation.

Every resolved configuration retains a deeply frozen profile/policy snapshot with
prompt/schema/adapter/product-policy versions and a SHA-256 fingerprint of canonical
nonsecret policy. Model, pricing, counting, budgets, limits, namespace, configuration
version and generation/schema-capability changes produce a new fingerprint.
Object property order and credential-only rotation do not. Array order is preserved.
Configuration is composed at API startup; restart to adopt environment changes.
There is no live reload controller. Already-admitted calls retain their original
provider/model/prices/versions and cannot be redirected to a new provider by changing
configuration. Restart interrupts active streams and may leave unknown outcomes;
recovery never redispatches them. Receipt replay retains the original run.

The provider port normalizes requests, streaming terminal states, capabilities,
usage and safe failures. Unknown usage is explicit. Cache reads, per-class cache
writes, uncached input and output are separate categories; separately billed
reasoning excludes tokens already billed as output. Safe failures distinguish
definitely unsent, definite rejection and possibly started execution; orchestration
allows only bounded eligible retries within the same reservation/deadline. Interrupted streams
and cancellation after dispatch never imply zero usage or a released money reserve.

Browser checks remain **UNRUN (deferred by user)**. Database verification remains
**UNRUN (deferred by user — until Version 1 implementation is complete)**. Live
provider proof remains **UNRUN (requires separately authorized operator budget and
reviewed inputs)**. See [verification policy](verification-policy.md) and
[AI evidence](evidence/ai/README.md); all corresponding acceptance gates remain OPEN.

## Configure a deployment without making a paid request

Use the existing [authenticated setup](setup.md#authenticated-local-development).
AI is unavailable in the database-free `/demo` and does not add another login.
Keep AI disabled while preparing configuration; these instructions do not resume
configured database checks, migrations, deployment or paid evaluations.

1. Choose the explicit OpenAI model ID the operator intends to support. Review its
   account access, native structured-output/streaming support, context/output bounds,
   current prices and rate limits using the official [model catalog](https://developers.openai.com/api/docs/models)
   and [pricing](https://developers.openai.com/api/docs/pricing). No default model is
   selected by this guide; changing a name does not establish compatibility.
2. Copy [the profile shape](examples/ai-model-profile.template.json) into a private
   operator file. It contains a deliberately nondeployable model name and synthetic
   prices, not a recommendation. Replace the model, all rates, version identifiers
   and token bounds with reviewed values; serialize the array as `AI_MODEL_PROFILES`.
   Set `AI_MODEL` to that array's chosen model. Set `AI_PROVIDER=openai`, a stable
   `AI_DEPLOYMENT_NAMESPACE`, and an operator `AI_CONFIG_VERSION`. Keep the namespace
   stable across restarts: changing it is not a financial reset/recovery procedure.
3. Provision `OPENAI_API_KEY` through the API-only secret store. OpenAI's
   [production guidance](https://developers.openai.com/api/docs/guides/production-best-practices)
   recommends secure key storage and rotation. Use a separate evaluation project
   and finite approved budget when live testing is eventually authorized.
   Create two independent random 32-byte values for `AI_CACHE_KEY_SECRET` and
   `AI_CONTENT_ENCRYPTION_KEY`, encoded as 64 hex characters; set a distinct
   `AI_CONTENT_KEY_VERSION`. Do not copy test keys or print a full configuration.
4. Review optional budgets and limits above. Micro-USD are millionths of a dollar:
   a price of $2 per million tokens would be `"2000000"` micro-USD per million
   tokens (unit illustration, not an actual model price). Keep strings as integers.
   Leave prompt caching disabled until the chosen model's mechanism and write prices
   have been reviewed. Cache savings are never assumed in reservation.
5. Select the absolute spending-marker path, its service-account access and
   [rotation/recovery procedure](ai-operations.md). Keep the marker present while
   preparing enabled configuration. A future authorized startup with
   `AI_ENABLED=true` composes the runtime; removing the marker permits normal
   admission. Readiness/database/live checks still require their own resume conditions.

Static profile/schema checks cannot authenticate a key or prove a model supports
the emitted schema. Follow [the acceptance inventory](ai-verification.md) when
verification is authorized; do not use a paid probe as configuration validation.

## Data flow, rotation and invalidation

The browser sends only the reviewed request to Archboard. The API sends bounded
instructions and reviewed user data to OpenAI through the backend SDK with
`store: false` and no tools. It does not fetch repository files or URLs. OpenAI
retention is separate from Archboard's encrypted result TTL: `store: false` is
not a zero-retention promise, and prompt caching may retain provider application
state. Review the project's current [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)
before sharing private material. Native cache lifetime/capability is model-specific;
see [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).

| Change                                                                                                                         | Exact result reuse / recovery effect                                                               |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Prompt, context, graph/preconditions, history, target, actor or deployment                                                     | Different private identity; no cross-actor reuse                                                   |
| Model/profile, pricing/counting version, prompt/schema/adapter/policy version, config version, budgets, limits or cache policy | New policy/generation identity; fresh requests cannot reuse old configuration                      |
| Object property order only                                                                                                     | Canonical identity preserved; array order and text/whitespace remain significant                   |
| Provider credential only                                                                                                       | No policy fingerprint change; already-sent work still settles under its original snapshot          |
| HMAC key                                                                                                                       | Old reuse invalidated; old receipt hashes may conflict, without paid resubmission                  |
| Encryption key/version                                                                                                         | Old content may be unreadable and reports expired; accounting remains                              |
| Spending marker                                                                                                                | Blocks creation and protected reads, including cache/replay; cancellation and maintenance continue |

For provider-key rotation, disable new spending with the marker, allow sent work
to settle or retain uncertainty through graceful shutdown, provision the replacement
secret and restart. Revoke the old provider key under the operator's key policy;
an emergency revocation can interrupt sent calls. Do not change HMAC/encryption keys
as a side effect. Payload/HMAC rotation has separate TTL/receipt consequences in
the [runbook](ai-operations.md#rotate-private-payload-encryption-keys) and
[cache contract](ai-cache.md#rotation-and-integration-handoff).

## Future adapter extension

The neutral port is in `apps/api/src/modules/ai/application/provider.ts`, registry
in `provider-registry.ts`, and production adapter in
`infrastructure/providers/openai/openai-provider.ts`. SDK-native schema, request,
cache and usage translation belongs only in an adapter. A future adapter requires
an implemented production provider ID, config/capability validation, composition,
shared fixture contract proof and separately authorized live acceptance. Public
contracts, document commands and browser credentials stay independent. The current
registry rejects non-OpenAI production IDs; Claude and actual provider switching
are unavailable.
