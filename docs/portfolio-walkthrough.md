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

Excluded features include automatic layout, mobile editing, organizations, uploads,
rich HTML, anonymous public boards and AI. Known gaps include unfinished scheduled
backup tooling and current integrated database/browser/performance proof. Historical
performance failures remain recorded; prepared fixtures and passing builds do not
prove improved frame rate or collaboration latency.
