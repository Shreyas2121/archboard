# AI-C01 — Shared input, output, lifecycle, limits

Date: 3 October 2026.
Branch: `ai-diagram-integration`.
Parent: `3c1e6b324cbc06bd616d74d2e122020c41cec0f7` (AI-C00).
Commit subject: `feat(contracts): define AI context proposal and run schemas`.
Scope: versioned strict shared AI DTOs, contextual result validation, byte/token
preflight contracts, safe errors, public exports, and database-free fixtures.

## Changes and contracts

The [contract reference](../../../packages/contracts/src/ai/README.md) fixes the
version-1 names and downstream validation sequence. Every object schema rejects
unknown fields. Project context requires kind/version/project; omitted input
collections and history normalize to empty arrays without trimming prompt text or
reordering arrays. Components, groups and evidence have unique logical keys;
connections, groups and evidence references must resolve. Evidence paths reject
absolute paths, URLs, backslashes, controls and traversal; line ranges and aggregate
excerpt limits are checked. These paths are labels, never read permissions.

Semantic proposal keys reject UUIDs, including UUIDs beginning with letters.
Diagram proposals reuse existing typed graph content and text limits while excluding
graph IDs, coordinates, dimensions and handles. Nodes, edges, boundaries and ordered
steps have independent ceilings and complete internal-reference checks. Clarification
is limited to three questions. Claims distinguish provided/evidenced/proposed content;
evidenced claims require supplied evidence keys. Guidance highlights remain private
UUID references to the reviewed selection.

Scoped operation contracts allow typed node/edge additions, node renames, edge
label/protocol changes, and typed content changes with explicit field preconditions.
They reject deletion, arbitrary patches, immutable endpoint/kind edits and whole
document replacement. Presentation proposals name append or reviewed replacement,
existing object references and reviewed step IDs; application code supplies geometry.

`aiResultForRequestSchema` adds task/evidence/selection validation to structural
result validation. It checks additive edge bindings, edit target kinds and exact
reviewed field preconditions. Application-time live preconditions, authorization,
candidate preflight and mutation remain future work; these schemas cannot establish
factual accuracy or authorize an edit.

Create requests accept no provider, model, credential, endpoint, tool, system-role
history or cost authority. Runs/events are versioned and strict; run state must
agree with content/failure and available result task. Expired results contain no
private payload. SSE carries bounded deltas and result notices rather than large
proposal bodies. Public failures expose codes and optional retry delays, with no
raw SDK message/request identity. Availability supports nullable unknown reset/money
facts. Sequence and integer micro-USD fields use canonical decimal strings.

Shared limits distinguish 1 MiB raw context files, 8 MiB encoded HTTP requests,
512 KiB serialized results and 16 KiB events. `parseProjectContextFile` checks raw
UTF-8 before JSON parsing; schemas check normalized serialized sizes. Future HTTP
adapters must enforce raw request byte limits before parsing, including whitespace.
Token preflight accepts server counting facts and rejects input/window overflow with
reserved output. No tokenizer, model/pricing profile or counting algorithm is
implemented here; rendered instructions/schema/history/overhead must be counted by
the future server implementation.

All schemas, types and limits are exported from `@archboard/contracts`. Runtime
dependencies remain Zod plus existing shared contracts; no SDK/UI/provider dependency
was added. API/frontend consumers are implemented in their later tasks. GitHub-only
login and server-owned OpenAI configuration remain unchanged requirements.

## Checks

- From `packages/contracts`, `node ../../node_modules/vitest/vitest.mjs run`:
  **PASS — 211 tests / 10 files**, including **47 AI cases**. Covers malformed and
  future input, unknown authority fields, duplicates, references, path/line/excerpt
  constraints, escaping/UTF-8 byte limits, token preflight, typed edits, grounding,
  expiry, inconsistent lifecycle, exact money and privacy-safe events/errors.
- `pnpm.cmd --filter @archboard/contracts typecheck`: **PASS**.
- `pnpm.cmd --filter @archboard/contracts build`: **PASS**, emitting public exports.
- `pnpm.cmd lint`: **PASS** for the workspace. After the final schema refinements,
  `node node_modules/eslint/bin/eslint.js packages/contracts/src/ai packages/contracts/src/index.ts packages/contracts/src/limits/index.ts packages/contracts/src/errors`:
  **PASS** for every affected source/test file.
- `pnpm.cmd typecheck`: **PASS** across all workspace consumers and the frontend
  Node harness; this compiles tests without executing browser/database checks.
- `pnpm.cmd boundary:check`: **PASS**, including four negative import fixtures.
- `pnpm.cmd exec prettier --check packages/contracts/src/ai packages/contracts/src/index.ts packages/contracts/src/limits/index.ts packages/contracts/src/errors/index.ts packages/contracts/src/errors/index.test.ts docs/evidence/ai/AI-C01.md docs/evidence/ai/README.md`:
  **PASS**.
- Local Markdown links/anchors and `git diff --check` /
  `git diff --cached --check`: **PASS**.

The initial `pnpm.cmd --filter @archboard/contracts exec vitest run src/ai` and
`pnpm.cmd exec eslint ...` attempts could not resolve their binaries in this
environment. The checks above ran their installed entrypoints directly, with no
dependency installation or changed test configuration. Fixtures prove contract
handling; they are not real provider, authorization, database or rendered UI proof.

## Deferred acceptance

- Browser/Playwright/native browser/served-preview/OAuth-browser checks:
  **UNRUN (deferred by user)**.
- PostgreSQL/Neon/database-backed HTTP/auth/session/socket/schema/migration checks:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
- Live model requests, compatibility, quality, latency and cost evaluation:
  **UNRUN (requires separately authorized operator budget and reviewed inputs)**.

Corresponding acceptance gates and the original Version 1 release gate remain
**OPEN** under the [verification policy](../../verification-policy.md). No runtime
endpoint, adapter, durable admission, cache, graph mutation, migration, deployment,
paid account or live request is delivered by this task. No database/browser test
harness is added for contracts; recover those cases when their owning runtime tasks
are implemented and the applicable verification conditions permit execution.

## Handoff

Next: [AI-C02](../../../guide.md#ai-c02--operator-configuration-and-provider-port),
depending on this task's actual commit. Read the API instructions, implement the
neutral provider port and validated server-only operator configuration, and reject
unimplemented production providers. Use these shared contracts rather than SDK
objects or duplicated DTOs. Add counting/model/pricing authority only server-side.

Resolve this task's actual hash after committing with
`git log --diff-filter=A -1 --format=%H -- docs/evidence/ai/AI-C01.md`, and map it in
the next index update without embedding a commit's own hash. AI-C02–AI-C19 remain
NOT STARTED; AI-X01 still requires separate selection.
