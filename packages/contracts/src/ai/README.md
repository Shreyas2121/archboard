# Shared AI contracts, version 1

Import schemas, types, and limits through `@archboard/contracts`. These contracts
depend only on Zod and existing shared contracts. SDK types, provider configuration,
credentials, pricing authority, and HTTP controller behavior belong on the server.

| Contract                                                                                     | Purpose                                                                                     |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `projectContextV1Schema` / `ProjectContextV1`                                                | Strict project description; omitted input collections normalize to empty arrays             |
| `parseProjectContextFile`                                                                    | Enforce raw UTF-8 file bytes before parsing JSON and validating the normalized context      |
| `aiCreateRunSchema` / `AiCreateRun`                                                          | Versioned task, target, exact prompt, optional reviewed context and bounded private history |
| `aiBoardContextSchema`                                                                       | Selected graph, unique logical node bindings, and nullable confirmed server sequence        |
| `aiResultSchema` / `AiResult`                                                                | Bounded diagram, clarification, guidance, edit, or presentation result                      |
| `aiResultForRequestSchema`                                                                   | Validate task, evidence and references against the parsed reviewed request                  |
| `aiRunSchema` / `AiRun`                                                                      | Lifecycle, safe failure, cache/deduplication source, and explicit available/expired content |
| `aiRunEventSchema` / `AiRunEvent`                                                            | Versioned ordered SSE events with decimal-string sequences and bounded deltas               |
| `aiAvailabilitySchema`                                                                       | Safe feature status and allowance; unknown money/reset facts are nullable                   |
| `aiRunPathSchema`, `aiAvailabilityQuerySchema`, `aiEmptyQuerySchema`, `aiEventHeadersSchema` | Strict run UUID, optional board UUID and bounded snapshot resumption inputs                 |
| `aiTokenPreflightSchema`                                                                     | Server counting facts for rendered input and reserved output; not a client request field    |

Use `aiResultForRequestSchema(parsedRequest)` after assembling provider output and
before returning or caching it. The standalone result schema establishes structure,
size and internal diagram references; the context-bound schema additionally rejects
invented evidence/highlights, targets outside the reviewed selection, wrong-kind
property edits, and preconditions that differ from reviewed fields. Apply must still
recheck live fields and current authorization through document commands. Schema
validation cannot establish factual accuracy, permissions, model capabilities, or
durable admission.

Semantic keys start with a letter and are distinct from UUID graph IDs. Proposals
contain no generated IDs or layout geometry. Selected graph nodes retain existing
UUIDs, with explicit logical bindings for additive edge references. Scoped edits
allow typed additions, node renames, edge labels/protocols, and typed content changes
with field preconditions. Delete, endpoint/kind mutation, arbitrary patches, and
whole-document replacement are absent. Presentation array order determines step
order; application code computes rectangles from validated geometry.

Transport must reject raw bodies above `MAX_AI_REQUEST_BYTES` before parsing; the
schema also checks normalized serialized bytes. The context file limit is 1 MiB,
the encoded HTTP body ceiling is 8 MiB, the serialized result ceiling is 512 KiB,
and an event is at most 16 KiB. Escaping, whitespace and UTF-8 can change byte counts;
valid individual fields do not guarantee a request or result fits its byte ceiling.
The limits do not guarantee the input fits a model's token window. Token preflight
requires a server-owned counting version and upper bound covering instructions,
schema, selected context, history and overhead. This task supplies that contract,
not a tokenizer or estimation algorithm.

Result notices carry expiry, not a proposal payload. Clients fetch results through
the authorized status route; expired content exposes only expiry metadata. Public
failures use safe codes and optional retry delays, never raw SDK error text. Integer
micro-USD allowances and server sequences use canonical decimal strings without
numeric coercion. Text content remains untrusted and requires safe rendering and
submission review; these schemas are not secret detection or redaction tools.

The implemented [HTTP transport](../../../../docs/ai-http.md) sends authorized
snapshots and expiry notices over SSE, with no private delta replay. Snapshot IDs
are decimal update timestamps; a reconnect always reads current authority and
never generates. Provider/model/accounting details remain internal.
