# Personal use and recruiter demo feature audit

Date: 3 October 2026. Source: local `main` at `86276b9`, with pre-existing
deletions of `guide7.md` and `phase8.md`. Those deletions were left untouched.
Scope: feature implementation against `plan.md`, personal architecture diagrams,
recruiter demonstrations, and deployment prerequisites. This is a source audit,
build observation and development-server start, not rendered acceptance or a
production release assessment.

The product has the implemented feature scope needed for personal diagramming and
a recruiter demonstration. P01–P13 have application implementations and UI/API
wiring. The original plan is not entirely complete: M08 backup/restore automation
is unfinished. The personal/portfolio closure in `phase-8-closure.md` explicitly
records that smaller scope separately from the original release.

## Feature inventory

“Implemented” below describes source presence and wiring, not a newly observed
end-to-end outcome. Test and verification completion are excluded from this feature
verdict.

| Plan capability        | Implementation found                                                                                                                                       | Primary source                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| P01 Identity           | GitHub sign-in, session/current user, sign-out and pending-work handling                                                                                   | `apps/web/src/features/auth/`; API `modules/auth/`                                       |
| P02 Boards             | Create blank/template boards, list, title search, rename, duplicate, archive/restore                                                                       | Web `features/boards/`; API board service/controller/persistence                         |
| P03 Editing            | Selection, movement, resizing, connections, copy/paste, duplicate, alignment, view controls and grid preferences                                           | Web editor `canvas/`, `selection/`, `connections/`, `history/`; model commands           |
| P04 Technical content  | Component/code/schema/note cards, inspector fields and inert syntax highlighting                                                                           | Web editor `cards/`, `inspector/`                                                        |
| P05 Boundaries         | Named visual rectangles using absolute coordinates                                                                                                         | Web editor `boundaries/`; model boundary commands                                        |
| P06 Collaboration      | Durable graph synchronization, presence/cursors/selections and drag previews                                                                               | API collaboration module/gateway/room/persistence; sync-client transport; graph canvas   |
| P07 Offline            | Service worker shell, cached dashboard/boards, IndexedDB and outbox, reconnect and recovery/update handling                                                | Vite PWA configuration; sync-client persistence/locking; editor session; platform update |
| P08 Authorization      | Owner/editor/viewer, invitations, role changes and revocation                                                                                              | Web sharing/member/invite controls; API permissions/invite service                       |
| P09 Discussion         | Anchored threads, replies, edits/deletion markers, moderation and resolve/reopen                                                                           | Web editor `discussion/`; API discussion service/controller/repository                   |
| P10 Presentation       | Step authoring, order, notes, viewport/highlights, local playback and explicit live following                                                              | Web editor `presentation/`; model steps; API presenter lease                             |
| P11 Checkpoints        | Named committed-state capture, list/inspection and restore as a new board                                                                                  | Web portability/checkpoint route; API checkpoint service/controller/repository           |
| P12 Portability        | Versioned JSON import/export and controlled SVG/PNG export with scope/background/scale controls                                                            | Web portability/download adapters; export package; API imports controller                |
| P13 Templates          | Web application, Event processing and Service boundary; fresh IDs                                                                                          | Fixtures templates, dashboard creation, demo seed and model remapping                    |
| P14 Product/operations | Keyboard paths, states, limits, recovery, documentation and single-writer deployment package present; daily backup and isolated restore tooling unfinished | Phase 8 implementation and `ops/`; `phase-8-closure.md`                                  |

The app composition and Nest module register these features; this inventory is not
based solely on directory names or old completion reports. The placeholder scan
found no explicit TODO/coming-soon/not-implemented product stubs in non-test source.
That scan does not prove the absence of subtle omissions or runtime defects.

## Practical limits for the requested use case

- `/demo` works without an API/database and stores one local diagram, initially
  seeded from Web application. Editing, presentation, recovery JSON and SVG/PNG
  export are wired there.
- Multiple named boards, other template creation, JSON import, sharing, discussion
  and checkpoints use authenticated server boards. JSON cannot be loaded back into
  `/demo`; export alone does not provide a complete local file workflow.
- Desktop is the authoring target. Narrow-screen editing is intentionally read-only.
- Undo/redo covers supported local edits. Structural actions use separate
  deleted-object restoration rather than universal undo; restoration lasts until
  reload/reset and creates fresh identifiers.
- Public anonymous board links, Mermaid import/export, automatic layout, PDF export
  and AI generation are explicitly deferred in the plan. They are not unfinished
  Version 1 features.

For sustained work on several projects, the implemented server board workflow fits
better than repeatedly resetting the demo. A local JSON open/save workflow would be
a useful optional extension if account-free, database-free authoring becomes the
preferred mode; it is not required by the existing plan.

## Running and deployment observations

- `pnpm.cmd build`: PASS, exit 0. All workspace build targets completed, including
  API, web and generated PWA assets. Vite reported a large-chunk warning.
- Development server started with
  `pnpm.cmd --filter @archboard/web dev --host 127.0.0.1 --port 5173 --strictPort`.
  A plain HTTP request to `/demo` returned 200 with the root element and module
  entry. This observes shell delivery only; it does not execute React.
- The application's own public configuration loader accepted the current
  development environment and rejected the current production environment. Values
  and credentials were not printed or changed. Build success does not catch this
  runtime configuration failure because `loadWebConfig` executes in `main.tsx`.
  Rebuild with the intended exact HTTPS API and WSS origins before deployment,
  including for a frontend-only demo.
- Static frontend hosting is possible in architecture for `/demo`: serve the built
  assets and route `/demo` to the shell with compatible security policy. Account and
  server features require the API. No host was configured or deployment performed.
- The supplied full package is `ops/Dockerfile`, `ops/compose.yaml` and Caddy, with
  PostgreSQL and exactly one API writer. It still needs actual hostname/TLS,
  GitHub OAuth callback/credentials, secrets and explicit database initialization.
  Normal startup does not apply migrations. Package source is present; container
  execution and hosted operation were not established by this audit.
- Automated daily backups and an isolated restore mechanism remain unfinished.
  This does not prevent a portfolio demo, but the original operational scope is
  incomplete and server data needs an independent preservation arrangement.

Browser checks: **UNRUN (deferred by user)**.
Database/auth/session/socket/schema checks: **UNRUN (deferred by user — until
Version 1 implementation is complete)**. No tests, database probes, migration
commands or browser sessions were run. Existing phase/release gates and historical
evidence are unchanged.

## Verdict

Personal diagramming and recruiter demonstration: sufficient implemented feature
scope, with the local-demo/server-board distinction above. Original `plan.md`
completion: no, because operational deliverables remain unfinished. Deployment:
the source has a deployment path, but current artifacts need production origin
configuration and the selected hosting setup before being usable there.
