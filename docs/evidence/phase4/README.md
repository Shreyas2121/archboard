# Phase 4 evidence index

Status: **OPEN**. All P4-01 through P4-12 implementation commits are present, but a completed implementation sequence is not a passing exit gate. The [Phase 4 audit](../../phase-4-collaboration.md) maps deliverables, real-boundary proof, measurements, and remaining work. P4-13 records that decision; it does not change runtime behavior.

The branch `phase-4-durable-collaboration` started from Phase 3 `main` at `353306913f59fd4470bb32463bae1a55a90f1c95`. The history is linear. The planned tasks appear in dependency order, with one focused archived-read fix between P4-02 and P4-03 and one verifier-efficiency follow-up after P4-12.

| Order               | Commit                                     | Evidence                                    | Result scope                                               |
| ------------------- | ------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------- |
| P4-01 protocol      | `c10d625c76ae105fc93fa41a6863c2780e6b54e9` | [P4-01](P4-01.md)                           | Strict shared wire contracts and limits                    |
| P4-02 rooms         | `c3b323a5afe436ac518c900da7c0c270b6d040c8` | [P4-02](P4-02.md)                           | Bounded reconstruction, singleton lock, readiness          |
| Focused fix         | `dd71d2eda76bbe7855890d6237e6f5a68b4988cf` | [Archived read](P4-02-fix-archived-read.md) | Authorized archived-board reconstruction                   |
| P4-03 gateway       | `0e16e47ef5a25b2623175a3cdb5fd29f73a26741` | [P4-03](P4-03.md)                           | Real-cookie, Origin-checked room join                      |
| P4-04 validation    | `02308692b1907d26c38a8d1a32260ba24526f9b2` | [P4-04](P4-04.md)                           | Isolated bounded candidate checks                          |
| P4-05 durability    | `23f0af4356edea2676e73922ce679144d33e2281` | [P4-05](P4-05.md)                           | Transactional sequence, receipt, ACK, broadcast            |
| P4-06 access        | `e3be5c22c0ada3e9a1640b158a66f654ca13ddb9` | [P4-06](P4-06.md)                           | Live role/archive transitions and races                    |
| P4-07 compaction    | `7c01a09a1d8de4cc006d0f89bd662415b1bf20f8` | [P4-07](P4-07.md)                           | Atomic snapshots, receipt retention, eviction              |
| P4-08 outbox        | `8d6cb9693f9aba531c3e24b315405b54e5fb7cdb` | [P4-08](P4-08.md)                           | Atomic IndexedDB outbox, inbound log, receipts             |
| P4-09 transport     | `2a848864ce880195b49cc07e55c7c2f53d95d1c4` | [P4-09](P4-09.md)                           | Ordered ready, drain, reconnect, retry                     |
| P4-10 editor        | `5343b082f40aca95ab5663737e55e5eed8b740b5` | [P4-10](P4-10.md)                           | Served authenticated editor and role states                |
| P4-11 presence      | `01792ef63560ef723960beca092d847c9dc81779` | [P4-11](P4-11.md)                           | Ephemeral presence and drag previews                       |
| P4-12 recovery/gate | `8bc6f17c7a996f612800bf4fd8972a8eaf4c9fde` | [P4-12](P4-12.md)                           | Export/reload recovery, real-boundary matrix, measurements |
| Verifier follow-up  | `fe5a3e0080ba83d2fcde3c712e0743f407d76780` | [Run guide](../../phase-4-collaboration.md) | Deduplicated routine checks and concise logs               |

Phase 4 added `@nestjs/platform-ws` and `@nestjs/websockets` at the existing Nest 12.0.1 pin, with their lockfile entries, and the forward `RetainCompactedUpdateReceipts1790426800000` migration. It did not upgrade the existing React, Yjs, Better Auth, TypeORM, or PostgreSQL driver versions. The configured root database still showed that migration as unapplied in [P4-12](P4-12.md); isolated integration schemas applied it before their tests.

The acceptance matrix and current check outcomes are in the [audit](../../phase-4-collaboration.md). Recorded blockers include a failed five-user visibility budget, unrun literal process-kill and combined socket/browser fault proofs, a pending migration in the configured root database, and dependency-boundary failures. The separate [Phase 2 audit](../../phase-2-editor.md) remains open for pan performance and missing human/browser evidence. No Phase 5 offline route shell, Phase 6 discussion/sharing UX, Phase 7 presentation/portability, or Phase 8 release is claimed.
