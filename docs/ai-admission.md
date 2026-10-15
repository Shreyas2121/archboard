# AI admission and accounting

> Retired from the application runtime on October 14, 2026. Retained as a legacy
> implementation reference. See [Project JSON](project-context.md) for the current
> local import workflow; legacy enablement does not activate hosted AI.

AI-C06 implements paid admission on top of the [persistence contract](ai-persistence.md).
It introduces no provider orchestration or HTTP/SSE endpoints. Database acceptance
remains OPEN under the [verification policy](verification-policy.md).

## Admission and immutable prices

Enabled Nest composition injects `AiAdmissionService` into `AiIntentService`.
Validated create requests first consume a separately committed actor request limit,
including replay, deduplication and failed paid admission. The burst is a fixed UTC
second ceiling; the other request limit is a fixed UTC minute. Invalid/unauthorized
requests still use the existing outer HTTP boundary in C08.

Within the creation transaction, board authority precedes namespace and actor
coordinator locks. Current and origin ledger identities are locked in deterministic
global-before-actor order, then fingerprint, receipt and run/reservation records.
A fresh miss inserts the run/reservation, funds all paid scopes, and writes its
receipt in that transaction. Denial rolls back paid records and totals; it does not
refund the cheap request already committed. Replays and aliases do not fund again.
The optional foundation-only constructor can create pending metadata for tests and
recovery; it cannot dispatch funded work without the admission service.

Funding requires an exact server policy/profile snapshot, valid positive prices,
and the complete derived maximum allowance. Each possible attempt reserves the full
configured input cap, output cap and separately billed reasoning allowance when
configured. The input price is the greatest configured uncached/read/write rate,
plus conservative per-category rounding slack. No cache hit is assumed. Tokens and
micro-USD use bigint arithmetic and decimal strings, with upward rounding per
disjoint billed category. Overflow, zero/missing required prices, unpriced usage or
under-reservation blocks dispatch.

The input cap is a bound for the entire rendered request, including instructions,
schema and overhead. C07 must establish the configured authoritative counting
method before calling the adapter. A characters-per-token guess is not a valid
counting proof. These operator prices bound admitted estimated liability; they do
not claim to reproduce provider invoices or future price changes.

All optional money/provider overrides and positive finite defaults remain.
The default provider RPM changed from two to three so the initial attempt, one
repair and one rejection retry can be reserved. Input/output defaults remain
60,000/10,000 tokens per minute. Profiles must fit the full configured attempt
allowance, or the operator must lower bounds/disable an allowance/override ceilings.
See [operator configuration](ai-operator-configuration.md).

## Durable scopes and attempts

Fresh-run minute/day counts are consumed once at funding and survive restart.
Paid concurrency is held globally and per actor until terminal settlement.
Provider requests/input/output are reserved for all allowed attempts, both in their
origin minute and in active held-capacity rows. New minute admission includes active
remaining holds, so calendar rollover cannot refill unspent attempt capacity.

`markDispatch` writes the run fence and first immutable `ai_provider_attempts`
claim atomically before network execution. Every additional C07 retry/repair must
call `claimAttempt` with the same live fence before its network call. Claims
transfer one attempt's reserved capacity into committed capacity in the actual
claim minute. A new minute does not erase the remaining allowance. Claimed capacity
stays consumed for unsuccessful or definitely unsent attempts; this intentionally
uses conservative full caps rather than refunding uncertain provider windows.
Unused allowance is released on terminal settlement. Total claims cannot exceed
the funded maximum and cannot cross the deadline or change the dispatch fence.
C07 still classifies retry/repair reasons and enforces at most one of each.

A new forward migration adds fixed-second counters, immutable ordinal attempt
claims and deferred funding checks. Funded records require the complete allocation
matrix and matching actor/deployment lifetime liability totals. Dispatching records
require an attempt claim. Existing applied migration sources are untouched.
The new migration refuses destructive `down` execution; later changes to financial
history require a reviewed forward migration.

## Money, rollover and settlement

Every actor has day/month/lifetime accounting even when the optional actor daily
ceiling is absent. Enabling that ceiling later does not erase earlier spending.
Global day/month/lifetime totals are likewise durable. Before funding:

`current period committed + all outstanding lifetime reserved + new maximum <= ceiling`.

Outstanding reserved money includes old-period active and unknown work.
Unknown settlement releases local concurrency and unused attempt capacity, while
preserving every monetary reservation indefinitely. Receipt/result expiry cannot
release it. A known or definitely unsent terminal effect releases the original
holds and records actual money once; supplied known money must match immutable
pricing and usage must fit claimed token bounds. A purported unsent result with
nonzero known usage is rejected.

Known work completing across a day/month boundary charges its origin and settlement
periods conservatively; lifetime money is charged once. Rollback of result encryption,
receipt insertion, accounting or commit preserves the original holds. Identical
terminal retries do not repeat money or capacity effects.

## Cheap connection/polling limits and HTTP errors

Status polling has an independent durable actor minute limit. C08 must invoke its
request admission port for user polls. `AiConnectionGate` supplies per-actor SSE
leases for the current single-writer runtime, bounded to 256 total live connections
with idempotent release. It never evicts a live lease to admit another connection.
C08 must release on close/error/shutdown and apply C07 event/subscriber byte bounds.
The connection Map is cheap runtime admission, never financial/run coordination.

The global HTTP filter maps safe AI errors: frequency/provider-window denial and
allowance exhaustion use 429 with distinct codes/messages; disabled AI uses 503.
Only an authoritative transient window contributes a positive integer
`Retry-After`. Concurrency/connection denial and exhausted money have no invented
reset. SQL/provider content and native causes are not disclosed.
