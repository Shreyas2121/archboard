# Release admission, validation and recovery

P8-05 implementation inventory, 3 October 2026. Published product budgets remain
unchanged. A23/A30 and release acceptance are **OPEN**. This document describes
source enforcement and prepared verification, not deployed socket or database proof.

## Enforcement map

| Boundary                           | Limit and source                                                                                                        | Rejection / invariant                                                                                                                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native WebSocket / gateway frame   | Shared 16 MiB; native adapter `maxPayload`, `collaboration.gateway.ts` and contracts `parseClientFrame`                 | Fragment lengths summed before `Buffer.concat`; no oversized UTF-8/JSON parsing or activation retention. Binary/invalid envelopes close safely.                                                                        |
| Update base64 / decoded bytes      | Shared 1 MiB; contracts protocol schema and validation pool/entry                                                       | Encoded length/decoded size checked before canonical scanning/decoding; worker input checked before admission.                                                                                                         |
| Complete document                  | Shared 10 MiB encoded state; `validation-worker.entry.ts`, document-model physical validation                           | Accepted and isolated candidate documents validated, including stored hidden objects, text, logical tombstones and retained history. Candidate encoded cap precedes persistence. No live-room installation on failure. |
| Causal dependencies                | Pinned Yjs compatibility wrapper                                                                                        | Pending structures and delete sets reject; unknown internal dependency shape fails closed. No partial apply into accepted document.                                                                                    |
| Worker execution                   | Shared two workers, queue 20, timeout 2,000 ms; `validation-worker-pool.ts`                                             | Constructor cannot raise ceilings. Timeout/crash terminates worker; stale replies cannot resolve a settled job. No receipt/commit/ACK from rejected validation.                                                        |
| Room admission                     | Shared ten connections, twenty active/opening rooms; `room-registry.ts`                                                 | Reservations cover opening rooms; unauthorized joins cannot reserve. `ROOM_FULL` / `SERVER_BUSY` are temporary.                                                                                                        |
| Serial room work                   | 1,280 active + queued operations; `collaboration-limits.ts`, room FIFO                                                  | Derived from 128 pending deliveries × ten legal peers, so protected delivery bursts fit. Refuse excess before extending FIFO; no accepted dependencies dropped. One content operation per socket remains in flight.    |
| Pending authentication             | 200 upgrade operations and 200 unresolved session lookups; production `collaboration-upgrade.service.ts`                | HTTP 503 before extra lookup work. Timed-out underlying lookups remain charged until settlement, even after the handshake operation ends. This bounds work; it does not cancel an auth provider request.               |
| Authenticated sockets before hello | 200, derived from twenty rooms × ten connections; gateway                                                               | Excess receives temporary `SERVER_BUSY` and is terminated with cleanup.                                                                                                                                                |
| Fanout / activation                | Existing per-peer 128 updates / 4 MiB; activation 40 frames / 16 MiB; outgoing socket 32 MiB                            | Slow/full peers disconnect for full resync; no partial delivery advertised as saved. Ready snapshot cap remains 10 MiB.                                                                                                |
| Product HTTP bodies                | Existing 64 KiB ordinary JSON; import 5 MiB + 64 KiB overhead, `product-http.ts` bounded parsers and strict contracts   | Limits precede product request validation; auth remains under Better Auth ownership.                                                                                                                                   |
| Resource creation                  | Owned active boards 100, checkpoints 100, threads 2,000, comments per thread 500                                        | Existing owner/board/thread locks and transaction counts retained. Deleted discussion markers still count; idempotent retries do not create another resource.                                                          |
| Export allocation                  | Existing `packages/export` bounded JSON/depth and PNG `imageDimensions`: 8,192 pixels per side, 32 million total pixels | Dimensions/pixels checked before canvas allocation. No additional export gap found requiring a policy change.                                                                                                          |

Operational defaults now alias shared rates, admission and WebSocket timing instead
of duplicating numeric product budgets. Server wall time remains appropriate for
lease/expiry timestamps; traffic accounting uses authoritative `performance.now()`.

## Rate and reconnect policy

Each socket retains the published content rate of 20/s, burst 40. Presence has its
independent 15/s window; excess ephemeral presence is dropped without modifying the
durable stream. Presenter traffic retains its separate existing 15/s window.

Additional account+board and board abuse scopes survive socket/session reconnects.
Their content budgets are 200/s, burst 400; presence and presenter each have 150/s,
burst 150. These accommodate all ten legal sockets at their published rates. Join
admission has a separate 10/s, burst-ten budget per scope; room capacity is checked
first so an eleventh concurrent member still gets `ROOM_FULL`. Verified user and
board IDs define scope, never client identity, cookies or session tokens. No scope
keys enter diagnostics. This is process-local protection for the singleton writer,
not a distributed rate guarantee.

The scope map is capped at 220 (twenty rooms × eleven scopes). New identities get
temporary `SERVER_BUSY` while full. Idle entries may expire after five seconds,
when every lane has fully refilled; spent credit is never evicted to make space.
Both scopes are charged on rate refusal. Nonfinite clocks fail closed; rollback
cannot mint tokens. Disconnect alone does not reset aggregate credit.

Client temporary errors (`SERVER_BUSY`, `RATE_LIMITED`, `ROOM_FULL`,
`PERSISTENCE_FAILED`) retain the exact first pending update ID and bytes. Repeated
post-ready refusal increases the existing exponential retry delay with jitter,
up to the shared ceiling; READY alone no longer resets it. A persisted matching
ACK or a READY with no pending work resets backoff. Permanent document/causal
recovery stays distinct. A locally oversized pending update reports
`DOCUMENT_LIMIT` before base64 allocation and remains recoverable through the
existing full pending-work export. No graph/text/history truncation, automatic
splitting, receipt deletion or skipping dependent updates occurs.

## Strict supporting cases

Database-free tests exercise 40 content burst, twenty-token refill, separate
presence, monotonic rollback, aggregate scope saturation, scope expiry, 200/201
pre-hello sockets and upgrades, unresolved lookup credit after timeout, fragmented
16 MiB + one byte before concat, FIFO saturation with unrelated-room progress and
the next legitimate operation. Gateway update acceptance in rate tests is a mock
receipt, not durable acceptance. Upgrade tests use in-memory streams and a fake
session lookup, not a listening socket or database.

Real Node worker cases cover malformed/schema/count/immutable/removal/causal
negatives and hidden text overflow. The hidden encoded-state fixture retains 500
logically deleted valid note bodies, then adds 32 live note bodies: each input is
within its own admission byte limit, but the complete candidate exceeds 10 MiB.
Every rejection compares complete accepted bytes and then validates a legitimate
candidate. `Buffer.equals` compares all bytes without expanding a 10 MB Jest
object diff. Existing timeout/crash/queue and unknown-wrapper tests remain intact.

Resource race sources remain in `boards.integration-spec.ts` (owned-board and
checkpoint caps), `discussion.integration-spec.ts` (thread/comment caps and deleted
markers). The durable harness's invalid/causal case now explicitly asserts a next
legitimate update commits at sequence one after zero receipts/logs on rejection.
All database execution is deferred.

## Prepared A23/A30 final procedure

Run only after the verification policy permits the required environment. Use the
isolated API integration runner and suites in [DB-02/05/06](phase8-verification.md).
Extend `auth-websocket.integration-spec.ts` with real authenticated sockets;
reuse the worker fixtures and pinned causal-gap fixtures. Existing
`p4-10-live-browser.mjs`, `p4-11-presence-browser.mjs` and
`p4-12-recovery-browser.mjs` are supporting harness sources, not current proof.
P8-10/P8-11 own the remaining runnable real socket/load extensions.

1. Seed two unrelated legitimate rooms with exact accepted-state hashes, sequence,
   snapshot/log and lifetime receipt counts. Send malformed bytes, decoded/frame
   adjacent-cap inputs, hidden text/state overflow, missing update and pending
   delete-set predecessors through the production socket path. Record safe error,
   no rejected ACK/fanout, unchanged accepted bytes/sequence/log/receipts.
2. Force a real worker hang/timeout and late result with controlled test directives,
   fill two workers plus twenty waiting jobs, and saturate the room queue without
   dropping protected deliveries. Assert ceiling counts and safe temporary refusal;
   unrelated-room health/control traffic must progress. Capture durations rather
   than inferring responsiveness from mocked promises.
3. After each refusal, send a legitimate update with a fresh ID on the same room
   and the unrelated room. Assert committed ACK sequence, matching receipt bytes,
   peer convergence and room usability. For causal failure, preserve the rejected
   pending chain for recovery rather than silently skipping it.
4. Exercise burst 40, sustained 20/s and presence 15/s independently using
   calibrated server timing; reconnect repeatedly with the same verified account
   and separate sessions, then legitimate independent accounts. Confirm aggregate
   protection, credit retention/refill and exact FIFO backoff without starving
   legitimate traffic. Admit ten members / refuse eleven, twenty rooms / refuse
   twenty-one, and prove released capacity is usable.
5. Run concurrent owned-board/checkpoint/thread/comment near-cap winners against
   real PostgreSQL transactions, including idempotent retry and rollback. Capture
   actual winners/counts, not mock lock calls. Attach environment/build identity,
   source/result hashes and timing observations without content or credentials.

Database cases: **UNRUN (deferred by user — until Version 1 implementation is complete)**.
Browser cases: **UNRUN (deferred by user)**. No substitute Node check closes
A23, A30, transaction fairness or release acceptance. Next implementation: P8-06.
