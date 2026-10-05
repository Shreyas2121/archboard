# AI HTTP and event transport

The authenticated routes under `/api/v1` use the existing HttpOnly Better Auth
session cookie, strict shared contracts, safe API errors, and `Cache-Control:
no-store` on success and failure. The application checks run ownership and current
active-board owner/editor authority. Cross-user IDs do not disclose runs. Viewer,
archived-board, and revoked-member requests retain existing permission errors.
AI disabled mode exposes safe availability without constructing durable AI services.

| Operation                     | Request                                                                  | Response                                                                            |
| ----------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `POST /ai/runs`               | `AiCreateRun`, UUID `Idempotency-Key`, no query fields                   | 202 `{ data: AiRun }`; creation, replay, active dedupe or exact private cache reuse |
| `GET /ai/runs/:runId`         | UUID run ID, no query fields                                             | 200 authorized status/result, including explicit expired content                    |
| `GET /ai/runs/:runId/events`  | UUID run ID, optional canonical decimal `Last-Event-ID`, no query fields | 200 bounded snapshot SSE                                                            |
| `POST /ai/runs/:runId/cancel` | `{ schemaVersion: 1 }`, no query fields                                  | 200 current run after idempotent cancellation request                               |
| `GET /ai/availability`        | optional UUID `boardId` query                                            | 200 advisory feature status and durable application allowance                       |

Create resolves the operator-owned provider/model, identity, prompt, and reservation
through `AiRunApplication`. No public route accepts those internal fields. DTOs
exclude actors, board-derived hashes, provider details, prices, usage, dispatch
fences, and encrypted payload metadata. Creation reports cache/dedupe source when
applicable; status inspection reports the original generation's lifecycle.

Presentation requests may include `presentationMode: 'append' | 'replace-reviewed'`;
omitting it defaults to append. This field is rejected for other tasks. A presentation
result must match that reviewed mode. Append requires empty `expectedStepIds`;
replacement must name every step included in the explicitly reviewed context.
Proposed references must belong to that context. The application allocates fresh
step IDs and derives bounded viewport rectangles and order locally. Only a separate
review and explicit Apply writes steps; generation and private highlights never
start presenter mode. Mode, reviewed steps, geometry and private history participate
in exact actor-private result identity. Public schema version remains 1; the server
prompt/output schema versions are `ai-prompt-v5` / `ai-schema-v5`.

Only the canonical `POST /api/v1/ai/runs` JSON route selects an 8 MiB parser. It
checks raw decoded bytes, valid UTF-8, JSON depth and forbidden prototype keys before
strict shared-schema validation. This accommodates escaping and request overhead
around a reviewed context file whose own raw limit remains 1 MiB. The ordinary
65,536-byte cap and import-specific parser ceiling remain unchanged. Better Auth
keeps its original request stream and registration order. Fitting transport limits
does not guarantee the rendered request fits the configured model's input budget.

Browser requests use the configured API/web origins; foreign Origin and cross-site
Fetch Metadata requests are rejected, including alternate-case route spellings.
Credentials in query strings are rejected. Forwarded headers do not establish
actors, origins or rate-limit identities. There is no new proxy trust policy.

Create consumes durable actor request frequency even for receipt replay/cache hits.
Status, cancellation, availability, stream opening and each stream snapshot consume
the durable actor poll limit. SSE also uses the existing bounded actor/global
connection gate. Money allowance subtracts outstanding lifetime reservations from
current daily, monthly and lifetime ceilings, including unknown liabilities across
rollover. Fresh allowance reflects both current minute and day limits. Availability
is advisory; creation still atomically admits/reserves work. `resetsAt` stays null
because rollover cannot guarantee that outstanding or lifetime liabilities disappear.
Only authoritative positive delays become `Retry-After`; no delay is invented for
unknown money holds. Safe input-too-large errors map to 413, expired receipt/content
errors to 410, and rate/allowance errors to 429. Normal missing/expired completed
content remains a 200 status snapshot with explicit expiry, never fresh generation.

SSE emits shared-contract events with canonical decimal snapshot IDs derived from
the run's update timestamp. `Last-Event-ID` is bounded and validated but does not
select a private replay buffer: every reconnect reads and emits a fresh authorized
snapshot regardless of its previous ID. IDs are snapshot markers, not a gap-free
event log. The client must fetch the authorized status route after a result notice.
No provider stream, text delta, prompt, proposal or result payload rides SSE.

The initial snapshot is followed by a snapshot or heartbeat comment every five
seconds. Cookie session and current board authority are checked for each delivery.
Terminal `result-available`, `content-expired`, `failed` (including outcome-unknown)
and `cancelled` events close the stream. A failed check before stream bytes uses
the normal error envelope; a failed check after bytes closes without further content.
Each connection lasts at most 120 seconds, at most 64 frames and 65,536 bytes, with
no application replay/output queue. Backpressure closes after one bounded write.
Disconnect, revocation, deadline and shutdown release subscriptions/timers. Closing
an event connection never cancels generation. Status/reconnect/recovery never submits
a provider request. Expired completed results no longer disclose the result kind;
clients render their explicit expired-content state rather than an Apply action.

Database-free Nest transport and timer fixtures provide implementation checks.
Real PostgreSQL/HttpOnly-session/stream permission fixtures are prepared in
`ai-persistence.integration-spec.ts` and remain **UNRUN (deferred by user — until
Version 1 implementation is complete)**. Browser transport is **UNRUN (deferred by
user)**; live provider proof is **UNRUN (requires separately authorized operator
budget and reviewed inputs)**. These acceptance gates remain OPEN.
