# AI generation and recovery audit — October 12, 2026

Request: investigate intermittent generation, the supplied recovery screenshot,
and poor diagrams produced from `archboard.project-context.json`. The intended
workflow remains local repository inspection by the user's AI tool, reviewed JSON
upload, cloud generation, preview, and explicit Apply or new-board creation.

## Findings and corrections

### Reopened-board edits had a missing CRDT dependency

`createGraphDocument()` wrote schema metadata using the active document's client
ID before persistence/update observers attached. On reopening an existing board,
that initialization record was local only. The first new card or text edit used
the same client's next clock and depended on the missing initialization record.
Applying just the persisted edit to a peer left it unapplied; server causal
validation can reject this as `CAUSAL_GAP`, leading to the recovery panel.

Two database-free regression cases failed before the fix: first card creation and
first text edit after hydration. Both now synchronize by incremental updates alone.
Schema metadata is seeded through a separate, immediately destroyed document,
leaving the active editing client free to emit its first independent update.
Graph roots, schema version, durable mutation commands, and server validation remain
the existing contracts. No cached records or pending changes are deleted or rewritten.

This reproduces a real cause matching intermittent recovery, but does not establish
the exact error in the user's screenshot: its underlying error code and timing were
not supplied. The recovery panel now exposes the existing safe error code/diagnostic
and distinguishes a server merge failure from a local storage-open failure.

Already queued edits made by older code can retain their missing dependencies.
For an already blocked board, download the in-memory recovery and import that
portable file as a new private board. Preserve the recovery file before leaving
or changing the old board's local state.

### Diagram generation lacked a focused output contract and instructions

The diagram request previously supplied the union of diagrams, guidance, edits,
presentations, and clarification. It had general security/provenance instructions
but no diagram-specific guidance about readable labels, meaningful groups,
duplicate flows, or keeping caveats outside cards.

Diagram tasks now request only diagrams or clarification. For equivalent draft-7
rendering, the output schema shrank from 17,242 to 5,397 UTF-8 bytes (about 69%).
The prompt now asks for short titles, responsibility sentences and edge labels,
meaningful application boundaries, consistent categories, and concise commentary.
Unknowns/constraints stay in commentary unless explicitly requested as cards; default
diagram generation does not add a presentation. The task name `propose-design` does
not grant permission to redesign a request for existing architecture. The prompt
version was bumped to invalidate reuse of results generated under the old instructions.

Incomplete terminal responses retain their known usage settlement and expose only
the safe public reason `incomplete`. The UI explains that no partial proposal was
applied and suggests a smaller view or an operator review of the output limit.
There is no automatic paid retry for incomplete output.

### The supplied context was valid but represented only a broad overview

The supplied JSON passes the actual context parser: 3 components, 3 connections,
2 groups, 14 evidence entries, and 4 unknowns. Its components are the frontend,
the complete backend, and PostgreSQL. Rich backend responsibilities appear in
descriptions/evidence, but the topology has no separate internal modules or flows.
The copied extraction prompt emphasized applications/services/storage and did not
explicitly request internal module detail. A three-component overview is therefore
an expected interpretation, even when the repository has a modular monolith.

The local extraction prompt now asks for supported internal responsibilities and
flows, focused evidence, and application/deployment groups. Roughly 8–20 meaningful
components is a suggested readability target when source supports it, never an
instruction to invent services. It explicitly distinguishes internal modules from
independently deployed services. Uploaded files now show component/connection counts
and explain how to obtain a more detailed context.

Regenerate the file in the original Workforce Operations repository using the
updated “Copy prompt for local AI” action. This workspace contains the supplied
context file, not that project's source, so the audit does not invent or independently
verify missing architecture. The supplied file was left unchanged.

### Layout ignored groups and long titles

The worker previously received nodes/edges only; boundaries were drawn afterward
around whatever nodes the unconstrained layout happened to place. Unrelated cards
could fall within those rectangles. Every component also received the same width.

Layout now receives bounded group membership along with topology and locally computed
sizes. ELK places disjoint groups as compound children; flattening adds parent offsets
back into final absolute positions. Grid fallback also keeps groups together on
separate rows. Overlapping semantic groups remain visual boundaries and are not
assigned multiple ELK parents. Longer component titles get bounded wider cards, with
the exact same sizes used in the engine, preflight, preview and applied graph.
Text, prompts, evidence and application IDs still stay outside the worker boundary.

Node tests run the pinned ELK engine and assert that unrelated cards remain outside
a supplied boundary in both engine and fallback layouts. Browser visual acceptance
is deferred, so improved prompts and geometry are not a live model-quality claim.

### Local configuration was valid, with restrictive generation caps

The actual `.env` and `.env.local` were parsed without printing secret values.
The real configuration validates, selects `gpt-5.4-mini`, and has a provider key set.
The key in `.env.txt` is intentionally blank. Neither the key nor its value is copied
into this evidence. The dev/start environment-loading paths do not load `.env.txt`.

With the supplied file and the updated default instructions, conservative admission
counts 22,442 rendered UTF-8 bytes as an input-token upper bound. This is **not** a
native token measurement. The old profile's 12,000 input ceiling cannot admit that
request in metered modes; default development mode bypasses this input guard.
The old 3,000 output ceiling can also be insufficient for detailed diagram JSON.
The provider's output-token cap includes visible output and reasoning; exhaustion
can produce an incomplete response. See the [official OpenAI reasoning guide](https://developers.openai.com/api/docs/guides/reasoning)
and [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).

The local `.env` and redacted `.env.txt` now retain the selected model, pricing,
keys and monetary ceilings, with these targeted changes:

| Setting                       | Before         | After         |
| ----------------------------- | -------------- | ------------- |
| `AI_CONFIG_VERSION`           | `v1`           | `v2-diagrams` |
| Profile `maximumInputTokens`  | 12,000         | 60,000        |
| Profile `maximumOutputTokens` | 3,000          | 8,000         |
| `AI_PROVIDER_INPUT_TPM`       | Default 60,000 | 180,000       |
| `AI_PROVIDER_OUTPUT_TPM`      | Default 10,000 | 24,000        |

The application token ceilings accommodate the reserved initial attempt, repair,
and definitive-rejection retry in metered modes. They do not establish the actual
provider account's quota. Higher output caps permit larger billable generations;
development usage is already unmetered by this application's policy. No paid live
generation was executed during this audit. Restart the API to load the changed
operator profile and refresh the frontend to use the new extraction prompt/code.

## Verification

All runtime checks below use Node fixtures/mocks and never start a browser or connect
to PostgreSQL/Neon. Mocked persistence tests do not prove database transactions.

- PASS: document-model Node suite — 93 tests, including both previously failing reopen cases.
- PASS: sync-client writer, persistence queue and ordered transport Node suites — 26 tests.
- PASS: frontend AI/layout/editor/status Node suites — 119 tests.
- PASS: shared AI contract Node suite — 47 tests.
- PASS: API AI unit suites — 292 existing tests; the added incomplete-response case
  and its coordinator suite pass after correcting a fixture event name (20 tests).
- PASS: API Yjs compatibility unit suite — 6 tests.
- PASS: workspace typecheck, focused lint and formatting, dependency boundary check,
  and diff whitespace check.
- PASS: shared packages/API builds and production frontend build. Local HTTP/WS
  environment values are not valid production CSP origins; production compilation
  used temporary `https://api.example.test` / `wss://api.example.test` overrides.
  The sandbox denied reads of the installed Terser dependency; the authorized build
  outside the sandbox passed, including service-worker generation. An offline frozen
  install reported everything up to date and changed no dependency manifests/lockfile.
- PASS: static layout-worker asset scan — both emitted workers are isolated,
  size-bounded, referenced, compatible with the CSP and precached. No worker/browser
  runtime was launched by this scan.
- Full-workspace `pnpm lint` is blocked by 8 existing lint errors in ignored temporary
  browser/probe scripts. Changed source/test files pass focused ESLint; the audit
  does not edit or remove the pre-existing scripts.
- Browser checks: **UNRUN (deferred by user)**.
- Database-backed integration/auth/session/socket tests and schema/migration checks:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
- Live OpenAI transport/account access and generated visual quality: **UNRUN**.

Browser/database acceptance and all applicable release gates remain **OPEN**.
Historical evidence is unchanged.
