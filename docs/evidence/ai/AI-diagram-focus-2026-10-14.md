# Diagram focus for project-context JSON — October 14, 2026

The JSON workflow now offers a Diagram focus selector before copying the local AI
prompt. System overview is the default. The selected view guides local extraction
and is carried into the reviewed cloud diagram request.

| View                 | Included detail                                                            |
| -------------------- | -------------------------------------------------------------------------- |
| System overview      | Applications, services, storage and principal integrations                 |
| API / request flow   | Supported entry points, authentication, service calls and responses        |
| Database / data flow | Stores, meaningful domain entities, relationships and readers/writers      |
| Internal modules     | Responsibilities and dependencies within application boundaries            |
| Deployment           | Hosts, containers and infrastructure supported by checked-in configuration |

## Behavior and compatibility

- The existing optional instructions box appears before the copy action in JSON
  mode and refines both the local prompt and cloud request. No separate custom
  instruction state or input was introduced.
- Extraction asks for source relevant to the selected view, concise responsibilities,
  and only essential evidence. Twelve components/ten excerpts are suggested targets,
  never fabricated minimums or new hard schema limits.
- One version-1 JSON contract is retained. Optional `diagramFocus` metadata accepts
  `overview`, `api`, `database`, `modules`, or `deployment`. All former required fields,
  collection/reference validation, byte budgets and secret-handling instructions remain.
- Uploaded focused files automatically restore their focus. A legacy file without
  metadata keeps the user's selection; a new session defaults to overview. Parsing
  legacy files does not insert metadata or mutate the uploaded object.
- The reviewed request contains the selected focus and its generation instructions.
  Changing focus invalidates an unsubmitted review. Once submitted, its serialized
  body/key remain immutable for exact recovery. Focus participates in existing
  private result fingerprints and receipt hashes.
- All uploaded components/evidence remain in the reviewed context. Changing a
  dropdown after upload does not prune content or reduce transmitted bytes. The UI
  explains that smaller requests require focused extraction before upload.
- Maximum custom-instruction length reserves room for the focus prefix within the
  existing 8,000-character prompt limit. Prompt-only/guided-context modes keep their
  existing behavior.
- Database focus uses the shared component/connection format for data flow and
  meaningful entities. Detailed table/column/PK/FK ERDs need a separate future contract.
- The selector reuses the existing shadcn Select, label and disabled-state conventions.
  Copy feedback is tied to the exact prompt copied so a later focus/instruction edit
  does not leave a stale success notice. Focus is private session state outside Y.Doc.

No database migration, dependency, provider/model setting, monetary ceiling or
environment change is required by this task. Prior uncommitted fixes are preserved.

## Verification

| Check                                                    | Result                                                                |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| Shared AI contract Node suite                            | PASS — 48 tests                                                       |
| Frontend AI Node suites                                  | PASS — 117 tests across 9 files                                       |
| API AI unit suites                                       | PASS — 294 tests across 18 suites; mocked transports/persistence only |
| Workspace typecheck, including Node verification sources | PASS                                                                  |
| Focused ESLint and Prettier                              | PASS                                                                  |
| Dependency boundaries and negative fixtures              | PASS                                                                  |
| Production frontend/API/shared builds                    | PASS; HTTPS/WSS test origins used for the production frontend CSP     |
| Static layout-worker/CSP/precache asset check            | PASS; no browser/worker runtime started                               |
| Diff whitespace                                          | PASS                                                                  |

The production build used the previously authorized execution outside the sandbox
to read the installed minifier dependency. No live OpenAI call was made.

Browser selection/keyboard/clipboard/visual acceptance: **UNRUN (deferred by user)**.
Database-backed HTTP/auth/session/socket tests, PostgreSQL/Neon integration, and
schema/migration verification: **UNRUN (deferred by user — until Version 1
implementation is complete)**. Live model quality and extraction-size reduction:
**UNRUN**. Browser/database acceptance and release gates remain **OPEN**; historical
evidence is unchanged.
