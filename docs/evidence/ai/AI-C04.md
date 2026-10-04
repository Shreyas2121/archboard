# AI-C04 — Provider abstraction boundary checks

Date: 4 October 2026.
Branch: `ai-diagram-integration`.
Parent: `fdda6b362c4fb581b5f73b7b46fb3e0c613b4f1e` (AI-C03).
Commit subject: `test(api): verify AI provider abstraction boundaries`.
Scope: shared provider contract suite, independent test-only implementation,
application consumption/registry/config checks and static dependency boundaries.

## Implemented proof and behavior

The same SDK-free provider suite now runs through the application registry against
the real OpenAI adapter with local SSE transport and against `FixtureAiProvider`,
an independent scripted implementation with no SDK dependency. It covers completed,
refused, incomplete and unknown-usage results, partial stream failure, cancellation
before/during execution, unsupported model/schema, native request extras, elapsed
deadlines and response byte ceilings. Raw OpenAI fixtures and response assertions
stay inside the OpenAI adapter directory. The independent fixture still uses the
closed neutral provider ID and a `test-fixture` implementation brand; it is not a
Claude adapter or a claim of live cross-provider compatibility.

A test-only application consumer exercises the real registry and neutral port,
events, usage and failures, with no SDK import or provider-native field inspection.
It preserves unknown usage and disjoint input/cache-write/output/reasoning categories,
does not turn partial work into success or retry an uncertain outcome, and rejects
extra native payloads through the shared event contract. Production run orchestration
belongs to C07; this task verifies its dependency contract without introducing a
second production service or HTTP route.

The shared suite exposed a fixture cancellation edge: cancellation after the last
delta previously reached the generic partial-stream failure. The fixture now checks
cancellation/deadline at exhaustion and maps invalid neutral requests to sanitized
`AiProviderError` rather than exposing Zod diagnostics. These changes apply only to
the test implementation, which remains excluded from the production build.

Registry resolution now requires native structured output in both profile and
adapter. A `structuredOutput: false` profile fails closed even when its adapter also
reports false; no untested plain-text fallback is selectable. Unknown implementation
brands are rejected in every mode. Existing production/development rejection of
test fixtures and duplicate/unimplemented adapters remains covered. Capability
exceptions become safe unsupported-capability failures before dispatch.

Enabled configuration rejects Anthropic/Claude, fixture, Gemini, Azure and arbitrary
OpenAI-compatible provider selections. Valid synthetic API configurations in test,
development and production prove that credentials for an unimplemented provider
do not enable it. Disabled AI continues ignoring inactive settings and has no
resolvable provider. Optional money/provider ceiling overrides and finite defaults
from the user's C02 update remain unchanged.

The AST boundary scan now resolves relative paths and checks SDK imports in API and
shared-package test files as well as production source. It rejects indirect adapter
and SDK-barrel imports from neutral layers, server-internal imports from shared
contracts/graph commands/frontend code, production application imports of composition,
configuration or infrastructure, and production imports of AI test fixtures. Literal
dynamic imports, template literals, import types, exports and `require` are covered;
computed module imports are rejected in production neutral layers. Provider-native
type/request/event names are rejected outside the adapter in neutral layers and AI
feature source, including tests. Tests may deliberately contain public environment
names to check config rejection; SDK import boundaries still apply to those tests.

Negative fixtures cover Windows path normalization, native field access/interfaces,
provider event names, direct/indirect imports, SDK-free test-helper isolation and
production fixture leakage. Positive fixtures preserve legitimate Nest composition,
neutral consumers, test-only helpers and adapter-local SDK imports. These are static
architectural guards, not proof against arbitrary runtime code generation.

## Verification

Executed checks use local synthetic configuration/transports only:

| Check                                                                  | Result                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Focused API Jest: `modules/ai\|config\|startup-diagnostics`            | **PASS** — 191 tests, 7 suites                                                  |
| Shared neutral provider suite                                          | **PASS** — 12 cases each against OpenAI SSE and independent SDK-free fixtures   |
| API `typecheck` and production `build`                                 | **PASS** — no database connections; build copies checked-in SQL assets          |
| Root `lint`                                                            | **PASS**                                                                        |
| Boundary scanner with negative fixtures                                | **PASS** — 31 AI and 4 existing negative cases, 6 allowed AI cases              |
| Changed-file formatting, local documentation links and diff whitespace | **PASS**                                                                        |
| Production fixture/application-test exclusion                          | **PASS** — test implementation, suite and consumption harness absent from build |

## Deferred proof and handoff

- Browser/Playwright/native browser/served-preview acceptance:
  **UNRUN (deferred by user)**.
- PostgreSQL/Neon/database-backed HTTP/auth/session/socket/schema/migration checks:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
- Live OpenAI model/account/schema compatibility, quality, latency and cost:
  **UNRUN (requires separately authorized operator budget and reviewed inputs)**.
- Claude SDK, credentials, real model/schema compatibility and switching:
  **NOT IMPLEMENTED / separately selected future work**.

Browser/database/provider acceptance and the original Version 1 release gate remain
**OPEN**. No live inference, push, merge, deployment or configured migration occurred.
Fixture separation does not establish real provider switchability or close runtime
accounting/authorization acceptance.

Next: [AI-C05](../../../guide.md#ai-c05--durable-runs-receipts-and-accounting-intent),
using this task's actual introducing commit. Implement durable runs, receipts,
accounting intent and encrypted bounded payload storage with forward migration
sources and prepared integration tests. Database execution remains deferred until
the user's Version 1 implementation-completion trigger is met.
