# AI-C19 — Operator and product handoff

Branch: `ai-diagram-integration`.
Parent: `438c9b2d2796035c068c1ba7fba9bb768230faae`.
Commit subject: `docs(ai): document operator setup usage and deferred acceptance`.
Scope: documentation/examples only; no runtime, dependencies, environment secrets,
database or browser changes.

## Delivered handoff

- Corrected historical forward-looking operator/cache descriptions to the
  implemented routes, quota/accounting and orchestration. Operator instructions
  cover explicit OpenAI model selection, reviewed pricing/capabilities, secret
  provisioning and distinct keys, budgets/limits, disable/restart, provider-key
  versus payload/HMAC rotation, private-cache invalidation and preserved snapshots.
- Added a profile shape with deliberately nondeployable model name and synthetic
  prices. It is not live pricing or a recommended model. Documented the supported
  TTL ceiling of 900,000 ms, enforced by both loader and durable snapshot; corrected
  the old documentation table's 24-hour bound. No runtime limit was changed.
- Added a valid synthetic three-component project-context file without invented
  evidence, plus usage, adaptable prompt starters and review/guidance/scoped-edit/
  presentation flows. Explained cloud data, description inference limits, Undo,
  offline behavior, private history, cost uncertainty, recovery and result expiry.
- Linked setup, general usage and README; corrected portfolio exclusions and added
  a prepared recruiter walkthrough without claiming a recording or live result.
- Updated the evidence index with AI-C18's exact hash, all delivered commits,
  current fixture/static baseline and precise OPEN gate list. AI-C19's introducing
  hash is resolved from history after commit; historical evidence is unchanged.
- Used the OpenAI Docs skill to review official production/key, prompt-cache and
  data-control guidance on 2026-10-05. Links appear beside provider-facing claims;
  no provider account, price or model compatibility was verified.

## Checks

This task ran documentation/example checks only, with no unrelated runtime suite.

| Check                                                                                                         | Result                                                                        |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Prettier over all 11 changed/new documentation/example files                                                  | PASS                                                                          |
| Relative document links and GitHub-style heading anchors                                                      | PASS, 80 links/anchors                                                        |
| Git evidence introducing commits and actual parents                                                           | PASS, 19 AI-C00–AI-C18 mappings                                               |
| Synthetic context via `parseProjectContextFile`                                                               | PASS, 3 components / 2 connections                                            |
| Profile array via `aiModelProfileSchema`, `loadAiConfig` and durable snapshot                                 | PASS, 1 profile; synthetic in-memory secrets only, no provider resolution/I/O |
| Default budgets/provider ceilings, receipt TTL and rejected over-limit result TTL                             | PASS, documentation agrees with current pure config/snapshot exports          |
| Private-artifact scanner with optional local configured-secret canaries                                       | PASS, 11 files; counts only, no secret values printed                         |
| Source review of UI labels, selection/data scope, structural versus field Undo, disable/recovery/invalidation | PASS                                                                          |
| Git unstaged/staged whitespace review                                                                         | PASS                                                                          |

The temporary Node documentation checker used existing built exports, source
review and read-only Git history. It loaded optional `.env.local` only for private
canary comparisons and did not use configured credentials for any service. The
checker was removed before staging. Initial checks caught incorrect example
category names and historical README links to absent Phase 8 guide files; corrected
categories and the current original-plan link pass. No check started the application.

AI-C18's 505 focused tests, types/lint/build and static artifact checks remain the
recorded regression baseline; no new execution or broader acceptance is claimed.

## OPEN acceptance and continuation

- Database/migrations/real HTTP/auth/session/SSE and process recovery:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
- Browser/native browser/Playwright/served preview, rendered flows, offline
  persistence, accessibility and committed ACK:
  **UNRUN (deferred by user)**.
- Live OpenAI model compatibility, grounding/quality, retention/cache savings,
  cost and latency: **UNRUN (requires separately authorized operator budget and reviewed inputs)**.

Follow [the acceptance inventory](../../ai-verification.md) for exact resume rules.
All corresponding gates and the original Version 1 production release gate remain
OPEN. Delivering AI-C00–AI-C19 does not establish original M00–M08 completion.
AI-X01 remains NOT STARTED and requires explicit separate selection. Claude and
real provider switching remain unavailable. No push, merge, deployment, migration,
paid call, database check or browser was performed.
