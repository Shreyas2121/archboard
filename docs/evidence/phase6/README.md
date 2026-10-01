# Phase 6 evidence index

Status: **OPEN**. Sharing/discussion implementation and the P6-12 audit are delivered;
required integrated acceptance remains missing or failing. Follow the
[verification policy](../../verification-policy.md) and [audit](../../phase-6-discussion-sharing.md).

Branch: `phase-6-discussion-sharing`. Planning/integration base:
`7cb7c889ae03d9a687def2c07334bf4c87124e30` (`feat: next phase`), containing
`phase6.md` and `guide5.md`. Earlier integration fixes at this base remain inherited history.
The table is chronological; there were no parallel task waves or rewritten commits.

| Task/change          | Commit                                                                 | Subject                                                                      | Evidence                                                        |
| -------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------- |
| P6-01                | `f183a43d71527449d62114d38dc80b883d94e5ef`                             | feat(contracts): define discussion and anchor contracts                      | [P6-01](P6-01.md)                                               |
| P6-02                | `2d734a56733e9076df5271ef0107626aeb8c484b`                             | feat(api): persist anchored discussion threads                               | [P6-02](P6-02.md)                                               |
| P6-03                | `cd38d6060d01c68d0220a6776732321440dab071`                             | feat(api): version comment moderation and resolution                         | [P6-03](P6-03.md)                                               |
| P6-04                | `e26a3d26a43e194a6c34d1046ddbb7c6b82333ff`                             | feat(collaboration): invalidate committed REST resources                     | [P6-04](P6-04.md)                                               |
| Verification policy  | `edc5b352021fa87152dcbd2a5d7536a5910d10e8`                             | docs: defer database verification until version 1 implementation is complete | [Policy](../../verification-policy.md)                          |
| P6-05                | `b3348ded839b7796ecba2d8bc61a115e7dba9959`                             | feat(web): add board sharing and member controls                             | [P6-05](P6-05.md)                                               |
| P6-06                | `66e267fe3d2d29570f0315fd17b2892da9455409`                             | feat(web): add board invitation management                                   | [P6-06](P6-06.md)                                               |
| P6-07                | `cf2c2e9673c72c47b5ce9e2a2901f318ce004bde`                             | feat(web): add authenticated invitation acceptance                           | [P6-07](P6-07.md)                                               |
| P6-08                | `1bebb67f9f44a6bc846b71c082bfb8a46079acf1`                             | feat(web): add anchored board discussion                                     | [P6-08](P6-08.md)                                               |
| Inspector layout fix | `8675c42225ab656e033834ba541c8b3a3958c224`                             | fix(web): correct inspector tab layout                                       | [Layout evidence](P6-08-sidebar-fix.md)                         |
| P6-09                | `6ee804a511dec53c08c439dce19cda4b3ca65826`                             | feat(web): handle discussion conflicts and moderation                        | [P6-09](P6-09.md)                                               |
| P6-10                | `f54c85dfabda15819ec8164f4d58efcaf7c6e61d`                             | feat(web): isolate sharing and discussion lifecycle                          | [P6-10](P6-10.md)                                               |
| P6-11                | `039842e677743c4ef3be3fbc2cd2e366a731e698`                             | test(phase6): verify sharing and discussion gates                            | [P6-11](P6-11.md), [sanitized child report](P6-11-report.json)  |
| P6-12                | This index's commit; parent `039842e677743c4ef3be3fbc2cd2e366a731e698` | docs(phase6): record discussion and sharing exit status                      | [P6-12](P6-12.md), [audit](../../phase-6-discussion-sharing.md) |

Resolve the P6-12 self-reference with
`git log --diff-filter=A -1 --format=%H -- docs/evidence/phase6/P6-12.md`;
no amend solely for a self-hash.

## Evidence boundaries

- P6-01–P6-04 retain their original database/schema/session/socket observations.
  They predate the database pause and are historical proof at their stated trees.
  P6-03's failed full invocation and corrected focused rerun remain separate results.
- P6-05–P6-11 record permitted units/builds/static checks and prepared real-boundary
  tests. Current-tree DB/schema/socket checks are **UNRUN (deferred by user — until
  Version 1 implementation is complete)**. Browser proof is **UNRUN (deferred by user)**.
- P6-11 is the final unchanged-code implementation run: 430 passing tests, 22 PASS,
  1 FAIL (32 inherited boundary violations), 10 UNRUN child rows; full gate OPEN.
  P6-12 changes documentation only and references those results without replaying suites.
- The layout fix proves Radix attribute compatibility through Node rendering/builds;
  rendered layout and keyboard acceptance remain UNRUN.
- Configured retention migration was historically pending; isolated test schemas
  were migrated. Neither observation supplies current configured-state verification.

The [audit matrix](../../phase-6-discussion-sharing.md#deliverables-and-exit-criteria)
maps every deliverable/exit condition and A11/A19/A20 boundary. The
[verification guide](../../phase6-verification.md) names exact deferred commands,
synthetic fixtures, secret-handling requirements and missing human observations.
Phase 3 retains historical PASS; Phase 2/4/5 and full Phase 6 remain OPEN.
