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
AI-C04–AI-C19 are **NOT STARTED**;
AI-X01 is **NOT STARTED / separately selected optional work**. AI implementation,
browser/database/live-provider acceptance, and the original Version 1 production
release gate remain **OPEN**. The [Phase 8 closure](../../phase-8-closure.md) does
not establish the original M00–M08 implementation-completion trigger.

| Task   | Implementation status | Commit / parent                                                                               | Evidence and scope                                                                                                             |
| ------ | --------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| AI-C00 | DOCUMENTED            | `3c1e6b324cbc06bd616d74d2e122020c41cec0f7`; parent `e3ba28cab6503d32de247ea7f355eedf9bdc8abc` | [AI-C00](AI-C00.md): accepted baseline, provider boundaries, verification deferrals, and C01 handoff                           |
| AI-C01 | IMPLEMENTED           | `b57d165fdf9d671050bdb691ee108dc907a1583d`; parent `3c1e6b324cbc06bd616d74d2e122020c41cec0f7` | [AI-C01](AI-C01.md): versioned strict contracts, grounding/reference checks, limits and database-free fixtures                 |
| AI-C02 | IMPLEMENTED           | `6064264dd489edf367ed4a26d9bdb87f58d4fbf0`; parent `b57d165fdf9d671050bdb691ee108dc907a1583d` | [AI-C02](AI-C02.md): provider port/registry, optional finite limits, secret-safe config, fixture/DI tests and static guards    |
| AI-C03 | IMPLEMENTED           | Introducing commit of AI-C03 evidence; parent `6064264dd489edf367ed4a26d9bdb87f58d4fbf0`      | [AI-C03](AI-C03.md): OpenAI Responses adapter, prompt/schema rendering, bounded SDK fixture transports and safe usage/failures |

Resolve the introducing commit after it lands:

```powershell
git log --diff-filter=A -1 --format=%H -- docs/evidence/ai/AI-C03.md
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

Select [AI-C04](../../../guide.md#ai-c04--provider-abstraction-boundary-checks), depending on the actual
AI-C03 commit. Apply the SDK-free shared provider suite to both the OpenAI fixture
transport and the independent test-only implementation; strengthen registry/static
dependency boundary proof. Preserve the neutral provider port and
[operator configuration](../../ai-operator-configuration.md).
Money/provider ceilings have finite defaults and optional validated overrides under
the user's AI-C02 update. Fixture and config proof do not close runtime acceptance.
