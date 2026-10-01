# Phase 2 evidence index

> Current verification timing (October 1, 2026): all database checks/tests, including
> database-backed session/socket and schema/migration checks, are deferred until the
> entire Version 1 implementation (M00–M08) is complete. Browser checks remain paused
> independently. Follow the [shared policy](../../verification-policy.md); it overrides earlier
> instructions to rerun these checks. Historical results below remain unchanged;
> implementation may proceed with deferred acceptance gates OPEN.

Branch: `phase-2-local-editor`

Phase 1 `main` base and branch merge-base: `6eaa4093750f430c4c9b269150eb9b2300f9b88d`

Status: **OPEN / BLOCKED**. The user requested a local merge into `main` despite the open gates; integration does not certify passage.

The P2-12 [quality-gate evidence](./P2-12.md) records a repeatable failure of the 32 ms pan p95 budget and an explicitly UNRUN spoken screen-reader spot check. The [final audit](../../phase-2-editor.md) maps every deliverable and exit criterion to evidence or a blocker. A clean Git worktree and passing static checks do not override those two gates.

| Task                          | Commit                                                        | Evidence            |
| ----------------------------- | ------------------------------------------------------------- | ------------------- |
| P2-01 toolchain               | `b76b786937970720a20cf77cd1acdd9cbe7ccc6b`                    | [P2-01](./P2-01.md) |
| P2-02 atomic commands         | `cb5526becce26c34cec90979848de280e50b5e10`                    | [P2-02](./P2-02.md) |
| P2-03 local persistence       | `5b1e93545b20dbad05fa890c7af2e61a409022b3`                    | [P2-03](./P2-03.md) |
| P2-04 one writer              | `abe6320f956867408da71ad22876a65b28b08ada`                    | [P2-04](./P2-04.md) |
| P2-05 routes and shell        | `db5d8573d1d4cd06fa22f7083e930b86b515cd1a`                    | [P2-05](./P2-05.md) |
| P2-06 projection/canvas       | `f255d7f74b6be76ca1b03b313c74a945d48d5467`                    | [P2-06](./P2-06.md) |
| P2-07 cards and inspectors    | `95703b9f10f6780a19a44d8deea6378ac77e5c07`                    | [P2-07](./P2-07.md) |
| P2-08 connections             | `bc4c5ae9839c334a366315b68ba6ecb1a02e7129`                    | [P2-08](./P2-08.md) |
| P2-09 geometry and boundaries | `fae412d8b53785a430e28eac06cea5142759838a`                    | [P2-09](./P2-09.md) |
| P2-10 compound commands       | `9bbf922fa677045dd42600be2edfc2c9233d256a`                    | [P2-10](./P2-10.md) |
| P2-11 demo lifecycle          | `760b76ad03e651e1d0c66c3fe363d6e9ceb6165d`                    | [P2-11](./P2-11.md) |
| P2-12 quality gates           | `997e42a54ecb5e4c818052e45852657e89705cfa`                    | [P2-12](./P2-12.md) |
| P2-13 audit                   | This documentation commit; see `git log -1` for its self-hash | [P2-13](./P2-13.md) |

The branch has two documentation-policy commits before P2-01 (`01b8203`, `8650e73`) and one user-authored utility/configuration commit, `17acdd82438d1817108cd63880274f732abec24e`, between P2-05 and P2-06. The latter adds repository/frontend instructions, workspace linking and API scripts, and a Vite configuration change; it is not a P2 planned task or a focused Phase 2 fix. The planned P2 commits remain in their required relative order. No intermediate `main` commit was merged into the phase branch.
