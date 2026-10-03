# Phase 8 performance workloads and measurement method

A26 and the release gate are **OPEN**. CPU measurements below support implementation
decisions; they do not certify frames, cached opening, durable visibility or admission.
Follow the [verification policy](verification-policy.md). Browser execution is
**UNRUN (deferred by user)**. Database-backed staging preparation, sockets and
measurements are **UNRUN (deferred by user — until Version 1 implementation is complete)**.

## Workloads and reproduction

`@archboard/fixtures` preserves the named typical **200/400/20/20** and limit
**500/1000/50/50** node/edge/boundary/step fixtures. `createPerformanceGraphFixture`
adds seed **804** synthetic 8,192-character bodies to every code/schema/note, keeping
all IDs, topology, counts and four card kinds. CPU profiling also exercises all-kind
and all three registry templates. Two text workloads retain 100 sequential 32-character
replacement edits in a Y.Doc with GC disabled, including deleted structures. This is
a measurement fixture; product history, GC, undo and validation policies are unchanged.

`createPerformanceCapFixtures` supplies 24 independent below/exact/above cases for
four count families and title/description/body/notes. Existing fixture negatives
cover the other field, URL, schema, enum, reference, presence and protocol families;
model/export suites cover malformed documents and hostile JSON. The API worker suite
retains raw state/update byte admission, immutable fields, tombstones and causal-gap
negatives. Count and individual text maxima do not imply every field at maximum fits
within 10 MiB. A large accepted state is hydrated as a snapshot, never sent as a
single client update exceeding 1 MiB. Encoded state includes physical hidden/history
bytes; projection JSON size is a separate quantity.

After package builds, these commands run only CPU/Node work, with no secret-file
loading, DB connection or browser import:

```powershell
node scripts/performance/cpu-profile.mjs docs/evidence/phase8/P8-04-cpu.json
node scripts/performance/highlight-profile.mjs docs/evidence/phase8/P8-04-highlight-cpu.json
node --test scripts/performance/report.test.mjs
```

Reports retain raw numeric samples, p50/p95/max/population variance, graph hashes,
counts, seed, actual UTF-8 export sizes, encoded Yjs sizes/hashes, history edits,
hardware/OS/Node and baseline commit plus working-tree qualifier. Graph hashes are
reproducible. Yjs hydration uses a random client ID, so its encoded hash and occasional
varint-size difference identify the actual run. Never compare it as a stable fixture
hash. Above-cap cases remain negative candidates, without attempted hydration.

CPU workload method: five warmups, 20 measured iterations, one caller, warm runtime;
no timing assertion closes A26. The highlight comparison uses the same warm
TypeScript grammar/light theme, 8,192 characters and 100 pre-drain edits: the former
unguarded-work behavior executes 100 tokenizations; cancellation executes one. It
does not simulate continuous edits after tokenization starts. Concurrent build/type/
lint work affected some highlight samples; retain the outliers. One remaining
tokenization can still block the main thread. Browser profiling must assess that
cost and startup grammar/WASM load, rather than assuming concurrency control meets
32 ms. Production build still reports large chunks; no chunk budget was relaxed.

## Targeted runtime changes and stage boundaries

The shell updates its viewport on camera motion. GraphCanvas now uses React memo
with a stable presentation-pan callback, preserving its own selection subscriptions
and changed projection/permissions/presentation props. This avoids rebuilding its
subtree solely from shell camera changes. Projection generation caching and per-canvas
live-ID eviction remain intact; no mutable projection identity shortcut was added.
Final geometry continues through existing commands, with one durable gesture commit.
This is a source-supported hypothesis for the inherited pan miss, awaiting rendered proof.

Highlighting has one active task, at most 32 waiting tasks and at most 8,192 characters
per tokenized card. Cleanup removes waiting work and guards in-flight import/result
publication. There is no new shared content/token cache. Overflow and larger sources
render full escaped plain text. These are decorative work limits, not graph, editing,
export or admission limits. Waiting callbacks are discarded on card unmount; an
already executing tokenizer cannot be interrupted. Theme/code/language changes
invalidate displayed tokens immediately through the existing key check.

Stage diagnostics contain fixed stage names and numeric elapsed durations, never
content, cookies, IDs, update bytes or token-bearing URLs:

| Stage                               | Start → finish                                                                                                                               | Scope / limitations                                                                                             |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `local-queue`                       | Local update notification → write-tail execution                                                                                             | Optional per-adapter `onTiming` sink; no production console upload or retained samples                          |
| `local-write`                       | Write-tail start → local log/outbox transaction completion or failure                                                                        | Includes digest and storage work; reported in finally, never means saved success                                |
| `collaboration.room_queue`          | Room operation enqueue → execution                                                                                                           | All serialized operations; no update-specific correlation                                                       |
| `collaboration.validation_queue`    | Worker job admission/copy → worker start                                                                                                     | Includes waiting and defensive copies; queue depth numeric                                                      |
| `collaboration.validation_worker`   | Worker construction → first result/error/timeout/cancel settlement                                                                           | Includes startup; termination/cleanup not included; failed work also measured                                   |
| Existing `collaboration.db_write`   | Persistence transaction call → committed result                                                                                              | Includes authority/receipt/append; duplicate flag retained                                                      |
| Existing `collaboration.ack`        | Existing server update handling → ACK send                                                                                                   | Server ACK latency, not peer application/render                                                                 |
| Harness ACK / delivery / visibility | Before initiating title fill → observed matching ACK sequence / same-sequence peer socket delivery / four peer DOM titles plus two RAF turns | One Node monotonic observer clock, includes automation and polling overhead; no clock subtraction between hosts |

Diagnostic sink errors cannot change persistence/queue/commit/ACK behavior. Optional
local timing can be connected by a final verification owner to bounded numeric
collection. The prepared staging harness observes transport and rendering externally;
it does not install content-bearing production traces. Server metrics are aggregated
without inferring causality across unrelated operations. Five-user tests remain one
edit at a time, with five distinct users and all four peers, separate from admission.

## Prepared rendered and staging harness

`scripts/performance/release-browser.mjs` has `frames`, `five-user`, and `admission`
modes. It requires `--run-authorized` before importing Playwright. **Do not run these
commands during either applicable pause.** Use a disposable, preseeded staging board,
five independently authenticated editors, one production single-writer deployment
and same-region database. The five credential storage files belong outside tracked
files and evidence. The harness does not migrate, create schemas, reset history,
seed live data or silently provision a local substitute.

Prepare the exact typical fixture through reviewed isolated snapshot setup (the
original `apps/api/scripts/p4-12-measure-browser.mjs` demonstrates snapshot seeding,
but its old partial fixture/local deployment is not release setup). Record actual
seed encoded bytes/hash before opening clients. For admission prepare a separate
limit fixture board. Confirm snapshot completeness using model validation and the
final isolated DB verification owner; retain its report. Observe all expected node/
edge IDs and rendered controls; boundary/step completeness also needs final snapshot
review. Keep the typical board at 200/400 by editing an existing title, rather than
growing it during samples. Restore only synthetic titles between independent runs
through authorized commands, preserving physical history; record resulting state size.

Private config fields are `origin` (clean same-origin HTTPS), `boardId`, `disposable:
true`, `buildHash` (40 hex), `applicationRegion`, `databaseRegion`, `postgresVersion`,
`networkProfile`, `encodedSeedBytes`, `encodedSeedSha256` (64 hex), five
`storageStates` file paths, and optionally `serverMetricsFile` containing the dedicated
run's structured numeric server metrics. Collect that file over the measured run,
then reconcile stage counts and warmup scope; unrelated log lines are discarded by
an allowlist. Never attach raw logs or credential files to evidence. Verify deployed
artifact hashes independently; a config's hash is a claim requiring review.

After both conditions are satisfied, using reviewed absolute private-config and
report paths:

```powershell
node scripts/performance/release-browser.mjs frames <config.json> <frames.json> --run-authorized
node scripts/performance/release-browser.mjs five-user <config.json> <visibility.json> --run-authorized
node scripts/performance/release-browser.mjs admission <limit-config.json> <admission.json> --run-authorized
```

Frame/open reference: Windows laptop Intel i5-9300H, 8 logical CPUs, approximately
17 GB RAM (the inherited reference), Chrome production build, 1440×900; record actual
OS/browser versions, power/load conditions and whether the reference machine matches.
Five unmeasured warmups precede 20 cached openings and 20 pan/drag gestures with 120
pointer moves each. Cached offline opening starts at navigation time origin and ends
only after all named graph nodes/edges and enabled zoom controls are observed, a zoom
command changes the readout, and two RAF turns occur. It includes observer overhead.
Skeleton or DOM count alone is insufficient. Offline reload depends on the production
worker having cached the route/assets; a failed reload is retained as a failure.
Cold and warm online sessions must be recorded separately; this harness's cached
offline samples do not certify them. RAF intervals span real gestures; raw pan/drag
intervals are retained independently with nearest-rank p95 ≤32 ms. Cached opening
target remains ≤2,000 ms. Pan must leave the local log unchanged; each completed drag
must append exactly one local geometry record (below compaction threshold).

Five-user method: five warmup edits plus 100 measured round-robin title edits. Use
an external bidirectional shaper with 50 ms per direction applying to HTTP **and
WebSocket**, producing nominal 100 ms RTT; retain shaper configuration and independent
transport calibration. The harness records 20 authenticated no-store HTTP round
trips and rejects a median outside 90–120 ms. HTTP server processing is included;
this calibration alone does not prove WebSocket RTT or correct shaping. A CDP
`latency: 100` setting is not that proof. Start before the initiating input action;
wait for its new durable ACK sequence, all four peers' same-sequence delivery, rendered
title and two RAF turns. Report raw visibility p50/p95/max/variance against **500 ms**,
plus ACK/delivery separately. Preserve misses; no subtracting observer overhead to
manufacture a pass. ACK/socket RTT/local optimism are not peer visibility.

Admission runs independently: ten contexts must receive ready and render the full
limit workload; the eleventh must receive ROOM_FULL without ready. This is capacity
proof, not a five-user latency sample. Final A30 also requires release/next-admission,
20-room, rate/queue/timeout/fairness and legitimate-next-update checks owned by P8-05.

Harness failures/misses exit nonzero and retain a sanitized report. Every report keeps
acceptance OPEN until final review reconciles hardware, build, workload, durable
boundaries, actual region/shaping and server stage coverage. No staging or no reference
browser means UNRUN with the actual missing prerequisite; no localhost substitution.

## Preserved misses

The [P2-12 report](evidence/phase2/P2-12.md) records pan p95 **83.3 ms / 32 ms FAIL**,
with an earlier **50.2 ms** miss. Drag p95 **16.8 ms** and cached opening worst **1,275 ms**
passed only at that historical build. The [Phase 4 audit](phase-4-collaboration.md)
records P4-13 visibility **4,876 ms / 500 ms FAIL**, cached opening **1,233 ms**, DB-write
**627 ms** and ACK **8,088 ms** p95. P4-12's earlier visibility **6,598 ms** remains
historical. Those local/CDP runs used a remote database and did not establish measured
same-region 100 ms RTT. No observation is replaced or upgraded by this task.
