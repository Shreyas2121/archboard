# Portfolio walkthrough

This is a prepared script, not a recording or acceptance claim. Use synthetic
content and record the actual source revision/environment when capturing results.
No hosted URL, screenshots, benchmarks, uptime or adoption figures were fabricated.

## Five-minute local demonstration

Follow [demo setup](setup.md#local-demo-without-a-database). Export existing work
before resetting the demo to its initial Web application diagram.

| Time      | Action and explanation                                                                                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:45 | Open Web application. Explain browser/API/cache/database and the four request steps.                                                                                                               |
| 0:45–1:45 | Edit a title and description, add/connect a card, adjust layout; show inspector and keyboard connection controls.                                                                                  |
| 1:45–2:30 | Undo a supported text/geometry edit. Delete then explicitly restore an object; explain fresh IDs and restoration until reload. Reload after local saving completes and describe the actual result. |
| 2:30–3:30 | Present four steps with Left/Right/Escape; show highlights, notes and inert code/schema text.                                                                                                      |
| 3:30–4:15 | Export editable JSON and an SVG/PNG. Explain portability and independent copies of browser data.                                                                                                   |
| 4:15–5:00 | Show the README architecture diagram; explain Y.Doc ownership, transient UI state and the optional durable server path. State unverified boundaries.                                               |

After the flows work, capture overview, inspector/code card, presentation and
exported-image screenshots. Avoid secrets, private diagrams, account identities and
invitation paths. Describe collaboration separately until you actually demonstrate it.

## Optional server walkthrough

Use a real configured API/database, two independent signed-in profiles and a disposable
synthetic owner/editor board. Database execution is **UNRUN (deferred by user — until
Version 1 implementation is complete)**; browser execution is **UNRUN (deferred by
user)**. P8-09 does not resume either pause. Vite development alone does not prove
service-worker offline reload.

1. Create Web application, invite the second account as editor and demonstrate
   independent text edits converging. Explain local, pending and server-acknowledged states.
2. Cache the board in both profiles. Disconnect one, edit and reload offline in a
   supported controlling-worker setup. Edit independently online in the other.
   Reconnect; observe convergence and an empty queue rather than claiming it from mocks.
3. Exercise delete-versus-edit, explicit fresh-ID restoration, immutable checkpoint
   reopening and restore-as-new. Verify the original and new private board differ.
4. Present four steps, explicitly follow from the other profile, return to local
   view, and export JSON/image artifacts.
5. Show a viewer denied graph editing. Explain API/WS authority independently of
   hidden controls. Demonstrate lost-ACK retry only in a verified disposable harness:
   the same update ID/exact bytes must return the original receipt/sequence.

P8-07's prepared Linux/test-DB process harness covers literal pre/post-commit death
and exact retries; see [operations](phase-8-operations.md). Never crash the database
holding your actual diagrams to make a portfolio clip.

## Prepared AI recruiter walkthrough

This extends the server walkthrough when database/browser verification is resumed
and a finite live-provider evaluation budget is separately authorized. It is not
part of the database-free demo. Until then, show the source, synthetic input and
[fixture evidence](evidence/ai/AI-C18.md), labeling them as fixture proof rather
than a rendered or live-model demonstration.

1. Open a disposable signed-in owner/editor board. Show the operator-owned model,
   limits and spending controls by describing the configuration; never show keys
   or private settings. Explain browser → Archboard API → OpenAI, and that no
   repository or links are scanned.
2. Load [the synthetic three-component context](examples/three-component.archboard-context.json).
   Review the complete prompt/context and its explicit unknowns. Generate only
   within the approved evaluation budget. Show supplied facts versus assumptions,
   clarification questions and an isolated diagram preview before additive Apply.
3. Apply and observe the actual normal save/ACK status. Explain that structural
   additions are excluded from Undo; inspect or remove unwanted objects explicitly.
   Demonstrate normal Undo on a later supported field edit, without implying a refund.
4. Select the three cards/connections, review **Explain selection** or **Trace
   request flow** input/history, and show private highlights. Review a scoped-edit
   diff; demonstrate a stale field blocking Apply only in the controlled harness.
5. Choose **Recruiter walkthrough**, review **Append steps** input, then the ordered
   talking points/references and Apply. Start normal presentation and explain the
   declared request flow and unknowns. Demonstrate replacement only after reviewing
   all existing steps and its expanded input.
6. Explain fixed result expiry, private exact reuse, unknown cost and disabled
   offline generation. Record actual outcomes, revision and environment; no fixture
   result establishes savings, accuracy, retention at OpenAI or production readiness.

Keep every example synthetic, omit account/run IDs, private content and invitation
paths, and stop at the approved budget. See [usage](using-ai.md),
[operations](ai-operations.md) and [acceptance inventory](ai-verification.md).

## Engineering discussion

| Building block          | Library contribution                         | Archboard contribution                                                                                    |
| ----------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| React Flow              | Canvas rendering and interaction             | Card/edge/boundary semantics, inspector, command adapters, accessible controls                            |
| Yjs                     | CRDT updates, shared text and merging        | Schema/limits, tombstones, immutable references, causal validation, fresh-ID restoration                  |
| IndexedDB               | Browser storage                              | Atomic update/outbox insertion, account namespaces, writer ownership, recovery fences                     |
| Nest/TypeORM/PostgreSQL | HTTP/DI, mappings, transactions, persistence | Current authority, isolated validation, ordered commits, retained receipts and checkpoint/access ordering |
| Better Auth             | Sessions and OAuth                           | App configuration, current role/session checks and origin/cookie/privacy boundaries                       |

Discuss these tradeoffs: one writer simplifies room ownership/order but limits
scaling; worker validation bounds untrusted work but requires queue/timeout handling;
preserving uncertainty complicates UX but protects edits; JSON portability excludes
server metadata and full server recovery needs a database backup.

Excluded features include general canvas automatic layout, mobile editing,
organizations, arbitrary file uploads, rich HTML and anonymous public boards.
AI now provides proposal-only local layout, one reviewed context JSON input and
the workflows above; repository scanning, Claude and real provider switching are
unimplemented. Known gaps include unfinished scheduled
backup tooling and current integrated database/browser/performance proof. Historical
performance failures remain recorded; prepared fixtures and passing builds do not
prove improved frame rate or collaboration latency.
