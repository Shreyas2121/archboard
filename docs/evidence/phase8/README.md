# Phase 8 evidence index

Status: **OPEN**. P8-01–P8-07 and focused P8-09 documentation are delivered here.
P8-08 is unfinished/deferred for the user's personal/portfolio scope; P8-10–P8-13
remain pending. The user explicitly requested P8-09 next; the P8-08 dependency
was bypassed for documentation, with no release-gate waiver or verification resumption.
Branch: `phase-8-release-hardening`. Clean integration/planning base:
`71bd9c46d0c53882a9ecb0e3fc1797b7171f6631` on `main`, containing Phase 7
audit/history and committed Phase 8 planning documents.

| Task  | Commit / parent                                                                               | Evidence and scope                                                                                             |
| ----- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| P8-01 | `4dcf5e33d3cca9f407fb163d4bad936f5f15c993`; parent `71bd9c46d0c53882a9ecb0e3fc1797b7171f6631` | [P8-01](P8-01.md): release contracts, sources, owners, inherited gaps and recoverable cases                    |
| P8-02 | `0aef5f47f7afd906d373c244396939fff0cd5958`; parent `4dcf5e33d3cca9f407fb163d4bad936f5f15c993` | [P8-02](P8-02.md): dependency repairs, source alignment, prepared real regressions                             |
| P8-03 | `22611452ddd1152ca9941fb448a6e937cc18f760`; parent `0aef5f47f7afd906d373c244396939fff0cd5958` | [P8-03](P8-03.md): keyboard/object navigation, focus/status policy, prepared full A28 protocol                 |
| P8-04 | `42ba5b4089234e372fe1a15237638d20d38a1ff3`; parent `22611452ddd1152ca9941fb448a6e937cc18f760` | [P8-04](P8-04.md): workload/method, bounded rendering, numeric stage timing, prepared A26 modes                |
| P8-05 | `44ad28460c352df821e6a6cf43e564c0410bb64b`; parent `42ba5b4089234e372fe1a15237638d20d38a1ff3` | [P8-05](P8-05.md): bounded rates, admission, workers, complete validation and ordered recovery                 |
| P8-06 | `10eeaa5cda7e741a7450868064dcfd8b14ea079a`; parent `44ad28460c352df821e6a6cf43e564c0410bb64b` | [P8-06](P8-06.md): origin/response/CSP/log privacy and late-result/consent preservation                        |
| P8-07 | `e1cf7d62e4cb6cead2e7d35a4d1b34e842152a30`; parent `10eeaa5cda7e741a7450868064dcfd8b14ea079a` | [P8-07](P8-07.md): single-writer production package, readiness/admission/drain and prepared process/host proof |
| P8-08 | No commit; unfinished/deferred                                                                | Daily backup/isolated restore tooling is not delivered                                                         |
| P8-09 | This index's current commit; parent `e1cf7d62e4cb6cead2e7d35a4d1b34e842152a30`                | [P8-09](P8-09.md): local/OAuth/setup, product/recovery and portfolio documentation                             |

Resolve the self-reference with
`git log --diff-filter=A -1 --format=%H -- docs/evidence/phase8/P8-09.md`.
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
- [Security/recovery map](../../phase-8-security-recovery.md) maps same-origin/cache/CSP,
  safe diagnostics/scans, account/access/update fencing and prepared reviewed proof.
- [Operations runbook](../../phase-8-operations.md) maps the production package,
  singleton/readiness/drain controls, upgrade/rollback and prepared process/host proof.
- [Shared policy](../../verification-policy.md) keeps database proof
  **UNRUN (deferred by user — until Version 1 implementation is complete)** and
  browser proof **UNRUN (deferred by user)** independently.
- Historical [Phase 7 evidence](../phase7/README.md) and earlier reports remain
  unchanged. Its 628 tests / 24 PASS / 1 FAIL / 14 UNRUN are historical, not new
  Phase 8 counts. P8-01's fresh boundary scan FAIL does not close any old gate.

Requested P8-09 documentation is complete. P8-08 and P8-10–P8-13 remain unfinished;
no subsequent task is initiated by this handoff. M08 implementation completion and
Version 1 release acceptance remain outstanding. No remote push, merge, deployment,
configured migration, database query or browser execution is part of this handoff.
