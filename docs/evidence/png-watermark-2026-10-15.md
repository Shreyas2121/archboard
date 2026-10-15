# PNG attribution footer

October 15, 2026. Working-tree implementation.

PNG exports now include the existing three-block Archboard mark and **Made with
Archboard** in a small badge at the bottom right. The image export dialog describes
this behavior. The footer is generated as controlled SVG before the existing PNG
adapter rasterizes it; the adapter receives the complete branded dimensions.

The renderer reserves space below all card, boundary, route and caption bounds.
It widens very narrow selections if needed and modestly scales the badge for wide
diagrams. Light/dark colors match the existing brand palette. Transparent output
retains transparency around the badge, which has its own readable background.
The footer counts toward the existing image limits and scales with 1×/2× output.
SVG downloads use the existing unbranded geometry. No graph data, persistence,
network behavior, dependency or export format was changed.

Offline controlled-SVG examples of the source passed to PNG rasterization:

- [Dark theme with background](png-watermark-2026-10-15-dark.svg).
- [Light theme with transparent surroundings](png-watermark-2026-10-15-light.svg).

Both artifacts use the synthetic all-entity fixture and measure 1064 × 936 at 1×.
They are SVG previews, not browser-rendered PNG evidence.

| Check                                                                         | Result                                                                                  |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Shared renderer/routing Node tests                                            | PASS — 22 tests across two files                                                        |
| Actual download adapter with synthetic browser ports                          | PASS — six Node lifecycle tests, including branded/unbranded sources at both PNG scales |
| Export package build and frontend/export type checks                          | PASS                                                                                    |
| Focused ESLint and Prettier                                                   | PASS                                                                                    |
| Dependency boundaries and negative fixtures                                   | PASS                                                                                    |
| Production web build, PWA generation and static layout/retired-AI asset check | PASS                                                                                    |
| Diff whitespace                                                               | PASS                                                                                    |

The geometry tests cover a dedicated footer outside all content, bounds inclusion,
negative coordinates, narrow selections, light/dark palettes, transparent page
backgrounds, source-graph preservation, controlled markup with hostile input, and
image-budget enforcement including attribution. Existing SVG geometry tests still
pass. The Node adapter tests inspect the actual SVG blob supplied to the synthetic
decoder and verify full scaled drawing dimensions and resource cleanup. They do
not prove real SVG decoding, text rendering, PNG transparency or browser downloads.

The production build used approved execution outside the sandbox to access the
installed minifier. Its existing large-chunk warning remains.

Relevant commands:

```text
pnpm.cmd --filter @archboard/export build
pnpm.cmd exec vitest run src/image-export.test.ts src/connection-layout.test.ts
                                                               # cwd packages/export
node --experimental-vm-modules --test scripts/p7-09-image-export.node.test.mjs
pnpm.cmd --filter @archboard/web typecheck
pnpm.cmd --filter @archboard/export typecheck
pnpm.cmd exec eslint <changed source/test files>
pnpm.cmd exec prettier --check <changed source/test/docs files>
pnpm.cmd boundary:check
pnpm.cmd --filter @archboard/web build                            # HTTPS/WSS test origins
node scripts/check-ai-layout-assets.mjs
git diff --check
```

Actual browser acceptance for PNG decoding/encoding/downloads, visual mark and font
rendering, transparent/opaque light/dark images, whole-diagram/selection output and
1×/2× images: **UNRUN (deferred by user)**.

Database-backed HTTP/auth/session/socket, integration and schema/migration checks:
**UNRUN (deferred by user — until Version 1 implementation is complete)**.
This change makes no database/provider requests. Browser/database and phase/release
acceptance gates remain **OPEN**.
