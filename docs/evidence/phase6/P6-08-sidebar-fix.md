# P6-08 sidebar layout correction

Date: 2026-10-01. Parent: `1bebb67f9f44a6bc846b71c082bfb8a46079acf1`.
The user's screenshots show the Properties tab stretching vertically beside its
content, with squeezed fields and overlapping action buttons.

The generated Tabs styles used `data-horizontal`, `data-vertical` and `data-active`
selectors. Installed Radix emits `data-orientation` and `data-state` instead. Updated
the primitive's orientation, tab-list dimensions and active-tab styles to match those
attributes, and forwarded the orientation prop to Radix for matching keyboard behavior.
Horizontal tabs now request a column layout with the tab bar above their content.

Added minimum-width constraints and horizontal overflow containment to the inspector.
Object action buttons allow wrapped labels and grow vertically within their existing
two-column grid. Discussion draft mounting and local-demo behavior are retained.
No dependency, graph, API or database changes.

Verification:

- Database-free Node server rendering of the actual Tabs wrapper and installed
  Radix primitives — **PASS** in horizontal and vertical orientations. The markup
  emits the orientation and active-state attributes targeted by the updated classes.
  This verifies attribute compatibility, not browser layout.
- `pnpm.cmd --filter @archboard/web build` — **PASS**, including TypeScript;
  inherited large-chunk warning remains.
- `pnpm.cmd lint` — **PASS**.
- Focused Prettier write/check and `git diff --check` — **PASS**.
- Rendered sidebar layout, selected/unselected states, scrolling, tab keyboard use,
  zoom and action-button wrapping — **UNRUN (deferred by user)**. No browser launched.
- Database checks — **UNRUN (deferred by user — until Version 1 implementation is complete)**.

P6-08/Phase 6 acceptance remains **OPEN**. Original P6-08 evidence remains historical.
