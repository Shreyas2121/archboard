# AI implementation evidence index

Branch: `ai-diagram-integration`.
Accepted planning baseline: `e3ba28cab6503d32de247ea7f355eedf9bdc8abc` (`updated`),
which includes the planning documents first committed in
`3bce673e58d3c0dae9c9c6b301710e1ffffc519c` (`docs`).

Authority: [implementation guide](../../../guide.md), [AI plan](../../../plan-ai.md),
and [verification policy](../../verification-policy.md).

AI-C00 delivers the documentation baseline; AI-C01 delivers shared contracts.
AI-C02 delivers the neutral provider/configuration foundation.
AI-C03 delivers the OpenAI Responses adapter and fixture transport proof.
AI-C04 delivers shared provider and abstraction boundary proof.
AI-C05 delivers durable run/accounting intent and bounded encrypted result storage.
AI-C06 delivers durable admission, conservative pricing, attempt claims and rollover-safe accounting.
AI-C07–AI-C19 are **NOT STARTED**;
AI-X01 is **NOT STARTED / separately selected optional work**. AI implementation,
browser/database/live-provider acceptance, and the original Version 1 production
release gate remain **OPEN**. The [Phase 8 closure](../../phase-8-closure.md) does
not establish the original M00–M08 implementation-completion trigger.

| Task   | Implementation status | Commit / parent                                                                               | Evidence and scope                                                                                                                |
| ------ | --------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| AI-C00 | DOCUMENTED            | `3c1e6b324cbc06bd616d74d2e122020c41cec0f7`; parent `e3ba28cab6503d32de247ea7f355eedf9bdc8abc` | [AI-C00](AI-C00.md): accepted baseline, provider boundaries, verification deferrals, and C01 handoff                              |
| AI-C01 | IMPLEMENTED           | `b57d165fdf9d671050bdb691ee108dc907a1583d`; parent `3c1e6b324cbc06bd616d74d2e122020c41cec0f7` | [AI-C01](AI-C01.md): versioned strict contracts, grounding/reference checks, limits and database-free fixtures                    |
| AI-C02 | IMPLEMENTED           | `6064264dd489edf367ed4a26d9bdb87f58d4fbf0`; parent `b57d165fdf9d671050bdb691ee108dc907a1583d` | [AI-C02](AI-C02.md): provider port/registry, optional finite limits, secret-safe config, fixture/DI tests and static guards       |
| AI-C03 | IMPLEMENTED           | `fdda6b362c4fb581b5f73b7b46fb3e0c613b4f1e`; parent `6064264dd489edf367ed4a26d9bdb87f58d4fbf0` | [AI-C03](AI-C03.md): OpenAI Responses adapter, prompt/schema rendering, bounded SDK fixture transports and safe usage/failures    |
| AI-C04 | IMPLEMENTED           | `fa2e967e8c6b25508f5f3fbd1f4ac712e043141c`; parent `fdda6b362c4fb581b5f73b7b46fb3e0c613b4f1e` | [AI-C04](AI-C04.md): shared suite against SDK/SSE and independent fixtures, safe capability selection and static isolation checks |
| AI-C05 | IMPLEMENTED           | `10a08bdb04a140453daeed7e793964b919747d57`; parent `fa2e967e8c6b25508f5f3fbd1f4ac712e043141c` | [AI-C05](AI-C05.md): durable runs/receipts/reservations, immutable accounting, encrypted payloads and prepared PostgreSQL tests   |
| AI-C06 | IMPLEMENTED           | Introducing commit of AI-C06 evidence; parent `10a08bdb04a140453daeed7e793964b919747d57`      | [AI-C06](AI-C06.md): durable quota/funding gates, integer pricing, per-attempt claims and unknown-liability rollover              |

Resolve the introducing commit after it lands:

```powershell
git log --diff-filter=A -1 --format=%H -- docs/evidence/ai/AI-C06.md
```

Map that actual hash in the next task's index update; do not amend this evidence to
embed its own commit hash. Later fixes receive new commits.

## Required architecture

GitHub remains the only login. AI credentials, model selection, pricing, budgets,
and rate limits are operator-owned server configuration. The initial production
adapter is OpenAI Responses with the official `openai` SDK confined to the backend
adapter. A neutral port isolates public contracts, orchestration, and graph
commands from SDK types and provider-native request fields. Claude implementation
and real provider switching are deferred; unimplemented providers must be rejected.

Future tasks must preserve exact actor-private caching with current authorization,
bounded encrypted result retention, durable admission and cost reservations,
unknown-outcome accounting without automatic resubmission, reviewed proposals,
normal document commands, offline persistence, and committed server ACK semantics.
These are requirements, not behavior delivered by AI-C00.

## Deferred acceptance

- Browser/Playwright/native browser/served-preview/OAuth-browser checks:
  **UNRUN (deferred by user)**.
- PostgreSQL/Neon/database-backed HTTP/auth/session/socket/schema/migration checks:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
- Live model requests, compatibility, quality, latency, and cost evaluation:
  **UNRUN (requires separately authorized operator budget and reviewed inputs)**.

Focused fixture, formatting, build, or static checks cannot close those acceptance
gates. Follow the guide's per-task checks and evidence requirements; do not run
aggregates that launch deferred children.

## Next task

Select [AI-C07](../../../guide.md#ai-c07--run-orchestration-and-recovery), depending on the actual
AI-C06 commit. Implement provider execution outside locks, classified bounded
retry/repair, lease/crash/shutdown recovery and bounded retained outputs/subscribers.
Use the [admission/accounting ports](../../ai-admission.md) and
[persistence contract and lock order](../../ai-persistence.md).
Database checks remain deferred until the user's Version 1 implementation trigger.
Preserve the neutral provider port and
[operator configuration](../../ai-operator-configuration.md).
Money/provider ceilings have finite defaults and optional validated overrides under
the user's AI-C02 update. Fixture and config proof do not close runtime acceptance.
