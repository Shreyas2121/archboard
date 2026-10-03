# AI-C00 — Documentation baseline and branch handoff

Date: 3 October 2026.
Branch: `ai-diagram-integration`.
Parent: `e3ba28cab6503d32de247ea7f355eedf9bdc8abc` (`updated`).
Commit subject: `docs(ai): record provider-independent implementation handoff`.
Scope: preserve the accepted planning documents and establish the AI evidence
index, implementation status, verification deferrals, and next-task handoff.

## Changes and contracts

The branch was created from the clean `main` baseline
`3bce673e58d3c0dae9c9c6b301710e1ffffc519c`. On resumption it contained the newer
accepted planning commit `e3ba28cab6503d32de247ea7f355eedf9bdc8abc`; this task uses
that current parent without resetting or overwriting it.
[guide.md](../../../guide.md) and [plan-ai.md](../../../plan-ai.md) were already
tracked by those planning commits. Their content is preserved unchanged and
included in the formatting and local-link checks.

The latest plan requires provider-independent infrastructure with OpenAI as the
only initial production adapter. The official `openai` SDK belongs only in the
NestJS backend adapter; shared DTOs, the provider port, orchestration, frontend,
and document commands must remain independent of its types and request fields.
Claude implementation, SDK installation, credentials, and actual switchability
are deferred. GitHub is the only login; all AI credentials, provider/model
configuration, pricing, quotas, and budgets remain server-owned.

The [evidence index](README.md) identifies AI-C00 as documentation delivered and
AI-C01–AI-C19 as NOT STARTED. Exact private caching, encrypted bounded retention,
durable admission, conservative unknown-outcome accounting, reviewed additive
Apply, normal offline/outbox persistence, and committed ACK behavior are future
implementation requirements. This task modifies no application code, installs no
dependencies, initializes no paid account, and makes no provider request.

## Checks

- `pnpm.cmd exec prettier --check --ignore-path .gitignore guide.md plan-ai.md docs/evidence/ai/AI-C00.md docs/evidence/ai/README.md`:
  PASS after formatting. The explicit ignore-path override includes `guide.md`,
  which the default `.prettierignore` excludes.
- PowerShell local Markdown link/anchor validation across those four documents:
  PASS (20 links/anchors);
  relative file targets and referenced heading anchors resolve. External provider
  citations are preserved planning references, not revalidated API contracts.
- `git diff --check` and `git diff --cached --check`: PASS.
- `git branch --show-current`: `ai-diagram-integration`.
- Exact staged file review: `docs/evidence/ai/AI-C00.md` and
  `docs/evidence/ai/README.md` only. The already committed guide and plan require
  no formatting changes.

No runtime tests are needed for this documentation-only task. Formatting and
source/link inspection provide documentation proof only.

## Deferred acceptance

- Browser/Playwright/native browser/served-preview/OAuth-browser checks:
  **UNRUN (deferred by user)**.
- PostgreSQL/Neon/database-backed HTTP/auth/session/socket/schema/migration checks:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
- Live model requests, provider compatibility, and model quality/cost evaluation:
  **UNRUN (requires separately authorized operator budget and reviewed inputs)**.

All corresponding AI acceptance gates and the original Version 1 production
release gate remain **OPEN**. The [verification policy](../../verification-policy.md)
and [Phase 8 closure](../../phase-8-closure.md) preserve the original M00–M08
completion trigger. Completing AI-C00 does not resume any deferred verification.
No push, merge, deployment, configured migration, or optional helper work occurs.

## Handoff

Next: [AI-C01 — shared input, output, lifecycle, limits](../../../guide.md#ai-c01--shared-input-output-lifecycle-limits),
whose dependency is this task's actual commit. Read the current guide and plan,
implement bounded strict contracts and database-free fixtures, and add its evidence
and index entry. Read the applicable nested instructions before touching API or
frontend code in later tasks.

The actual AI-C00 hash is reported after committing and can be recovered with
`git log --diff-filter=A -1 --format=%H -- docs/evidence/ai/AI-C00.md`.
Record it in the next index update rather than embedding this commit's own hash.
