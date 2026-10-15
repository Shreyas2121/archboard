# AI-C03 — OpenAI Responses adapter

Date: 4 October 2026.
Branch: `ai-diagram-integration`.
Parent: `6064264dd489edf367ed4a26d9bdb87f58d4fbf0` (AI-C02).
Commit subject: `feat(api): implement OpenAI Responses adapter`.
Scope: production adapter, SDK dependency, versioned prompt/schema rendering,
fixture transport/shared provider suite, Nest registration and operator reference.

## Implemented behavior

The official `openai` SDK is pinned to `7.27.0` in the workspace catalog and lockfile,
and is a dependency only of the API. SDK imports/types remain inside the OpenAI
adapter directory. Application code uses the existing neutral port, events, usage
and safe failures. Nest registers a production adapter only when AI is enabled;
disabled composition has no adapter or fixture fallback. Construction and registry
resolution make no network requests. There is no product inference route in C03.

Requests translate configured model, server instructions, user/assistant text,
versioned strict JSON schema and maximum output tokens into Responses fields.
`store: false`, `background: false`, empty tools and `tool_choice: none` are explicit.
The API endpoint is fixed, organization/project environment overrides are disabled,
and SDK retries are disabled at client and request levels. SDK logging is disabled
with a silent logger, including when ambient SDK debug configuration exists.
Model IDs and output/context limits come from validated operator profiles; unknown
models, unsupported schema versions, excessive output tokens and stable-prefix
caching fail before transport. No live capability/account quota is inferred.

Caller cancellation reaches the transport without forwarding its private reason.
An adapter-owned deadline remains active after headers arrive and while SSE is
pending. Timers/listeners/transports are cleaned up on success, failure or iterator
closure. Already cancelled/expired requests are definitely unsent; interrupted
attempts remain possibly started with unknown usage unless terminal usage exists.

Visible deltas and terminal text are bounded by the request's UTF-8 response ceiling.
Neutral chunks respect the shared character limit without splitting surrogate pairs.
A separate 16 MiB raw-response ceiling bounds SSE framing, ignored events/reasoning
and HTTP error bodies before SDK frame buffering. Terminal text is assembled with
incremental byte checks. Success requires a completed response, completed message
output and consistent accumulated text; partial/text-done events, tool output,
conflicting deltas and missing terminal completion fail closed. Refusal text is not
retained/emitted. Incomplete output preserves the reason and terminal usage without
being reported as completed. Reasoning output is not emitted as user-facing text.

Known usage splits cached input from uncached input and includes reasoning once
within output; separately billed reasoning is zero. Missing, negative, inconsistent
or unsafe counts, and nonzero unpriced cache-write tokens remain unknown. The SDK's
new write-token field is not assumed to have a known billing class. HTTP quota/rate
rejections, bad requests and authentication map to safe definite-rejection failures;
5xx overload, stream failure events and transport interruptions remain possibly
started. Retry hints are bounded numeric metadata. Provider bodies, native errors,
causes, unsafe request IDs and unknown native codes do not enter application errors.
No adapter path automatically retries or resubmits uncertain work.

The provider-neutral renderer uses the shared Zod result contracts inside a strict
`{ result: ... }` model envelope. Disjoint nested `oneOf` alternatives render as
`anyOf`; unsupported URI format metadata is omitted, while local Zod validation
remains authoritative. Server instructions are versioned and task-specific. All
user text, history and supplied context stay in serialized user data. Future C07
orchestration must parse `aiModelOutputSchema`, unwrap `result`, and enforce public
task/context/grounding/reference/authorization rules before returning a result.
This commit does not claim prompt-injection immunity or factual correctness.

Capabilities are operator assertions exercised against fixture transports, not
proof of account access or every configured model. Unsupported native structured
output fails closed; no untested fallback was introduced. Money/provider ceilings
retain AI-C02's optional validated overrides and finite defaults.

## Verification

All executed checks used synthetic configuration and local transports, with no
database, browser, real credentials or live inference:

| Check                                                        | Result                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------- |
| Focused API Jest: `modules/ai\|config\|startup-diagnostics`  | **PASS** — 154 tests, 6 suites                            |
| API `typecheck`                                              | **PASS**                                                  |
| API production `build`                                       | **PASS** — compiler and checked-in SQL asset copying only |
| Root `lint`                                                  | **PASS**                                                  |
| Dependency boundaries with negative fixtures                 | **PASS** — 11 AI and 4 existing negative cases            |
| Changed-file Prettier, local evidence links, diff whitespace | **PASS**                                                  |
| Production test-fixture exclusion                            | **PASS** — fixture transport/suite absent from API build  |

Fixture coverage includes actual SDK request serialization and SSE parsing, shared
neutral terminal contracts, missing terminal output, refusal/incomplete/failed/error
events, HTTP 400/401/403/429/503/408, no retry on overload/transport failure, request
IDs/retry-header redaction, usage categories, unknown usage, output byte ceilings,
Unicode chunks, cancellation before/during execution and pending SSE deadlines.
The final focused run corrected a test-file encoding mistake detected by the Unicode
fixture; the passing result above is the corrected tree.

API details were checked with the OpenAI docs skill against the official
[streaming guide](https://developers.openai.com/api/docs/guides/streaming-responses),
[structured-output guide](https://developers.openai.com/api/docs/guides/structured-outputs),
and installed SDK `7.27.0` declarations/implementation. No API-key helper was
available; fixture work neither needed nor obtained a live key.

## Deferred proof and handoff

- Browser/Playwright/native browser/served-preview acceptance:
  **UNRUN (deferred by user)**.
- PostgreSQL/Neon/database-backed HTTP/auth/session/socket/schema/migration checks:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
- Live OpenAI model/account/schema compatibility, quality, latency and cost:
  **UNRUN (requires separately authorized operator budget and reviewed inputs)**.

Those acceptance gates and the original Version 1 release gate remain **OPEN**.
Fixture proof does not establish live schema compatibility or real cost accounting.
No push, merge, deployment, configured migration or live provider request occurred.

Next: [AI-C04](https://github.com/Shreyas2121/archboard/blob/37b663661045f8fe6cbed7db265141b84131718e/guide.md#ai-c04--provider-abstraction-boundary-checks), using
this task's actual introducing commit. Apply the SDK-free shared provider suite to
the independent test-only implementation and strengthen abstraction/registry/static
boundary proof. Implementing Claude or live provider switching remains deferred.
