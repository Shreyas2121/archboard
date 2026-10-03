# Phase 8 closure — personal and portfolio scope

The user changed the project goal from a fully verified hosted release to showing
the project to recruiters and using it for their own architecture diagrams. After
requesting P8-09 only, the user explicitly requested completion of the phase and
merge into `main`. This amendment closes that smaller phase scope and authorizes
local branch integration. It does not establish the original Version 1 production
release gate, authorize deployment/push, or resume database/browser verification.

## Delivered and deferred work

| Task        | Closure disposition                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| P8-01–P8-02 | Delivered: source inventory, dependency boundaries and contract repairs                                    |
| P8-03       | Delivered: keyboard/focus/accessibility implementation; rendered/spoken proof deferred                     |
| P8-04       | Delivered: performance workloads/hooks and targeted implementation; actual performance proof deferred      |
| P8-05       | Delivered: bounded admission, validation, rates and recovery safeguards                                    |
| P8-06       | Delivered: security/privacy/cache and pending-work safeguards                                              |
| P8-07       | Delivered: optional single-writer package and lifecycle controls; actual package/DB/process proof deferred |
| P8-08       | Unfinished/deferred: daily backups, isolated restore mechanism and drill                                   |
| P8-09       | Delivered: setup, personal usage/recovery and portfolio walkthrough documentation                          |
| P8-10       | Deferred: comprehensive release verifier and original M00–M08 completion inventory                         |
| P8-11       | Deferred: consolidated database/process/fault/restore verification                                         |
| P8-12       | Deferred: served browser, assistive and staging performance verification                                   |
| P8-13       | Delivered as this scoped closure/audit; full production release reconciliation remains deferred            |

The current phase is **CLOSED for the amended personal/portfolio scope**. The
original M00–M08 implementation completion and production release acceptance remain
**OPEN**. Scope closure cannot convert unexecuted checks into PASS. Domain contracts
for graph edits, local persistence, committed ACKs, permissions, receipt retention,
single-writer fencing and recovery remain unchanged.

## Evidence and practical handoff

[The evidence index](evidence/phase8/README.md) maps the actual implementation commits.
P8-07 records 63 focused API tests and 4 Node package-policy tests, plus lint,
workspace types/builds, boundaries and scans. P8-09 records focused document
formatting, 40 local links/anchors and privacy/source-command checks. These are
results at their recorded source boundaries, not new integrated acceptance.
This closure changes documentation only and reuses those results without rerunning
unchanged application checks. Its own document checks are in
[P8-13 evidence](evidence/phase8/P8-13.md).

Start with [setup](setup.md), [using Archboard](using-archboard.md) and the
[portfolio walkthrough](portfolio-walkthrough.md). `/demo` starts locally with Web
application and supports diagram export; JSON import into a new private server board
requires online sign-in. Export important diagrams to a private project folder.
JSON is a diagram copy, not a backup of account/access/discussion/receipt records.
Server users must arrange an independent backup; no daily backup tooling or successful
restore is delivered by this phase. [Operations](phase-8-operations.md) describes
the optional package and its limitations.

There are no verified screenshots, hosted URL, uptime/adoption figures or current
performance guarantees in this handoff. Existing historical failures stay recorded.
The [release verification inventory](phase8-verification.md) and earlier inventories
retain recoverable procedures for the deferred boundaries. They may be revisited
if the project later needs the original hosted-release scope.

Database-backed setup/auth/session/HTTP/socket/schema/process/restore proof remains
**UNRUN (deferred by user — until Version 1 implementation is complete)**.
Browser/manual/performance proof remains **UNRUN (deferred by user)**. Native Caddy
adaptation and image builds remain unverified as recorded in P8-07. Closing this
amended phase does not satisfy the original implementation-completion trigger or
change either verification pause.

## Local integration

Before closure, `main` was `71bd9c46d0c53882a9ecb0e3fc1797b7171f6631`, an ancestor
of the phase branch with no divergent commits. The implementation/documentation
tip was P8-09 (`1d4aa08`; exact hash in the evidence index). The closure adds a
documentation commit on `phase-8-release-hardening`, then merges that branch into
local `main`, preserving all task commits and their historical evidence. Resolve
the resulting merge through `git log --merges -1 main` and confirm its phase-branch
parent. No remote push, deployment, configured migration, DB probe, browser run or
volume deletion is part of this closure.
