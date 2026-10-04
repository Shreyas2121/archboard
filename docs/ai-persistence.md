# AI persistence foundation

AI-C05 adds feature-owned durable intent and encrypted result storage. It has no
HTTP routes, provider execution, funded quota admission, background queue or exact
result-cache index. Those follow in [AI-C06 and later tasks](../guide.md#ai-c06--durable-rate-token-concurrency-and-spending-gates).
Database acceptance remains OPEN under the [verification policy](verification-policy.md).

## Records and lifetime

| Record                       | Persisted content                                                                                                                                                                                   | Lifetime / coordination                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `ai_runs`                    | Actor/namespace/board identity, opaque hashes, task, immutable nonsecret provider/model/config/pricing/counting/version snapshot, lifecycle, dispatch fence, safe usage/failure and payload locator | Durable; active fingerprint unique per namespace and actor                                                      |
| `ai_creation_receipts`       | Actor/key/body hash and original run ID                                                                                                                                                             | 24-hour replay window; expired rows remain tombstones                                                           |
| `ai_reservations`            | Maximum money, input/output capacity, attempt bound, funding timestamp and settlement status                                                                                                        | Durable; unknown outcomes retain the full maximum liability                                                     |
| `ai_settlements`             | One terminal effect per run, fence, actual money or explicit unknown, normalized usage/failure                                                                                                      | Immutable, once per run                                                                                         |
| `ai_private_payloads`        | AES-256-GCM ciphertext, nonce, authentication tag, ownership/version/expiry binding and byte accounting                                                                                             | Short result TTL, at most the configured payload byte ceiling (512 KiB hard ceiling) plus 28 bytes of nonce/tag |
| `ai_capacity_scopes`         | Global/actor rate, token, concurrency, poll and SSE counter periods                                                                                                                                 | Durable UTC period identities; admission arithmetic follows in C06                                              |
| `ai_budget_periods`          | Global/actor day, month or lifetime committed and reserved micro-USD                                                                                                                                | Durable financial totals; no financial TTL                                                                      |
| `ai_reservation_allocations` | Origin scope/metric/period and reservation amount                                                                                                                                                   | Durable allocation identities for period rollover and once-only C06 settlement                                  |

Prompt, conversation, context and plaintext results are never stored in these
accounting rows. Snapshot schemas select explicit nonsecret fields and reject
unknown fields. Private result JSON is validated against the shared semantic
contract before encryption. Payload capacity across entries/actors and exact cache
reuse belong to C16; C05 bounds each payload and cleanup batch, and does not claim
that aggregate cache capacity is enforced.

The intent port is internal server infrastructure. Its hashes must come from
trusted server canonicalization and keyed private-content hashing; they are not
client assertions. C07/C16 provide request construction and exact cache identity.
A matching receipt returns its original run without renewing its deadline or
result TTL. A changed body conflicts. An expired receipt returns
`AI_RESULT_EXPIRED`, never a fresh paid intent. A different key can alias the same
active actor-private fingerprint only when board, body, task and full immutable
configuration snapshot match. No reuse crosses actors or deployment namespaces.

## Transactions and lock order

Every repository operation uses the same `QueryRunner.manager` inside the shared
`PostgresTransaction` lifecycle. The AI feature does not use a provider inside the
boards `IdempotencyService.execute` effect. No provider port is available to its
intent service.

Acquisition order for user creation/read/dispatch is:

1. Current board authority using the shared locked permission operation, then actor existence.
2. Namespace-global AI transaction advisory lock, then actor AI lock.
3. C06's deterministically sorted capacity/budget period rows, when admission is added.
4. Actor-private fingerprint advisory lock.
5. Creation receipt advisory lock, when creating/replaying.
6. Run advisory fence and existing run row lock.
7. Reservation row, then terminal settlement/payload writes.

One operation touches at most one board. No path acquires board authority after
an AI coordinator lock. PostgreSQL advisory keys use JSON-framed values and
transaction scope. Hash collisions only serialize unrelated operations. The coarse
namespace lock intentionally serializes this portfolio-scale foundation. Expired
payload cleanup takes only the namespace lock and a bounded ordered batch of at
most 64 rows; it never waits for a board lock.

PostgreSQL `clock_timestamp()` owns lifecycle times, including time after lock
waits. New intent, pending reservation and receipt commit together. Creation itself
does not claim a funded budget. Dispatch requires admitted phase, reserved funding,
positive maximum money and an unexpired deadline; it writes a fresh UUID fence and
deadline-bounded lease before any later network call. C06 must fund admission and
apply capacity/budget settlement in these same transactions; a status transition
alone is not proof of quota admission.

The forward migration defines active uniqueness, owner-linked receipt/payload
foreign keys, nonnegative signed-bigint totals, UTC period constraints and
immutable snapshot/receipt/settlement/liability rules. Deferred accounting triggers
require coherent run/reservation/settlement records at commit. Real execution of
these constraints and migration rollback/forward behavior is still deferred.

## Settlement and disclosure

`settle` is a trusted worker operation with no returned private data. It records
accounting even when the initiating actor subsequently loses board access.
Creation receipt replay, run reads and dispatch still recheck current authority.
C08 must expose an explicit public projection through authenticated routes, never
serialize these internal records or expose the worker settlement port.

Only the matching dispatch fence can settle dispatched work. Known usage requires
known money and an unexpired lease; expired/stale worker effects cannot overwrite a
terminal record. Definitely unsent work has zero charge; its matching fence may
already exist because durable dispatch intent precedes actual network execution.
Unknown execution retains the original maximum reservation indefinitely.
Identical terminal retries preserve the original payload; conflicting retries fail.
C07 adds recovery and orchestration. This foundation never retries a provider or
resubmits uncertain work.

AES-GCM associated data binds namespace, actor, origin run, payload ID, schema/key
versions and exact expiry. Every seal uses a random 12-byte nonce and 16-byte tag.
Reads require the current authorized actor and matching run association before
decryption. Missing, expired, substituted, tampered or unavailable-key payloads
yield expiry or a safe `AI_RESULT_EXPIRED` error; no path regenerates content.
Physical payload deletion leaves receipts, usage and financial accounting intact.
Key bytes are private class fields, and crypto/SQL errors expose fixed safe messages
without native causes or plaintext. Plaintext buffers are cleared after use.

Design references: [PostgreSQL explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)
and [Node.js authenticated encryption API](https://nodejs.org/docs/latest-v22.x/api/crypto.html).
These references informed the implementation; they do not replace local database proof.
