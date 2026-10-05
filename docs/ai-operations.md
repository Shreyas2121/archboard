# AI operations runbook draft

AI-C17 adds bounded maintenance, safe diagnostics and spending controls to the
single-writer runtime. Acceptance remains OPEN under the
[verification policy](verification-policy.md). These procedures do not authorize
deployment, configured migrations, database verification or paid probes.

## Stop and resume spending

Set optional server-only `AI_KILL_SWITCH_FILE` to an absolute local path in an
operator-controlled directory readable by the API service account. Keep it outside
public assets and user-writable directories. Presence of any filesystem object
disables AI; access/I/O failures fail closed. Contents are ignored, and the path
does not enter diagnostics. Changing the configured path requires restart;
creating/removing the marker takes effect without restart.

For a configured `F:\operator\ai-disabled`, an operator can use:

```powershell
New-Item -ItemType File -Path 'F:\operator\ai-disabled'
```

To resume, remove that exact marker:

```powershell
Remove-Item -LiteralPath 'F:\operator\ai-disabled'
```

An absent marker allows normal admission. Leaving the path unset disables only
this optional mechanism. `AI_ENABLED=false` still disables the entire feature at
startup. Trusted in-process code can also call the exported
`AiOperations.setPaidEnabled(false)`; no product HTTP operator endpoint exists.
The marker survives restarts, while the in-process toggle resets.

The existing `readsWhenDisabled=false` policy blocks creation, receipt/cache
reuse, GET and SSE reads with `AI_DISABLED`; availability reports disabled.
Already-open streams recheck on their next read. Authorized cancellation,
maintenance and settlement continue under marker disable. Starting with
`AI_ENABLED=false` removes the AI runtime entirely, so use the marker when
cleanup/recovery must continue.

Cancellation still executes while disabled. If its response would disclose an
already-completed private result, that response returns `AI_DISABLED` after the
authorized operation, keeping the durable terminal state unchanged. Creation,
GET and SSE also recheck the switch after asynchronous work, before disclosure.

Already-sent calls may finish and settle under their original configuration.
Newly funded workers recheck before dispatch and settle unsent if disabled.
Every retry/repair rechecks before further provider I/O. There is an unavoidable
small interval between the last check and external send. Disable/abort never
establishes zero usage or releases unknown monetary liability.

## Circuit breaker

Breakers are process-local, internally keyed by provider/model/configuration
fingerprint, and bounded to 16 states. Three failed foreground executions open a
breaker for 30 seconds. Successful terminal provider responses reset it; refusal
and incomplete output are responses, not transport outages. Cancellation or
undispatched work does not count as a provider failure.

An open breaker rejects fresh admission with `TEMPORARILY_UNAVAILABLE` while
authorized replay, exact-cache reuse and deduplication remain possible if AI is
enabled. After cooldown, only one normally funded foreground worker can hold the
half-open probe lease. Other contenders are rejected or settled unsent. Failed
or canceled probes renew cooldown. There are no paid background probes,
automatic redispatch or cross-provider failover. Restart resets breakers, while
durable budgets and unknown liabilities survive; use the marker for a persistent
stop. Breaker keys never enter diagnostics.

## Retention and restart recovery

Maintenance starts on module initialization, waits for runtime admission, and
then schedules every 30 seconds after the preceding pass ends. It never overlaps
passes or queues catch-up work. Each pass deletes at most 64 expired encrypted
payloads under the namespace coordinator; foreign-key cascade removes cache
indexes. TTL stays fixed, and database COUNT/SUM reports retained unique entries
and ciphertext/nonce/tag bytes. C08 enforces actor/deployment capacity on
settlement. Cleanup restores capacity while preserving receipts, run locators,
usage, settlements, reservations and unknown liabilities.

The forward `AiMaintenance1791072000003` migration adds a partial active-deadline
index to avoid scanning terminal history during discovery. It is registered but
has not been applied or inspected during implementation. Prepare it with the
other pending AI migrations under existing authorization.

Each pass discovers at most 64 active runs with expired total deadlines or
dispatch leases without board/run locks,
then recovers each through a separate fenced transaction. Recovery rechecks
namespace/actor/fingerprint/run locks in the established order. Expired unsent
intent releases unused capacity; expired dispatch becomes `outcome-unknown` and
retains spending liability across budget periods. It never calls a provider.
Failed maintenance retries only maintenance. Writer loss stops new passes and
prevents commits. The next enabled writer can recover expired durable intent.

Authorized GET returns expired content for expired, evicted, tampered or
unavailable-key payloads, preserving safe terminal metadata. It never regenerates
or extends TTL. Receipt tombstones outlive private content.

## Rotate private payload encryption keys

1. Create the spending marker. Allow sent calls to settle, or gracefully stop
   the process and retain their uncertainty through fenced recovery.
2. For routine rotation, wait the configured result TTL after the last result
   settlement and allow bounded cleanup to drain. TTL is at most 15 minutes.
3. Provision a new independently generated AES-256 `AI_CONTENT_ENCRYPTION_KEY`
   and distinct `AI_CONTENT_KEY_VERSION` through the operator secret manager.
   Never print keys, place them in public variables or put them in the marker.
   Keep the HMAC cache-key secret independent.
4. Restart with the new key/version and the same deployment namespace and
   financial records. Keep the marker until authorized readiness verification
   permits resuming, then remove it.

For emergency compromise rotation, rotate immediately and accept early content
expiry. Old ciphertext remains bounded until its original expiry and cleanup.
Old receipts replay metadata; unreadable content reports expired. Only an
explicit new intent may generate through normal admission. There is no dual-key
plaintext cache, implicit re-encryption or automatic generation. Retain/destroy
old keys only through the operator secret-history policy. Never rewrite
accounting or unknown outcomes. HMAC rotation is separate and may safely cause
old request hashes to conflict; see the
[cache rotation contract](ai-cache.md#rotation-and-integration-handoff).

## Safe diagnostics

Each successful pass emits one `ai.operations` JSON event containing
`paidDisabled` and fixed aggregate metric names with decimal-string values.
Trusted operator code can inspect `AiOperations.snapshot()`. There are no
content labels, actor/board/run IDs, emails, paths, URLs, fingerprints, raw
exceptions or provider request IDs. Failed diagnostic sinks cannot affect work.
Public routes keep the existing safe run/allowance DTOs.

Counters include exact-cache hits, fresh misses, deduplicated starts, refused
creation admission, provider calls including retry/repair, reserved/settled
micro-USD, unknown outcomes, cancellations, total worker latency, uncached input,
cache-read/write, output and separately billed reasoning tokens, deleted payloads
and maintenance failures. Reasoning included in output is not charged twice;
write-class names never become labels. Gauges report expired-payload backlog and
retained entries/bytes at the last successful pass.

Counters reset on restart, and a crash between commit and observation may lose an
increment. Durable accounting remains the financial authority. Unknown usage
does not fabricate zero token consumption. Settlement replay adds no duplicate
usage/cost observation. Maintenance failure can delay diagnostics; use normal
deployment process health as well. Inspect authorized accounting records locally
when investigating liability, and never export private rows into diagnostics.

## Bounded shutdown and deferred acceptance

Runtime admission stops first. Worker drain aborts streams and waits at most
five seconds, including uncooperative providers/stalled settlement; local
worker cancellation uses the same bounded wait. Maintenance cancels its timer,
stops further scheduling/recovery iteration and waits at most one second for an
active pass. The existing process shutdown deadline bounds application close;
writer fencing and platform transaction timeouts still apply. An incomplete
settlement is recovered after its durable lease/deadline, without resubmission.

Prepared PostgreSQL restart/failure/recovery and migration round-trip tests:
**UNRUN (deferred by user — until Version 1 implementation is complete)**.
During final verification, also exercise actual process termination, concurrent
cleanup/settlement, writer loss and transaction stalls against an explicitly
selected isolated database. Browser expiry/SSE/cancel behavior:
**UNRUN (deferred by user)**. Live breaker/usage/cost behavior:
**UNRUN (requires separately authorized operator budget and reviewed inputs)**.
