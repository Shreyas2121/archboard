# Exact private AI result cache

> Retired from the application runtime on October 14, 2026. Retained as a legacy
> implementation reference. See [Project JSON](project-context.md) for the current
> local import workflow; legacy enablement does not activate hosted AI.

AI-C08 adds exact semantic result reuse and bounded encrypted retention to the
existing AI intent/coordinator ports. AI-C09 exposes authenticated run/event routes
through those same ports; no provider credential or shared result-cache endpoint
is public.
Database, browser and real provider acceptance remain OPEN under the
[verification policy](verification-policy.md).

AI-C16 adds optional provider prompt-cache optimization under the selected model's
server-only `promptCaching` profile. This is separate from exact private result
reuse: disabling optimization does not bypass identity/authorization or trigger
regeneration on a receipt replay. Configuration/generation changes invalidate
application reuse conservatively while receipts retain their original identity.
Provider routing uses opaque deployment/actor/target partitions and static
model/instruction/schema versions; private prompts and history are never routing
metadata. Supported explicit mode caches only the static prefix before reviewed
user data. Legacy implicit caching has provider-managed boundaries. See
[operator settings](ai-operator-configuration.md) for capabilities, retention,
write pricing and the distinction between disabling optimization and native
automatic provider caching. No fixture result establishes live cache savings.

## Identity and authorization

`AiRunApplication` is the server-owned creation entry point. It validates the
shared create contract, resolves the operator's provider/model and constructs the
prompt, immutable snapshot, reservation and keyed identities. Public routes must
use that entry point rather than accepting a client-supplied digest, model,
provider request or cost reservation.

`AiPrivateIdentity` uses HMAC-SHA256 with `AI_CACHE_KEY_SECRET`, independently of
the payload encryption key. Canonical JSON sorts object keys recursively and
preserves array order, exact text/case/whitespace and all normalized reviewed
fields. It includes deployment, actor, board/new-board target, access-policy
version, exact request/context/history, reviewed graph including local changes and
preconditions, server provider/model, rendered prompt/schema, generation settings,
all snapshot versions and nonsecret operator policy/configuration fingerprint.
No secret is part of the canonical input, and no content digest is logged.

Receipt identity uses a separate hash domain over actor/operation/target/reviewed
request, excluding changing server model configuration. The same key/body therefore
replays its original admitted configuration rather than dispatching under a new
model. Same key/different body conflicts. Expired keys remain tombstones.

Creation authenticates through its caller and acquires current locked board edit
authority before namespace/actor coordination, ledger rows, fingerprint and
receipt locks. Cache lookup and fresh admission share those locks with settlement;
they cannot race into independent paid work. Cache hits still consume C06's
create-frequency allowance, but add no provider attempt, money reservation or
fresh-call/token/concurrency usage. `AiRunApplication` reads the returned run under
fresh authority before disclosure; subsequent GET/subscription reads reauthorize.
Viewers, archived boards, revoked access and other actors cannot reuse private
content.

## Contents, expiry and capacity

The forward `ai_result_cache` table stores only an actor-private exact fingerprint,
origin run/payload locators and fixed timestamps. Its foreign keys and deferred
binding trigger require a matching completed run with known usage and matching
payload owner, origin, fingerprint and expiry. Ciphertext stays in the existing
`ai_private_payloads` table with AES-GCM associated data bound to deployment,
actor, origin run, payload/schema/key version and fixed expiry.

Only validated completed semantic results without an error/unknown outcome are
indexed. The route-facing creation pipeline additionally validates supplied
evidence keys, reviewed references and edit field preconditions with
`aiResultForRequestSchema`, including repair output. It never caches raw provider
streams, prompts, partial text, refusals, failures, unknown usage, new graph UUIDs,
layout or application receipts. Result kinds include semantic proposals, guidance
and clarification questions.

A cache hit references the original completed run and encrypted payload and adds
only a new creation receipt. It neither copies content nor changes the original
deadline, provider accounting or expiry. The returned `source` records cache reuse
separately from generation/replay/deduplication. This is an internal response;
C09 must serialize the public DTO rather than this accounting record. Existing
schema validation keeps new graph entities as semantic keys. C11 must allocate
fresh graph IDs and a distinct application intent for each genuinely new Apply;
the origin run is not an application receipt or an already-applied graph batch.

Default retention is 15 minutes from result creation, 512 KiB serialized per
payload, 128 unique retained payloads/16 MiB per deployment and 16 payloads/4 MiB
per actor. Hits do not renew TTL. Byte accounting includes ciphertext plus the
12-byte nonce and 16-byte tag. Limits apply to **all** unique private result
payloads, including output without a cache index, not just cache entries. There is
no process-local L1 cache.

Under the namespace coordinator, settlement computes exact database COUNT/SUM
totals, chooses deterministic earliest-expiring payloads, and evicts at most 64
per transaction to satisfy actor and global entry/byte limits before insertion.
Queries return at most 64 victim summaries per scope and never fetch victim
ciphertext. Large operator capacity reductions can require repeated bounded
cleanup passes; no new content is inserted above either limit. Existing immutable
run locators, receipts, usage and financial reservations survive eviction.
Deleting a payload cascades its index. Expired entries/payloads are never served;
bounded physical expiry cleanup is exposed already, with periodic scheduling in
C17. GET cannot initiate inference or renew retention.

Optional content/index writes use nested SQL savepoints. A failed cache-index
write loses reuse while retaining valid content. A failed/over-capacity payload
write leaves truthful completed metadata with expired/unavailable content, and
does not roll back known accounting or retry the provider. If the outer database
transaction itself cannot commit, C07's durable intent/recovery rules still apply;
no committed-success response or automatic redispatch is invented.

## Rotation and integration handoff

Rotating the HMAC secret changes opaque identities and prevents old-cache reuse.
Old keyed receipt hashes cannot be recomputed after dropping that secret; the
existing key fails safely with an idempotency conflict. It never silently retries
old paid work. Use explicit new intent keys for new requests and retain accounting.
An operator must account for the 24-hour receipt window when scheduling rotation.

Changing/dropping the content key or its version makes old payloads unreadable.
Cache lookup treats an unavailable key or failed authentication as a miss only
for an explicit new request; authorized old-run reads report safe content expiry
and never regenerate. No dual-key plaintext cache or implicit re-encryption is
introduced. AI-C17 supplies the [operator rotation and cleanup runbook](ai-operations.md).

Protected [HTTP/SSE delivery](ai-http.md) uses `Cache-Control: no-store` from C09. Application
result caching does not authorize CDN, service-worker or browser response caching.
Provider prompt caching remains a separate metered adapter mechanism for C16.

Prepared PostgreSQL tests cover concurrent hits, settlement/capacity eviction and
an actual cache FK write failure isolated by savepoint. They are
**UNRUN (deferred by user — until Version 1 implementation is complete)**; source
and in-memory tests do not establish database atomicity. Browser/SSE acceptance is
**UNRUN (deferred by user)**. Live calls are
**UNRUN (requires separately authorized operator budget and reviewed inputs)**.
