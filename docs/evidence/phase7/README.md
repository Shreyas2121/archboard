# Phase 7 evidence index

Status: **OPEN**. Implementation and audit are delivered; required integrated
acceptance is deferred or missing. Follow the [policy](../../verification-policy.md),
[audit](../../phase-7-presentation-portability.md) and
[executable verification inventory](../../phase7-verification.md).

Branch: `phase-7-presentation-portability`. Planning/integration base:
`5726e72ed6b15a418cff5706a1a4844afbfc8cd1` (`feat: updated docs`), containing
`phase7.md` and `guide6.md`. Tasks and the focused fix form linear history.

| Task/change           | Commit                                                                 | Subject                                                        | Evidence                                                              |
| --------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- |
| P7-01                 | `8637d2e460e859fc777a18d5aa5703deb4b8720c`                             | feat(contracts): define presentation and portability contracts | [P7-01](P7-01.md)                                                     |
| P7-02                 | `f36af12b5afbf1665eedae1c2960ea5c675ecf3e`                             | feat(document-model): complete presentation step commands      | [P7-02](P7-02.md)                                                     |
| P7-03                 | `b5e00fd48d7a2922df551b7ed0e50e5c28868335`                             | feat(web): add step authoring and local presentation           | [P7-03](P7-03.md)                                                     |
| P7-04                 | `56cda15b4a8768d6e39695f56a9e370ef89216f9`                             | feat(collaboration): enforce presenter leases                  | [P7-04](P7-04.md)                                                     |
| P7-05                 | `6d1a3e5be5b03016172265a6c0bd59425cc275da`                             | feat(web): add opt-in presenter following                      | [P7-05](P7-05.md)                                                     |
| P7-06                 | `27537c2988ce3fa247f7d18af28cd4fecc5629cd`                             | feat(portability): validate and remap portable boards          | [P7-06](P7-06.md)                                                     |
| P7-07                 | `c58458c2aa6ab51c3e7b0e30409b03c7cedfc9b6`                             | feat(api): add immutable committed checkpoints                 | [P7-07](P7-07.md)                                                     |
| Creation boundary fix | `4d7bf595093416e548607405d0e32aac31660dba`                             | fix(portability): align creation routes and response envelopes | [Fix](fix-portability-creation-boundary.md)                           |
| P7-08                 | `e69a0e51def97ef02a983c79f4cf70e107e85775`                             | feat(web): add checkpoints and JSON portability                | [P7-08](P7-08.md)                                                     |
| P7-09                 | `24a39c4687b597e580d01d222da6d8a16d569ac8`                             | feat(export): add controlled SVG and PNG export                | [P7-09](P7-09.md)                                                     |
| P7-10                 | `a083cd8756804d4fdab57f32bdac66fc9837d497`                             | feat(templates): complete bundled architecture examples        | [P7-10](P7-10.md)                                                     |
| P7-11                 | `8ed437c3a8d20277bd56826f53b5eda1eb4f3aad`                             | test(phase7): verify presentation and portability gates        | [P7-11](P7-11.md), [report](P7-11-report.json)                        |
| P7-12                 | This index's commit; parent `8ed437c3a8d20277bd56826f53b5eda1eb4f3aad` | docs(phase7): record presentation and portability exit status  | [P7-12](P7-12.md), [audit](../../phase-7-presentation-portability.md) |

Resolve the self-reference with
`git log --diff-filter=A -1 --format=%H -- docs/evidence/phase7/P7-12.md`;
no amend solely for a self-hash.

## Evidence boundaries

- P7-01 through P7-11 retain their original source/build/count/timing observations.
  Earlier import/restore mismatches are corrected by the separately indexed fix;
  old evidence is not rewritten as proof of corrected routes.
- P7-11's permitted run records 628 passing tests, 24 PASS, 1 FAIL (32 inherited
  boundary findings), 14 UNRUN. Late prepared DB assertions received separate
  final type/lint checks. Aggregate/final source fingerprints remain distinct.
- P7-12 changes documentation only and reuses P7-11 unit/build/static evidence.
  Its formatting/link/history/source checks establish documentation consistency.
- All current DB/session/socket/schema checks are **UNRUN (deferred by user — until Version 1 implementation is complete)**.
  Browser checks are **UNRUN (deferred by user)**. Three required reviewed evidence
  rows also remain missing; A16/A17/A18/A21 and the full phase stay OPEN.
- Earlier configured migration observations and isolated migrated schemas remain
  historical at their stated trees; no current database inspection was performed.
  Phase 3 retains historical PASS; Phase 2/4/5/6 stay OPEN.

M08 can proceed with the [consolidated handoff](../../phase-7-presentation-portability.md#historical-boundaries-and-m08-handoff).
The user requested local integration into `main` with these visible limitations;
integration does not supply acceptance evidence or resume verification.
