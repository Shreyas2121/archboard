# AI request review UI — October 5, 2026

The generation sidebar now shows a compact project summary instead of the entire
project context and expanded JSON. View full request opens the existing shadcn
Dialog with human-readable context and an optional View request JSON disclosure.
The same dialog replaces inline JSON in selection guidance. Dialog content,
context rows, and sidebar actions constrain their width and support wrapped text.

The availability check now sits inside the generation review beside Generate.
A disabled Generate action has a nearby status explanation. Submission displays
a spinner and live progress text; a pending run displays Generating diagram.
Submission errors appear immediately under the action instead of only above the
review. Generation still requires explicit availability confirmation and keeps
the existing identity, permission, authentication, and idempotency boundaries.

The supplied screenshot appears to show a disabled action; live button state and
network dispatch were not inspected under the browser verification pause.

Verification:

- PASS: review-session and session-hook Node suites, 34 tests. The added case
  checks immediate busy/submitting state while authentication and creation wait,
  ignores duplicate generation, and transitions to the known result.
- PASS: focused ESLint and Prettier formatting.
- PASS: frontend and frontend Node-test TypeScript checks.
- Browser layout, dialog keyboard/focus behavior, availability interaction, and
  generation progress: **UNRUN (deferred by user)**.
- Database-backed authentication/generation/runtime verification:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.

Browser, database, and release acceptance gates remain OPEN.
