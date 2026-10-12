# Local AI project context prompt — October 5, 2026

The AI generation panel now provides Copy prompt for local AI and View prompt.
Users paste the instructions into an AI tool opened in their project folder,
review its generated archboard.project-context.json, then use the existing JSON
file upload and request review flow. Copying the static prompt makes no API call
and requires no cloud AI availability. Clipboard denial expands a read-only
textarea for manual copying.

The instructions describe the existing project context contract, allowed categories,
references, evidence paths/line ranges, and limits imported from shared contracts.
They distinguish verified implementation from unknowns and exclude secret files
and sensitive content. The example is illustrative, not repository facts. The local
tool needs access to the user's project; Archboard does not scan folders itself.

Validation:

- PASS: Node test parses the actual embedded JSON through parseProjectContextFile.
- PASS: focused ESLint and Prettier checks.
- PASS: frontend and frontend Node-test TypeScript checks.
- Browser copy, clipboard denial, narrow-panel layout, and upload/generation flow:
  **UNRUN (deferred by user)**.
- Database-backed runtime verification:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.

No browser, database, or release acceptance gate is closed by these checks.

## JSON mode follow-up

The local AI prompt card now appears only inside JSON file mode. Context mode tabs
precede their inputs. JSON mode labels the text field Diagram instructions (optional)
and lets users review an uploaded file with blank or whitespace-only instructions.
The reviewed request then includes a visible default instruction to diagram the
supplied architecture without inventing unsupported components or connections.
Explicit instructions are preserved; prompt-only mode still requires a prompt.

- PASS: focused review-session and local-context-prompt Node suites, 29 tests.
- PASS: focused ESLint and Prettier formatting.
- PASS: frontend and frontend Node-test TypeScript checks for the follow-up.
- Browser mode switching, file upload, optional instructions, and request review:
  **UNRUN (deferred by user)**.
- Database-backed generation verification:
  **UNRUN (deferred by user — until Version 1 implementation is complete)**.
