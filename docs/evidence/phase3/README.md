# Phase 3 evidence index

> Current verification timing (October 1, 2026): all database checks/tests, including
> database-backed session/socket and schema/migration checks, are deferred until the
> entire Version 1 implementation (M00–M08) is complete. Browser checks remain paused
> independently. Follow the [shared policy](../../verification-policy.md); it overrides earlier
> instructions to rerun these checks. Historical results below remain unchanged;
> implementation may proceed with deferred acceptance gates OPEN.

Branch: `phase-3-identity-boards`. Base and merge-base with `main`:
`9dc8100afc2db16829909a506e1d1c72838610ae`. The planned task commits are linear.
The [final audit](../../phase-3-identity-boards.md) records the **PASS** exit decision after the
[real GitHub browser follow-up](./real-github-browser.md). P3-13's own evidence preserves the
historical open decision at that earlier commit.

| Task  | Commit                                     | Evidence                            |
| ----- | ------------------------------------------ | ----------------------------------- |
| P3-01 | `50b2d4ec233d675986e0df95ee2b9440fd865620` | [Contracts](./P3-01.md)             |
| P3-02 | `99e06cd4157d47e33e19d58cf2436761dc3e6d1b` | [Identity](./P3-02.md)              |
| P3-03 | `f215da1f4acf5368b5bb86b8f2c3d7913b16b45f` | [Persistence](./P3-03.md)           |
| P3-04 | `0053bbc84823d8dcc003a80776c1c3b98fdd3126` | [Permissions](./P3-04.md)           |
| P3-05 | `20993409c71414568541bdf6335e8bcd776f00bd` | [Board metadata](./P3-05.md)        |
| P3-06 | `2871a6657bdf5d3d4e5dbcaae6a1c14ddf3ce796` | [Archive and duplicate](./P3-06.md) |
| P3-07 | `b1aed18e9bb4f16e4273723090b991967e4cc8c7` | [Membership](./P3-07.md)            |
| P3-08 | `f7d24b140a837f37cd784da26bf0a2e7b7dbe483` | [Invitations](./P3-08.md)           |
| P3-09 | `b7592ee0acf6dfab9abe6baf5250379535c82fdf` | [REST boundary](./P3-09.md)         |
| P3-10 | `15608a4c74b8f63c1ac57cca427563e40776b248` | [Frontend session](./P3-10.md)      |
| P3-11 | `93bb76dfb5c45f00aa5565e510dfabef4b3cd630` | [Dashboard](./P3-11.md)             |
| P3-12 | `2f5f17844305a4f181516262bc4fa165ee35fff9` | [Verification](./P3-12.md)          |
| P3-13 | `99e9adcd002e97a6b83581a9de6cd37be206317c` | [Final audit handoff](./P3-13.md)   |

The additional `2d1a4f9256f92cb766cc4c3317914cea3f907d38` (`feat: added agents`)
appears between P3-08 and P3-09. It is not counted as a planned P3 task or focused fix.
The provider/browser follow-up after P3-13 is a separate evidence correction, not a new planned
task.

P3-12 records passing aggregate automated checks and real PostgreSQL acceptance tests. The
subsequent [real GitHub browser follow-up](./real-github-browser.md) records the user-operated
provider flow and spoken screen-reader result. The Phase 2 audit remains open; a local history
merge does not change its status.
