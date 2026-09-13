# C03 fix — Bound base64 before lexical validation

Introduced by: C03 (`a4723838873ec0007be8488f6186df03e009ca5a`)<br>
Environment: Windows, Node.js 22.23.2, pnpm 11.24.0

## Violated invariant

The one-over-limit snapshot fixture caused the canonical-base64 regular-expression validator to
overflow its call stack instead of returning a bounded validation failure.

## Smallest correction

The shared base64 schema now checks encoded length and calculated decoded size before bounded,
linear lexical and padding-bit validation. A 10 MiB-plus-one snapshot regression test proves
rejection returns normally, including when the one-over payload has the same encoded length as the
maximum valid payload.

## Commands and results

- `pnpm --filter @archboard/contracts test` — PASS; 61 tests passed.
- `pnpm lint` — PASS.
- `pnpm typecheck` — PASS.

## Downstream impact

C04 limit fixtures and later C09/C13 transport validation receive a stable rejection rather than a
validator exception. No limits or wire fields changed.
