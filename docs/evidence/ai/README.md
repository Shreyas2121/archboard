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
AI-C07 delivers bounded provider execution, cancellation/drain and fenced recovery.
AI-C08 delivers exact private result reuse and bounded encrypted retention.
AI-C09 delivers authenticated strict HTTP routes, bounded body/SSE transport and safe availability.
AI-C10 delivers reviewed prompt/form/JSON inputs, private creation intent and typed bounded transport.
AI-C11 delivers fresh semantic mapping, a terminable layout worker, deterministic fallback and detached full-state preflight.
AI-C12 delivers isolated review, additive structural Apply, stable scoped recovery and new-private-board import.
AI-C13 delivers reviewed grounded explanations, bounded private follow-up history and local reference highlights.
AI-C14 delivers reviewed scoped edits, complete candidate preflight, field preconditions and scoped replay barriers.
AI-C15 delivers reviewed append/replacement presentation proposals, derived viewports and private walkthrough highlights.
AI-C16 delivers optional per-model provider cache controls, stable private-data boundaries and disjoint usage accounting.
AI-C17 delivers bounded cleanup/recovery, safe aggregate diagnostics, marker-based spending disable, circuit breakers and bounded shutdown.
AI-C18 delivers focused boundary regressions, expired-lease discovery, AI credential scans and recoverable acceptance procedures.
AI-C19 is **NOT STARTED**;
AI-X01 is **NOT STARTED / separately selected optional work**. AI implementation,
browser/database/live-provider acceptance, and the original Version 1 production
release gate remain **OPEN**. The [Phase 8 closure](../../phase-8-closure.md) does
not establish the original M00–M08 implementation-completion trigger.

| Task   | Implementation status | Commit / parent                                                                               | Evidence and scope                                                                                                                               |
| ------ | --------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| AI-C00 | DOCUMENTED            | `3c1e6b324cbc06bd616d74d2e122020c41cec0f7`; parent `e3ba28cab6503d32de247ea7f355eedf9bdc8abc` | [AI-C00](AI-C00.md): accepted baseline, provider boundaries, verification deferrals, and C01 handoff                                             |
| AI-C01 | IMPLEMENTED           | `b57d165fdf9d671050bdb691ee108dc907a1583d`; parent `3c1e6b324cbc06bd616d74d2e122020c41cec0f7` | [AI-C01](AI-C01.md): versioned strict contracts, grounding/reference checks, limits and database-free fixtures                                   |
| AI-C02 | IMPLEMENTED           | `6064264dd489edf367ed4a26d9bdb87f58d4fbf0`; parent `b57d165fdf9d671050bdb691ee108dc907a1583d` | [AI-C02](AI-C02.md): provider port/registry, optional finite limits, secret-safe config, fixture/DI tests and static guards                      |
| AI-C03 | IMPLEMENTED           | `fdda6b362c4fb581b5f73b7b46fb3e0c613b4f1e`; parent `6064264dd489edf367ed4a26d9bdb87f58d4fbf0` | [AI-C03](AI-C03.md): OpenAI Responses adapter, prompt/schema rendering, bounded SDK fixture transports and safe usage/failures                   |
| AI-C04 | IMPLEMENTED           | `fa2e967e8c6b25508f5f3fbd1f4ac712e043141c`; parent `fdda6b362c4fb581b5f73b7b46fb3e0c613b4f1e` | [AI-C04](AI-C04.md): shared suite against SDK/SSE and independent fixtures, safe capability selection and static isolation checks                |
| AI-C05 | IMPLEMENTED           | `10a08bdb04a140453daeed7e793964b919747d57`; parent `fa2e967e8c6b25508f5f3fbd1f4ac712e043141c` | [AI-C05](AI-C05.md): durable runs/receipts/reservations, immutable accounting, encrypted payloads and prepared PostgreSQL tests                  |
| AI-C06 | IMPLEMENTED           | `f21dccbd9ee845d81c7e3e0611719d7a3763aba2`; parent `10a08bdb04a140453daeed7e793964b919747d57` | [AI-C06](AI-C06.md): durable quota/funding gates, integer pricing, per-attempt claims and unknown-liability rollover                             |
| AI-C07 | IMPLEMENTED           | `e4161e74f24a4a8d8f51952f3082206458265a3f`; parent `f21dccbd9ee845d81c7e3e0611719d7a3763aba2` | [AI-C07](AI-C07.md): bounded dispatch/retry/repair, cancel/drain, recovery fences and authorized subscriptions                                   |
| AI-C08 | IMPLEMENTED           | `5e494b60a9dab7f06e53014975a3ac636bb9e215`; parent `e4161e74f24a4a8d8f51952f3082206458265a3f` | [AI-C08](AI-C08.md): exact keyed identity, private result reuse, aggregate encrypted retention and prepared DB races/faults                      |
| AI-C09 | IMPLEMENTED           | `23b33910694028fefbd6f3d72c009dcf16d6926e`; parent `5e494b60a9dab7f06e53014975a3ac636bb9e215` | [AI-C09](AI-C09.md): authenticated routes, bounded body/SSE transport, advisory allowance and prepared real session/stream fixtures              |
| AI-C10 | IMPLEMENTED           | `9d6c96cf9a007de62cded23ea7b19ff53ff49a48`; parent `23b33910694028fefbd6f3d72c009dcf16d6926e` | [AI-C10](AI-C10.md): reviewed cloud inputs, private session boundaries, frozen recovery identity and Node transport fixtures                     |
| AI-C11 | IMPLEMENTED           | `889bc95c4ac7cf87fc37af5ce182b8c60e3f176d`; parent `9d6c96cf9a007de62cded23ea7b19ff53ff49a48` | [AI-C11](AI-C11.md): fresh IDs, bounded geometry, ELK worker lifecycle/fallback and detached candidate preflight                                 |
| AI-C12 | IMPLEMENTED           | `621543880a83a28c5f858cb0c1528a6c336be24a`; parent `889bc95c4ac7cf87fc37af5ce182b8c60e3f176d` | [AI-C12](AI-C12.md): isolated review, additive Apply, immutable ID recovery, truthful ACK state and authorized new-board import                  |
| AI-C13 | IMPLEMENTED           | `89a8ed5ecba8741866e21bccc461637939c960a0`; parent `621543880a83a28c5f858cb0c1528a6c336be24a` | [AI-C13](AI-C13.md): grounded selected-context guidance, bounded private history, exact reuse and private scoped highlights                      |
| AI-C14 | IMPLEMENTED           | `2908c26ffe07ca6aed1c95e875ef9af8033f0ba4`; parent `89a8ed5ecba8741866e21bccc461637939c960a0` | [AI-C14](AI-C14.md): reviewed scoped diffs, current field preconditions, candidate preflight, normal Undo and replay barriers                    |
| AI-C15 | IMPLEMENTED           | `7cd11865dd654ad3210b745ae7f79353aed1d948`; parent `2908c26ffe07ca6aed1c95e875ef9af8033f0ba4` | [AI-C15](AI-C15.md): reviewed ordered walkthroughs, explicit append/replacement, validated viewports, normal commands and private highlights     |
| AI-C16 | IMPLEMENTED           | `ad05052b4f4b90f7251e9311b0271f652663d49a`; parent `7cd11865dd654ad3210b745ae7f79353aed1d948` | [AI-C16](AI-C16.md): per-model cache controls, stable static prefixes, private partitions, usage conservation and write-premium accounting       |
| AI-C17 | IMPLEMENTED           | `203dc074d3acb7a3a33965537f7845a0bb4a747e`; parent `ad05052b4f4b90f7251e9311b0271f652663d49a` | [AI-C17](AI-C17.md): bounded retention/recovery, redacted metrics, persistent marker switch, circuit breakers and shutdown/rotation runbook      |
| AI-C18 | IMPLEMENTED           | Introducing commit of AI-C18 evidence; parent `203dc074d3acb7a3a33965537f7845a0bb4a747e`      | [AI-C18](AI-C18.md): public orchestration races, price partitions, lease recovery, lost Apply response, AI secret scans and acceptance inventory |

Resolve the introducing commit after it lands:

```powershell
git log --diff-filter=A -1 --format=%H -- docs/evidence/ai/AI-C18.md
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

Select [AI-C19](../../../guide.md#ai-c19--operator-and-product-handoff), depending on the actual AI-C18 commit. Complete operator/product handoff and the final delivered-commit inventory with all OPEN gates. Use the [verification inventory](../../ai-verification.md) without aggregates that hide deferred children. Preserve the [operations contract](../../ai-operations.md), accounting and unknown liabilities independently of private payload expiry, optional per-model cache controls and conservative write pricing, reviewed presentations/scoped edits, private guidance/history/highlights, stable scoped recovery, account/editability/archive/expiry guards, offline persistence and committed ACK semantics. Preserve private reviewed creation intent, current authority, committed dispatch claims, the [HTTP contract](../../ai-http.md) and the [cache contract](../../ai-cache.md). Do not log private content or add paid background probes/warmers.
Database checks remain deferred until the user's Version 1 implementation trigger.
Preserve the neutral provider port and
[operator configuration](../../ai-operator-configuration.md).
Money/provider ceilings have finite defaults and optional validated overrides under
the user's AI-C02 update. Fixture and config proof do not close runtime acceptance.
