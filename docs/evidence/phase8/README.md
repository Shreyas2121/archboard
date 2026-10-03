# Phase 8 evidence index

Status: **OPEN**. P8-01–P8-05 implementation is delivered here; P8-06–P8-13 remain pending.
Branch: `phase-8-release-hardening`. Clean integration/planning base:
`71bd9c46d0c53882a9ecb0e3fc1797b7171f6631` on `main`, containing Phase 7
audit/history and committed Phase 8 planning documents.

| Task  | Commit / parent                                                                               | Evidence and scope                                                                              |
| ----- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| P8-01 | `4dcf5e33d3cca9f407fb163d4bad936f5f15c993`; parent `71bd9c46d0c53882a9ecb0e3fc1797b7171f6631` | [P8-01](P8-01.md): release contracts, sources, owners, inherited gaps and recoverable cases     |
| P8-02 | `0aef5f47f7afd906d373c244396939fff0cd5958`; parent `4dcf5e33d3cca9f407fb163d4bad936f5f15c993` | [P8-02](P8-02.md): dependency repairs, source alignment, prepared real regressions              |
| P8-03 | `22611452ddd1152ca9941fb448a6e937cc18f760`; parent `0aef5f47f7afd906d373c244396939fff0cd5958` | [P8-03](P8-03.md): keyboard/object navigation, focus/status policy, prepared full A28 protocol  |
| P8-04 | `42ba5b4089234e372fe1a15237638d20d38a1ff3`; parent `22611452ddd1152ca9941fb448a6e937cc18f760` | [P8-04](P8-04.md): workload/method, bounded rendering, numeric stage timing, prepared A26 modes |
| P8-05 | This index's current commit; parent `42ba5b4089234e372fe1a15237638d20d38a1ff3`                | [P8-05](P8-05.md): bounded rates, admission, workers, complete validation and ordered recovery  |

Resolve the self-reference with
`git log --diff-filter=A -1 --format=%H -- docs/evidence/phase8/P8-05.md`.
Later task indexes can map the resulting hash; no self-hash amendment is required.

- [Release/source inventory](../../phase-8-release-inventory.md) maps P01–P14,
  source limits/schema/Swagger/operations, original audit boundaries and all 32
  recovered dependency findings.
- [Verification inventory](../../phase8-verification.md) maps A01–A30 and concrete
  existing checks, fixture/setup requirements and explicitly missing harness work.
- [P8-02 source alignment](../../phase-8-contract-alignment.md) maps repaired
  public interfaces, creation responses and transaction/schema source decisions.
- [Interaction inventory and A28 protocol](../../phase-8-accessibility.md) maps
  actual controls, roles/states and deferred rendered/spoken/visual observations.
- [Performance workloads and method](../../phase-8-performance.md) defines actual
  fixtures, safe stages, CPU reports and deferred frame/visibility/admission modes.
- [Admission/validation map](../../phase-8-admission-validation.md) records bounds,
  identity/rate/retry policy, strict negatives and prepared A23/A30 socket procedures.
- [Shared policy](../../verification-policy.md) keeps database proof
  **UNRUN (deferred by user — until Version 1 implementation is complete)** and
  browser proof **UNRUN (deferred by user)** independently.
- Historical [Phase 7 evidence](../phase7/README.md) and earlier reports remain
  unchanged. Its 628 tests / 24 PASS / 1 FAIL / 14 UNRUN are historical, not new
  Phase 8 counts. P8-01's fresh boundary scan FAIL does not close any old gate.

Next: P8-06 security, privacy, cache isolation and recovery. M08 implementation completion and
Version 1 release acceptance remain outstanding. No remote push, merge, deployment,
configured migration, database query or browser execution is part of this handoff.
