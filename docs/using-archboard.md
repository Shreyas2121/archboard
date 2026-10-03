# Using Archboard

This guide describes implemented behavior; integrated browser/database proof remains
deferred. Use desktop editing. Narrow screens support reading/presenting and may
make editing read-only. `/demo` is local; sign in and use `/boards` for server boards.
Keep credentials out of diagram content.

## Editing and presentation

The local demo starts with Web application. When creating a private server board
online, choose Web application, Event processing or Service boundary. Edit cards using
the inspector. Components describe responsibilities; code, schema and note cards
document contracts. Snippets are inert text. Group systems with boundaries and
connect fixed handles through canvas gestures or keyboard-accessible controls.
Object navigation supplies a selection path without relying on pointer gestures.

Undo/redo apply to supported local edits; structural commands are excluded from
Undo. Use the explicit deleted-object restoration action, available until reload,
to create fresh IDs while retaining original tombstones. Review large-delete
confirmations. Restoration does not resurrect old IDs or references.

Order presentation steps, notes and highlights to explain a flow. The Web application
template has four request steps. Left/Right advances presentation; Escape exits.
Step ordering has keyboard alternatives. Following another presenter is explicit;
local navigation can return to your own view. Server checkpoints capture committed
content and are immutable. Restore creates a new private board with fresh IDs;
it does not overwrite the original. Server actions require current authority and
connectivity.

## Saving, offline and recovery

| State/storage                   | Meaning                                                                    |
| ------------------------------- | -------------------------------------------------------------------------- |
| Saved on device / local diagram | IndexedDB has local state; no server durability is implied                 |
| Pending / offline               | Durable board updates still await acknowledgement                          |
| Server-saved                    | PostgreSQL committed the update and the server acknowledged its receipt    |
| Read-only / access unavailable  | Role, archive, account, storage or local writer ownership prevents editing |
| Cached metadata/discussion      | A previously downloaded view, with stale/fetch-time context                |

An already cached eligible board can preserve local edits during disconnection and
retry queued updates after reconnecting. An uncached server board needs the network.
Offline access does not permit board creation, invitation acceptance, membership
changes, comments or checkpoint capture. Revocation/archive/session expiry can
block uploads; preserve JSON rather than forcing retries or clearing storage.

Local storage is deployment/account/board scoped. Another tab can own local writing
and leave this tab read-only. Switching accounts does not transfer pending bytes.
Recovery, sign-out and worker-update prompts require deliberate preservation choices.
Deleting/resetting local state is destructive, not a generic repair. Actual combined
storage/account/worker/browser recovery acceptance remains pending.

Discussion drafts are memory-only and can be lost on navigation/reload. Conflicts
retain unsent text for review before explicit retry. Uncertain REST creation or
invitation acceptance requires checking visible results and deliberately retrying
the same intent while its key is valid. Reconnect never auto-submits these operations.
After the conservative 23-hour intent window, review existing results and duplicate
risk before a new submission. Graph outbox retry and REST intent recovery differ.

## Exports and preserving personal diagrams

Export complete JSON to a private folder alongside your other project's source.
Keep useful architecture versions. Import from Your boards requires signing in
online; it validates the whole file and creates a new private server board with
remapped IDs. It does not merge into the current graph or load a file into `/demo`.

SVG/PNG are visual artifacts, not editable backups. Choose scope/background and
1×/2× output deliberately. The image pipeline controls resources and does not run
user HTML.

| Limit               | Current contract                                |
| ------------------- | ----------------------------------------------- |
| Live graph          | 500 nodes, 1,000 edges, 50 boundaries, 50 steps |
| Encoded Yjs state   | 10 MiB including hidden/tombstoned history      |
| JSON import         | 5 MiB UTF-8                                     |
| PNG                 | 8,192 pixels/side; 32 megapixels                |
| Server checkpoints  | 100/board                                       |
| Active owned boards | 100/user                                        |

Recovery JSON remains complete above the import cap and warns that it cannot be
imported unchanged. Never silently trim it. Diagram JSON excludes server accounts,
membership, invitations, discussion and durable retry receipts. Browser caches and
checkpoints in the same database are not independent server backups.

P8-08 scheduled backup/isolated restore tooling is unfinished and deferred. If you
depend on server boards, arrange a manual PostgreSQL-consistent backup to a protected
location outside the repository and validate restoration into a separate empty
database before trusting it. Do not copy a running volume as a logical backup,
overwrite the source or put dumps in public assets. No successful backup, daily
schedule, measured restore duration or recovery guarantee is claimed here.
An older restore can roll back receipts, sessions and permissions while clients
retain newer pending bytes. Preserve exports and review uncertainty before reconnect;
local bytes do not become server-saved because they survive in the browser.

## Keyboard

Tab/Shift+Tab traverse controls; Enter/Space activate them. Outside text fields and
dialogs: F fits, +/= and - zoom the canvas, ? opens help. Undo/redo use the displayed
Ctrl/Cmd combinations. Delete/Backspace request deletion of selected objects.
Text input, IME and dialog ownership retain normal behavior. Ctrl/Cmd +/- remain
browser text zoom. Space+drag pans, Ctrl+scroll zooms, Alt bypasses relevant snapping.
Use in-app help for platform/context details. Rendered keyboard/screen-reader proof
remains deferred; source labels do not establish it.
