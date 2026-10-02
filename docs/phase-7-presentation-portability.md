# Phase 7 presentation and portability audit

Status: **OPEN**. P7-01 through P7-12 implementation and documentation are delivered.
A16, A17, A18 and A21 lack required integrated acceptance. M08 implementation may
proceed under the [verification policy](verification-policy.md). The user's local
merge request authorizes integration with these visible gaps; it does not close
the phase or Version 1 release gate.

## History, runtime and verification

Planning/integration base: `5726e72ed6b15a418cff5706a1a4844afbfc8cd1`.
Branch: `phase-7-presentation-portability`. The chronological
[evidence index](evidence/phase7/README.md) maps every task and the focused route/
response fix. There are no rewritten task commits or parallel waves. P7-12 changes
documentation only; production behavior remains at P7-11
`8ed437c3a8d20277bd56826f53b5eda1eb4f3aad`.

Windows, Node.js 22.23.2 and pnpm 11.24.0 were used. Manifests and
`pnpm-lock.yaml` remain the dependency authority: Phase 7 adds the pure
`@archboard/export` workspace package, connects it to web/API and moves fixtures
to API runtime dependencies for the fixed template registry. No external package
upgrade is attributed to this phase. Existing graph/protocol versions remain 1.
The existing foundation checkpoint table/entity and idempotency storage are reused;
Phase 7 adds no forward migration. Migration source review establishes alignment,
not the state of any configured database.

The [P7-11 evidence](evidence/phase7/P7-11.md) and
[sanitized report](evidence/phase7/P7-11-report.json) retain exact child commands,
working directories, runtimes, durations, test counts, source fingerprints and
build/harness SHA-256. `pnpm.cmd phase7:verify --implementation` exited 1:
**24 PASS / 1 FAIL / 14 UNRUN**, with **628 passing tests** and zero failed,
skipped, cancelled or TODO tests. The sole failure is 32 inherited dependency
boundary findings (13 frontend test/configuration locations, 19 API imports);
four negative fixtures passed. The checker was not weakened.

| Permitted child                                    | Tests |  Duration |
| -------------------------------------------------- | ----: | --------: |
| Contracts                                          |   164 |  2,220 ms |
| Fixtures                                           |    23 |  1,546 ms |
| Document model                                     |    91 |  5,124 ms |
| Export                                             |    22 |  1,394 ms |
| API in-memory/Node units                           |   180 | 46,141 ms |
| Web Node units                                     |    68 |  3,172 ms |
| Presentation/portability/storage lifecycle scripts |    79 |  1,729 ms |
| Account selection                                  |     1 |    469 ms |

Formatting (12,427 ms), lint (11,506 ms), workspace types (42,693 ms), seven
workspace builds (34,873 ms), public/cache/evidence secret scans and seven browser
syntax checks passed. Initial formatting and sandbox minifier failures are
preserved separately from the corrected approved retry. The last prepared
duplicate rollback assertions followed the aggregate and received a final API
typecheck and focused lint; executed unit/production sources did not change.
The report distinguishes aggregate and final source fingerprints. This audit
reuses those results; it does not claim a fresh full run on its documentation tree.

Recorded web artifacts: JavaScript `index-Bwqx27oB.js`, CSS `index-C5JSv-mx.css`,
service worker `sw.js`; their exact hashes are in the report. No served preview,
database, socket integration or rendered acceptance was executed for this audit.
`--implementation` excludes those children. `--non-browser` retains real database,
session/socket/auth-schema/configured-migration checks. Full mode also includes
native/served browsers and fails closed on three missing reviewed evidence rows.
Partial success never means full phase PASS. See the executable
[verification inventory](phase7-verification.md).

## Deliverables and exit criteria

Each row separates delivered source/pure proof from still-required real boundaries.
The numbered deliverables match [phase7.md sections 16–17](../phase7.md).

| Deliverable / exit condition                          | Delivered source and permitted proof                                               | Outstanding acceptance                                                                                               |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 1. Contracts, limits, schema/API consistency          | P7-01 contracts/inventory; P7-06/07 controller/OpenAPI units; focused route fix    | Current configured schema/migrations and authenticated HTTP                                                          |
| 2. Concurrent step authoring, order, undo, deletion   | P7-02 model replicas/text/property/delete-wins tests; P7-03 Node policy/UI source  | Real offline persistence, keyboard authoring and remote deletion                                                     |
| 3. Local/offline/demo presentation and local viewport | P7-03 state/navigation and missing-target policies; P7-10 isolated demo            | Browser keyboard/focus, reload/offline and usable rendered states                                                    |
| 4. Single lease and opt-in follow; A21                | P7-04 holder/liveness/authority units; P7-05 explicit follow/pan/stale-frame units | Real independent authenticated sockets, expiry/revocation and persistent unfollow after pan                          |
| 5. Immutable checkpoints; A16                         | P7-07 queue/sequence/cap/receipt units; P7-08 generation/capture blockers          | Committed log capture, immutable bytes after compaction, lock races, rollback and offline-original restore isolation |
| 6. Fresh private creation; A17                        | P7-06 initializer/remap; P7-11 all-kind/typical/template semantic comparison       | Stored import/duplicate/restore/template snapshots, auth/retry/rollback/cap races                                    |
| 7. Complete JSON, strict import, recovery             | P7-06 strict parser/security tests; P7-08 full-content and request-state units     | Real downloads/files, above-cap recovery, storage/account/access failure and uncertain responses                     |
| 8. Controlled SVG/bounded PNG; A18                    | P7-09 XML/layout/limits/scope and adapter lifecycle units                          | Real SVG/PNG bytes, CSP/no fetch, selection/alpha/scale, allocation limits and cleanup/offline                       |
| 9. Three templates, blank, demo                       | P7-10 fixture validation/content and creation units; P7-11 semantic copies         | Real creation/download/import, template legibility, keyboard and demo offline                                        |
| 10. Coverage/verifier and inherited gates             | P7-11 628 tests, fail-propagating modes, prepared raw negatives                    | DB/socket/browser executions, three mandatory evidence rows and inherited boundary fixes                             |
| 11. Audit, run/API docs, evidence and handoff         | P7-12 audit/index; verification inventory and README                               | Documentation presence supplies no integrated acceptance                                                             |

**A16 OPEN:** units establish intent, while prepared `boards.integration-spec.ts`
must prove exact committed sequence, immutable bytes/metadata, cap/authorization/
rollback races and fresh private restore. P7-11's served harness must additionally
prove an independent offline original with pending work survives subsequent edits
to both original and restored boards.

**A17 OPEN:** pure tests preserve every authored field and remap endpoints and
highlights with mutually disjoint IDs/empty tombstones. Prepared real stored-copy
tests cover all four creation paths; actual file round trip and response-loss/
concurrent receipt behavior remain required.

**A18 OPEN:** strict malformed-input and controlled XML proof does not establish
browser inertness. Raw HTTP rejection must leave no board/receipt; served SVG/PNG
decode, CSP/headers, no external fetch, real limits and cleanup must be observed.

**A21 OPEN:** lease/follow units do not establish cross-session authorization or
camera behavior. Independent owner/viewer contexts must opt in explicitly, pan
locally, retain that viewport through later presenter frames, and release safely
on disconnect/reconnect, new lease, session/role/archive/removal and account switch.

Related A10/A11/A13/A22/A24/A25/A27 and focused A28 proofs are mapped individually
in the verification guide. Pending local storage, late account/access results,
direct routes and cache exclusions remain combined gates, not isolated unit PASS.

## Run, API and behavior boundaries

Use the root README setup and `pnpm dev` for authorized development. Build origins
must match the served API/WS origins. One API writer holds the PostgreSQL advisory
lock; do not infer deployment readiness from builds. Inspect OpenAPI source at
`apps/api/src/platform/http/openapi.ts`; routes below are under `/api/v1` and use
authenticated sessions, strict shared envelopes and current scoped authority.

| Method / path                                            | Behavior                                          |
| -------------------------------------------------------- | ------------------------------------------------- |
| POST `/boards`                                           | Blank or fixed `templateId`; fresh private graph  |
| POST `/imports`                                          | Validated portable document; fresh private board  |
| POST `/boards/{id}/duplicate`                            | Fresh copy of committed source only               |
| GET `/boards/{id}/checkpoints`                           | Paginated checkpoint summaries                    |
| POST `/boards/{id}/checkpoints`                          | Capture named exact `expectedSeq` committed graph |
| GET `/boards/{id}/checkpoints/{checkpointId}`            | Immutable detail; read-only client route          |
| POST `/boards/{id}/checkpoints/{checkpointId}/duplicate` | Restore into a fresh private board                |

The focused fix replaces the initial `/boards/import` mismatch with `/imports`
and maps import/restore `BoardDetail` to the strict summary response without
`memberCount`. Earlier task reports remain historical at their original hashes.
Checkpoint REST responses use `Cache-Control: no-store`; authenticated checkpoint
data cannot enter service-worker precache/runtime caches. Direct
`/boards/:boardId/checkpoints/:checkpointId` navigation needs SPA rewriting and
online scoped reads; offline shows unavailable, never a fabricated cached result.
Actual host rewrites/CSP/cache headers and active Cache Storage still need proof.

Steps use Y.Text title/notes, atomic rectangle/highlight values and deterministic
`(order,id)` ordering. Limits include 50 live steps, 4,000 note characters and
500 combined highlights; world coordinates are bounded to ±100,000, rectangle
dimensions to 20,000 and order to ±1,000,000. Tombstones are append-only; supported
local undo preserves remote edits. Presentation and participant camera are local
state, never durable graph properties.

Presenter authority belongs to one authenticated owner/editor connection, not a
user identity shared across tabs. Only committed steps can be broadcast. The
30-second lease renews through holder native pong; dead socket timeout is 45
seconds. Ready/graph/current-presenter ordering and fresh authorization guard
fanout. Disconnect, authority loss, archive/removal, shutdown/restart clear the
lease. Frames do not change durable sequence, receipts, timestamps or outbox.
Following is explicit and resets on local pan/unfollow/exit, new lease/reconnect,
board/account change; stale frames cannot restore consent.

Checkpoint capture trims names to 1–120 characters, requires canonical decimal
`expectedSeq`, and caps each board at 100 checkpoints. Queue/transaction and
authority locks capture committed snapshot/log state, not participant pending
bytes. Capture does not advance graph sequence or produce graph ACKs. Metadata
and encoded graph remain frozen; resource hints occur only after a new commit,
not rollback, no-op or receipt replay. Local capture requires settled persistence
and acknowledged outbox. Viewers may read; archived sources may be restored into
a new private board while online. Unknown/nonmember scopes conceal with 404;
known denied roles use 403.

Creation operations use actor/operation-scoped UUID idempotency keys and exact
payload hashes with 24-hour receipts; the active owned-board cap is 100. Uncertain
requests retain payload/key for explicit retry and require current authorization.
Reconnect never blindly submits; expiry requires result review before a new
intent/key. A definitive sequence conflict requires refreshed state and explicit
new intent. A replay returns the original effect despite later source changes.

JSON exports include full untruncated local content, pending/in-memory edits and
truthful `server-saved`/`local-only` status. Envelope: `format: archboard`,
`formatVersion: 1`, timestamp, title/description and graph schema 1. Above 5 MiB,
the recovery download stays complete and warns that normal reimport is impossible.
Import is whole-file valid UTF-8 with a 5 MiB cap, bounded depth/request overhead,
strict versions/fields/geometry/handles/URLs/references and prototype rejection.
MIME/extension are hints, never authority. No execution, external fetch, partial
repair or merge into an existing board is allowed. All graph IDs/references and
Yjs identity are fresh; comments, access, invites, checkpoints, receipts,
credentials, presenter/camera state, tombstones and CRDT history are excluded.

SVG uses controlled fixed primitives/tokens and escaped XML, without raw markup,
scripts/events, external fonts/images, hrefs, CSS or foreignObject. Invalid XML
controls, lone surrogates and U+FFFE/U+FFFF become U+FFFD; valid supplementary text
is retained. Bounded character-cell wrapping and clipping may hide image overflow;
JSON retains the complete source. Labels, strokes and padding contribute to bounds.
Whole-diagram/selection scope exports selected nodes/boundaries and only edges
whose endpoints are included; edge-only omissions are explained. PNG supports
1×/2×, transparency or current theme background. Limits are 8,192 pixels per side
and 32 megapixels, checked before canvas allocation. Failure requires reducing
scope rather than silent resizing/cropping. Cancellation/error/unmount clears
image sources, object URLs, canvas/buffers; actual browser resource cleanup remains
unproved. SVG size bounds and current graph preservation also remain required.

| Template         | Cards / edges / boundaries / steps | Content                                                                             |
| ---------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| Web application  | 5 / 3 / 1 / 4                      | Browser, API, database, cache, request JSON; HTTPS/SQL/cache flow                   |
| Event processing | 6 / 4 / 0 / 3                      | Producer, queue, worker, database, notification, retry note; AMQP/SQL/HTTPS         |
| Service boundary | 6 / 3 / 2 / 3                      | Gateway, identity, application, database, schema and ownership note; OIDC/HTTPS/SQL |

Only fixed registry IDs are accepted. Blank creation has no graph objects. `/demo`
uses the web application graph with isolated local presentation/export and no
server checkpoint/save/lease simulation. Template visual readability is deferred.

## Historical boundaries and M08 handoff

[Phase 2](phase-2-editor.md) stays OPEN (pan p95 and spoken screen-reader gap).
[Phase 3](phase-3-identity-boards.md) retains historical PASS with separately
reported GitHub/browser/human observations. [Phase 4](phase-4-collaboration.md),
[Phase 5](phase-5-offline.md) and [Phase 6](phase-6-discussion-sharing.md) remain
OPEN on their own fault/latency/preservation/integrated gates. No Phase 7 result
refreshes earlier build proof. Foundation-applied/retention-pending configured
migration observations and migrated isolated test schemas remain historical and
distinct; current configured state is uninspected during the pause.

M08 should retain typical, all-kind, three-template, limit and hostile-text fixtures
from `packages/fixtures`, model/export negatives and P7-11 harnesses. Preserve
original pending recovery namespaces and full JSON; copied graph data must never
acquire discussion/access/history. Resolve the inherited 32 boundary findings
without weakening the checker and retain earlier performance/security blockers.

1. After all M00–M08 implementation, confirm a disposable database target and run
   consolidated API integration, auth schema and configured migration checks:
   `pnpm phase7:verify --non-browser`, with earlier-phase regressions. Verify real
   HTTP/socket current authority, lease ordering/expiry/fanout, snapshot/log capture,
   cap/receipt/rollback races, private stored copies and immutable checkpoints.
   Keep isolated migration results separate from configured migration state.
2. After explicit browser resumption, run `pnpm phase7:verify` against the recorded
   production build/origins and independent synthetic session fixtures. The
   verification guide names all seven scripts and native suite. Observe actual
   downloads/decode, CSP/no fetch, SPA/no-store/cache, opt-in pan, offline original
   isolation, pending storage/account/access failure and response-loss recovery.
3. Supply the three missing reviewed evidence rows: combined A10/A22/A24 recovery
   (including above-cap/expiry/multi-tab), A18 host/image limits and cleanup, and
   focused A28/template legibility/keyboard/spoken screen reader. Full mode cannot
   pass until these are wired with meaningful evidence validation.
4. Reconcile failures with all inherited audits and the unchanged Version 1
   release gate in `plan.md`; M08 delivery alone does not certify release.

Database/session/socket/schema checks: **UNRUN (deferred by user — until Version 1 implementation is complete)**.
Browser checks: **UNRUN (deferred by user)**. Human/integrated observations remain
UNRUN. No database migration, remote push or deployment is part of this audit.
