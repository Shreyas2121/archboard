# Pre-push repository cleanup

October 15, 2026. Scope: repository hygiene and documentation; no runtime behavior,
database operation, deployment or remote push.

## Findings and corrections

- Remove 36 local artifacts from tracking: `.tmp` browser-debug snapshots and
  scripts, root scratch scripts, the one-off `prompt.txt`, three Citeleaf context
  files and their exported PNG. Their total size is 3,352,612 bytes. All original
  files stay on disk, with local SHA-256 checksums recorded before cleanup.
- Ignore these artifacts in Git, Docker contexts, formatting and lint as
  appropriate. Reviewed examples and historical evidence remain tracked.
- Add `pnpm repo:check` for the index and `pnpm repo:check --outgoing` to also
  detect unwanted paths in unpublished commits since `origin/main`. The actual
  dirty index and outgoing history each failed with all 36 artifacts before
  cleanup, showing that deleting only the latest copy is insufficient.
- Add a documentation index, mark the old hosted-AI implementation guide as
  historical, and update the current development-login instructions to use
  Project JSON rather than retired hosted generation.
- Repair seven missing local links to deleted phase plans/guides using verified
  immutable GitHub commit paths. Correct an eighth guide link that had started
  pointing at the unrelated hosted-AI guide. Historical results, dates, claims and
  acceptance statuses remain unchanged.

## Secret and artifact review

The pre-cleanup inventory contained 1,024 tracked files. A count-only value/pattern
scan checked current tracked text and 578 unique text blobs across the 25 outgoing
commits (594 blobs total; 16 binary blobs were not text-scanned). Seven configured
local secret values were used only as in-memory canaries; none matched tracked
content or outgoing text history. Eleven history blobs matched generic credential
patterns and were identified as placeholder database examples or deliberate
security-test fixtures. No matched credential values or file payloads were printed.

The current public source/build scan passed on 370 files using configured values.
These checks do not establish the absence of every possible secret or inspect
text embedded in screenshots. Debug images are excluded from the outgoing history
as part of cleanup.

## History cleanup

The remote `main` was verified at
`c725dce16695251d0cf67a1dd3b972f29646a3f5`. Only local commits after that base
are eligible for filtering. The cleanup preserves a local recovery bundle and
original Git refs before removing the identified artifact paths from `main` and
`ai-diagram-integration`. Existing historical evidence keeps its original commit
identifiers; the backup retains those original objects.

History filtering and post-filter checks: **PASS**. The cleaned `main` has 26
outgoing commits, including the cleanup commit. Both `main` and the merged feature
branch exclude all 36 artifact paths throughout their outgoing history. Published
history is unchanged, so a normal fast-forward push is possible.

The verified local recovery bundle is
`.git/pre-push-cleanup-2026-10-15.bundle` (5,876,220 bytes), with original refs also
retained under `refs/original`. All 36 local files match their pre-cleanup SHA-256
checksums. The filtered feature tree differs from its original tree only by those
36 deletions; the filtered cleanup tree matches its pre-filter tree exactly.
Application/package sources and lockfiles are unchanged from the previously
verified watermark commit `7b0db7d`.

A post-filter scan checked all 574 outgoing text blobs and found zero configured
secret-value matches. The same 11 example/fixture pattern matches remain. The
outgoing path guard passes for the current index and the cleaned history.

## Verification

| Check                                                | Result                                            |
| ---------------------------------------------------- | ------------------------------------------------- |
| Full repository formatting                           | PASS                                              |
| Full repository ESLint                               | PASS                                              |
| Workspace and Node verification type checks          | PASS                                              |
| Local Markdown destinations                          | PASS — 718 links checked, zero missing paths      |
| Historical GitHub permalink targets                  | PASS — eight referenced commit/file objects exist |
| Dependency boundaries and negative fixtures          | PASS                                              |
| Public source/build secret scan                      | PASS — 370 files                                  |
| Security/CSP/artifact Node tests                     | PASS — six tests                                  |
| Final index/outgoing hygiene and preservation checks | PASS                                              |

Browser checks: **UNRUN (deferred by user)**.
Database-backed tests, schema/migration checks and diagnostics:
**UNRUN (deferred by user — until Version 1 implementation is complete)**.
No substitute check closes browser/database or phase/release acceptance gates.
