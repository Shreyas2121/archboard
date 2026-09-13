# C02 fix — Enforce specified WebSocket timing defaults

Introduced by: C02 (`65d637465feb38b1ce6438f4ccb62b05879c751a`)<br>
Environment: Windows, Node.js 22.23.2, pnpm 11.24.0

## Violated invariant

`plan.md` requires a five-second handshake deadline, ping/pong every 15 seconds, and disconnect
after 45 seconds without pong. C02 initially defined 10-second, 30-second, and 10-second values.

## Smallest correction

The three named defaults now match the governing contract, and the API configuration suite asserts
their exact values to prevent drift.

## Commands and results

- `pnpm test --filter config` — PASS; API and web configuration suites pass.
- `pnpm lint` — PASS.
- `pnpm typecheck` — PASS.

## Downstream impact

C03 and later WebSocket work consume the corrected named values. No transport behavior was added.
