# AI operator configuration foundation

AI-C02 defines configuration and a neutral provider port. AI-C03 registers the
OpenAI Responses adapter when AI is enabled; disabled composition has no adapter.
Provider resolution checks the configured profile's capabilities. There is no
product inference route yet, and live compatibility remains unverified.
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
result contract. Future orchestration must parse it with `aiModelOutputSchema`,
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
Later admission must fail closed when authoritative bounds/pricing are unavailable.
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
These settings are configuration only, not implemented quota/accounting enforcement.

| Optional setting                                      | Default       | Bound/relationship                                                                    |
| ----------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------- |
| `AI_CREATE_PER_MINUTE`, `AI_CREATE_BURST`             | 10, 3         | Positive; burst cannot exceed rate                                                    |
| `AI_FRESH_PER_MINUTE`, `AI_FRESH_PER_DAY`             | 3, 20         | Positive; minute allowance cannot exceed daily allowance                              |
| `AI_ACTOR_CONCURRENCY`, `AI_GLOBAL_CONCURRENCY`       | 1, 2          | Positive; actor cap cannot exceed global cap                                          |
| `AI_DEADLINE_MS`                                      | 120,000       | Positive, at most 120,000; includes any future repair/retry                           |
| `AI_REPAIRS`, `AI_REJECTION_RETRIES`                  | 1, 1          | Each 0 or 1; no SDK auto-retry authority                                              |
| `AI_POLLS_PER_MINUTE`, `AI_SSE_CONNECTIONS_PER_ACTOR` | 30, 2         | Positive bounded integers                                                             |
| `AI_CACHE_TTL_MS`                                     | 900,000       | Fixed from creation; positive, at most 86,400,000                                     |
| `AI_CACHE_ENTRIES`, `AI_CACHE_ACTOR_ENTRIES`          | 128, 16       | Positive; actor cap cannot exceed global cap                                          |
| `AI_CACHE_BYTES`, `AI_CACHE_ACTOR_BYTES`              | 16 MiB, 4 MiB | Each at least one 512 KiB payload, at most 64 MiB; actor cap cannot exceed global cap |

General rate/count controls cap at 1,000,000; provider token ceilings cap at
10,000,000. Receipt retention is fixed at 24 hours, result payloads at 512 KiB,
process-local L1 and provider prompt caching are disabled. The future cache owns
retention/capacity enforcement; disabled reads never trigger fresh generation.

Every resolved configuration retains a deeply frozen profile/policy snapshot with
prompt/schema/adapter/product-policy versions and a SHA-256 fingerprint of canonical
nonsecret policy. Model, pricing, counting, budgets, limits, namespace, configuration
version and generation/schema-capability changes produce a new fingerprint.
Object property order and credential-only rotation do not. Array order is preserved.
Reload configuration for new resolutions; existing snapshots keep their prior model
and settings. This task provides no live reload controller or secret rotation tool.

The provider port normalizes requests, streaming terminal states, capabilities,
usage and safe failures. Unknown usage is explicit. Cache reads, per-class cache
writes, uncached input and output are separate categories; separately billed
reasoning excludes tokens already billed as output. Safe failures distinguish
definitely unsent, definite rejection and possibly started execution; future
orchestration decides whether any bounded retry is permitted. Interrupted streams
and cancellation after dispatch never imply zero usage or a released money reserve.

Browser checks remain **UNRUN (deferred by user)**. Database verification remains
**UNRUN (deferred by user — until Version 1 implementation is complete)**. Live
provider proof remains **UNRUN (requires separately authorized operator budget and
reviewed inputs)**. See [verification policy](verification-policy.md) and
[AI evidence](evidence/ai/README.md); all corresponding acceptance gates remain OPEN.
