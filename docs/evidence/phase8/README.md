# Phase 8 evidence index

Status: **OPEN**. Only P8-01 is delivered here; P8-02–P8-13 remain pending.
Branch: `phase-8-release-hardening`. Clean integration/planning base:
`71bd9c46d0c53882a9ecb0e3fc1797b7171f6631` on `main`, containing Phase 7
audit/history and committed Phase 8 planning documents.

| Task  | Commit / parent                                                        | Evidence and scope                                                                          |
| ----- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| P8-01 | This index's commit; parent `71bd9c46d0c53882a9ecb0e3fc1797b7171f6631` | [P8-01](P8-01.md): release contracts, sources, owners, inherited gaps and recoverable cases |

Resolve the self-reference with
`git log --diff-filter=A -1 --format=%H -- docs/evidence/phase8/P8-01.md`.
Later task indexes can map the resulting hash; no self-hash amendment is required.

- [Release/source inventory](../../phase-8-release-inventory.md) maps P01–P14,
  source limits/schema/Swagger/operations, original audit boundaries and all 32
  recovered dependency findings.
- [Verification inventory](../../phase8-verification.md) maps A01–A30 and concrete
  existing checks, fixture/setup requirements and explicitly missing harness work.
- [Shared policy](../../verification-policy.md) keeps database proof
  **UNRUN (deferred by user — until Version 1 implementation is complete)** and
  browser proof **UNRUN (deferred by user)** independently.
- Historical [Phase 7 evidence](../phase7/README.md) and earlier reports remain
  unchanged. Its 628 tests / 24 PASS / 1 FAIL / 14 UNRUN are historical, not new
  Phase 8 counts. P8-01's fresh boundary scan FAIL does not close any old gate.

Next: P8-02 boundary/source-contract repairs. M08 implementation completion and
Version 1 release acceptance remain outstanding. No remote push, merge, deployment,
configured migration, database query or browser execution is part of this handoff.
