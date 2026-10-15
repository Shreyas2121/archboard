# AI-C02 — Operator configuration and provider port

Date: 3 October 2026.
Branch: `ai-diagram-integration`.
Parent: `b57d165fdf9d671050bdb691ee108dc907a1583d` (AI-C01).
Commit subject: `feat(api): add AI provider port and operator configuration`.
Scope: neutral provider contracts, validated server policy, immutable configuration
snapshots, registry/Nest wiring, test-only transport and static dependency guards.

## Changes and contracts

The AI application port defines bounded neutral instructions/messages, task,
versioned structured-output schema, output tokens/bytes, total deadline and prompt
cache policy. Provider field names and SDK types stay outside the port. Capabilities,
stream completion/refusal/incomplete events, safe failures and usage have runtime
validation. Unknown usage is explicit; uncached input, cache reads, per-class writes,
output and separately billed reasoning are distinct categories. Diagnostic reasoning
does not add a second output charge. Failure metadata distinguishes definitely unsent,
definite rejection and possibly started work. Malformed diagnostics become a safe
uncertain transport error rather than leaking raw exception fields.

`loadApiConfig` now includes AI configuration, disabled by default. Enabled AI requires
server-owned OpenAI selection, explicit model/version/namespace settings, bounded
strict model profiles with pricing/counting versions, a provider credential, and
distinct cache-hash/content-encryption keys. No Anthropic key or SDK is required.
Errors expose setting names without rejected values or JSON content. Startup
diagnostics use the existing fixed-variable whitelist. AI secrets are non-enumerable
in the configuration and are absent from resolved policy snapshots.

**User override during this task:** money ceilings and provider RPM/input/output TPM
settings are optional. Omitted or blank values resolve to finite application defaults:
`1000000` micro-USD daily ($1), `5000000` monthly ($5), `10000000` lifetime/global
($10), 2 RPM, 60,000 input TPM and 10,000 output TPM. The separate per-actor daily
money ceiling remains optional/null. Explicit overrides are validated and included
in policy fingerprints; they do not permit malformed/zero/unbounded values. Model
profiles must still fit the resolved token ceilings. Provider account quotas are not
inferred from these application defaults. The updated guide and
[operator reference](../../ai-operator-configuration.md) preserve this override for
later tasks; pricing/model/token-counting authority remains operator-owned.

Resolved profile/policy snapshots are deeply frozen. Stable prompt/schema/adapter/
product-policy versions and canonical nonsecret configuration fingerprints support
new-run invalidation without redirecting existing snapshots. Object property order
and credential-only changes do not change a policy fingerprint. Array order is
preserved. This task provides no dynamic reload controller or run persistence.

The registry accepts only OpenAI production adapters, rejects duplicates and
unimplemented providers, checks capabilities before resolution, and fails closed
when disabled or unregistered. Test fixtures are rejected in development/production.
`AiModule` binds feature-owned policy, secrets, adapters and registry tokens and is
registered in `AppModule`. Its adapter list is empty until AI-C03. Thus valid enabled
configuration can compose, but resolution remains unavailable; no mocked fallback,
paid route or real inference is enabled by C02.

The deterministic fixture transport exercises terminal events, unknown usage,
interruption, cancellation, output bounds and unsupported capabilities without
network/database access. It and its synthetic configuration are explicitly excluded
from production builds. Boundary checks cover static imports/exports, dynamic
imports, require/import-equals and import-type SDK references, frontend SDK dependencies,
deferred Anthropic SDK installation, direct frontend AI configuration imports, and
AI-related `VITE_*` settings. Eleven negative AI fixtures supplement the four existing
dependency fixtures. The checker scans all API sources and frontend AI boundaries.

The [operator reference](../../ai-operator-configuration.md) documents required
profile/key setup, optional defaults, limits, disable behavior and remaining proof.
`.env.example` contains empty AI placeholders only. No dependencies were installed.

## Checks

- From `apps/api`,
  `node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.config.cjs --runInBand --testPathPatterns 'platform/config|modules/ai|startup-diagnostics.spec'`:
  **PASS — 99 tests / 4 suites**, using configuration parsing, deterministic fixtures
  and an isolated Nest context without the database/HTTP application. Covers omitted
  and blank optional ceilings, explicit overrides, invalid money/rates, secret-safe
  errors/startup logging, frozen canonical snapshots, model/quality resolution,
  capabilities, no production fixtures, unknown usage, interrupted/cancelled streams,
  bounds and DI wiring. No live account validity or database behavior is proven.
- `pnpm.cmd --filter @archboard/api typecheck`: **PASS**.
- `pnpm.cmd --filter @archboard/api build`: **PASS**. Its asset-copy child copies
  checked-in SQL source only; it does not inspect or connect to a configured database.
- `pnpm.cmd lint`: **PASS** for the workspace.
- `pnpm.cmd boundary:check`: **PASS**, including 11 AI and four existing negative
  fixtures; 218 production sources and 909 static imports inspected.
- `pnpm.cmd exec prettier --check --ignore-path .gitignore apps/api/src/modules/ai apps/api/src/platform/config apps/api/src/platform/lifecycle/startup-diagnostics.ts apps/api/src/platform/lifecycle/startup-diagnostics.spec.ts apps/api/src/app.module.ts apps/api/tsconfig.build.json scripts/ai-boundaries.mjs scripts/check-phase1-boundaries.mjs docs/ai-operator-configuration.md docs/evidence/ai/AI-C02.md docs/evidence/ai/README.md guide.md`:
  **PASS**.
- Changed documentation links/anchors, `git diff --check` and
  `git diff --cached --check`: **PASS**. Exact staged files are this task's API,
  static-boundary, configuration/example and documentation changes only.

## Deferred acceptance

- Browser/Playwright/native browser/served-preview/OAuth-browser checks:
  **UNRUN (deferred by user)**.
- PostgreSQL/Neon/database-backed HTTP/auth/session/socket/schema/migration checks:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
- Live provider compatibility, account access, pricing, token counting, quality,
  latency and cost evaluation:
  **UNRUN (requires separately authorized operator budget and reviewed inputs)**.

All corresponding acceptance gates and the original Version 1 release gate remain
**OPEN** under the [verification policy](../../verification-policy.md). Configuration
defaults do not implement durable quotas, reservations, cache capacity or retention;
their owning tasks must enforce them. No database/browser acceptance harness is
needed for this port/configuration task. No database query, migration, live provider
call, account initialization, push, merge or deployment occurred.

## Handoff

Next: [AI-C03 — OpenAI adapter](https://github.com/Shreyas2121/archboard/blob/37b663661045f8fe6cbed7db265141b84131718e/guide.md#ai-c03--openai-adapter), depending
on this task's actual commit. Add the official pinned SDK only inside the backend
OpenAI adapter path, register that real implementation through `AI_PROVIDER_ADAPTERS`,
and use neutral fixtures to test Responses translation/terminal usage/errors/abort.
Disable SDK retries; preserve bounded deadlines and unknown-outcome classification.
Do not activate a paid endpoint before the admission/orchestration tasks.

Resolve this task's actual hash after committing with
`git log --diff-filter=A -1 --format=%H -- docs/evidence/ai/AI-C02.md`, and map it in
the next index update rather than embedding this commit's own hash. AI-C03–AI-C19
remain NOT STARTED; AI-X01 remains separately selected optional work.
