# AI diagram readability — October 14, 2026

The supplied database-focused context contains 11 components, 22 directed
connections and four groups. Its schema is valid. Nine connections repeat the
database-to-entity persistence relationship in addition to the domain relationships.
The uploaded file was read without modifying it.

Input SHA-256:
`3422556f5eb4f0eee212a5614a701dfd777b77a5946f527b7048210a524bc249`.

## Causes and changes

- Compound ELK groups used their own default spacing, leaving some cards only
  20 pixels apart despite the outer layout's spacing settings. Apply the layered
  options to every compound group, with 220-pixel layer corridors and 100-pixel
  spacing between cards. Generated component cards now start at 360 × 180 pixels;
  long titles can still increase width to the existing 460-pixel ceiling.
- Node placement did not control React Flow's subsequent connection paths. Add
  derived orthogonal routing around card rectangles and boundary headings, with
  bounded search and a cheap fallback for large graphs. Narrow existing corridors
  and top-facing ports support shorter initial segments. Routes remain outside
  the document and never modify positions, handles, labels or relationships.
- Previous edge captions concatenated label and protocol into one unbounded line.
  Captions now wrap at word boundaries into at most two lines and avoid cards,
  boundary headings and previously placed captions. Full label/protocol remain in
  the native SVG title, accessible edge name and existing inspector. If no clear
  caption rectangle exists, omit its visible caption without removing the edge.
- Reuse the same route/caption geometry in the main canvas, isolated AI preview and
  controlled SVG export. Export and canvas bounds include routed paths/captions.
  React Flow retains interaction paths, selection, marker direction, dashed lines
  and reconnection. During a transient drag, stale routes use the normal path until
  document geometry catches up.
- Component cards reserve separate title, description and technology rows. Taller
  cards wrap titles and technology names; descriptions retain a bounded area.
  Controlled SVG component text also reserves header/body/footer space.
  Truncation ellipses stay inside the affected text row instead of overlaying the footer.
- Database extraction and generation instructions prioritize meaningful entity
  relationships and summarize repetitive storage membership in groups, technology
  labels or commentary unless individual access flows are requested. Existing
  graph content is not automatically pruned.

Routing is cached by geometry, endpoints and captions. Editing unrelated card text
does not invalidate edge identities. Moving/resizing cards or changing endpoints,
captions or boundary geometry invalidates the derived layout.

## Offline check using the supplied JSON

A disposable Node probe validated the shared context schema, mapped all supplied
components/connections/groups directly into a proposal, ran the installed ELK
engine and the application's mapping/routing/export functions, and checked numeric
geometry. It did not invoke a provider or execute source excerpts. The probe was
removed after verification; a permanent synthetic regression keeps the same
11-component/22-connection/four-group topology without depending on mutable user
content.

Results:

- All 22 connections found routes; no route segment intersected a card interior.
- Eighteen captions fit without card or caption-to-caption overlap. Four visible
  captions were omitted because no clear placement was found; all original text
  and connections were retained.
- Controlled SVG bounds: 4,204 × 918 pixels, including padding and routed geometry.
- [Offline SVG artifact](AI-diagram-readability-2026-10-14.svg). This derives directly
  from the JSON and is not a live AI output, browser screenshot or browser acceptance
  result. Wire crossings can remain in dense graphs; the router does not claim
  globally optimal or crossing-free routing.

The larger sizes and compound spacing apply to freshly prepared diagrams. Existing
boards receive the renderer improvements while retaining their saved card sizes
and positions. Regenerate/reprepare a diagram to receive the new initial layout.

## Verification

| Check                                                       | Result                                                            |
| ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Frontend Node suites plus disposable supplied-context probe | PASS — 227 tests across 31 files (226 permanent tests, one probe) |
| Export Node suites                                          | PASS — 26 tests across three files                                |
| API prompt-renderer unit suite                              | PASS — 11 tests; no database/provider transport                   |
| Workspace typecheck, including Node verification sources    | PASS                                                              |
| Production frontend/shared builds and API pretest build     | PASS                                                              |
| Focused ESLint and Prettier                                 | PASS                                                              |
| Dependency boundaries and negative fixtures                 | PASS                                                              |
| Static layout-worker/CSP/precache asset scan                | PASS                                                              |
| Public asset secret scan                                    | PASS — 356 files; values are not printed                          |
| Diff whitespace                                             | PASS                                                              |

Relevant commands:

```text
pnpm.cmd --filter @archboard/export build
pnpm.cmd exec vitest run                                      # cwd packages/export
pnpm.cmd exec vitest run --config scripts/web-node/vitest.config.ts
pnpm.cmd --filter @archboard/api test --runInBand --testPathPatterns modules/ai/application/prompt-renderer.spec.ts
pnpm.cmd typecheck
pnpm.cmd boundary:check
pnpm.cmd --filter @archboard/web build                        # HTTPS/WSS test origins
node scripts/check-ai-layout-assets.mjs
```

The production build used approved execution outside the sandbox to read its
installed minifier. Its existing large-chunk warning remains. No dependencies,
database schema, migrations, provider configuration or environment values changed
for this readability work. Earlier uncommitted recovery/focus changes remain.

Browser rendering, visual acceptance at different zoom levels, selection and
reconnection interaction, AI preview fitting and browser PNG export:
**UNRUN (deferred by user)**. Deferred commands include `pnpm test:browser` and
browser-running phase verifiers. No substitute Node check closes those gates.

Database-backed HTTP/auth/session/socket tests, PostgreSQL/Neon integration and
schema/migration checks: **UNRUN (deferred by user — until Version 1 implementation
is complete)**. Live cloud generation quality: **UNRUN**. Browser/database and
release acceptance gates remain **OPEN**.

Implementation references: React Flow's
[BaseEdge](https://reactflow.dev/api-reference/components/base-edge) and
[EdgeLabelRenderer](https://reactflow.dev/api-reference/components/edge-label-renderer),
and [ELK Layered](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html).
