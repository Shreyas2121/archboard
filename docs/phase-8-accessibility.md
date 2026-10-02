# P8-03 interaction inventory and prepared A28 protocol

Source parent: `0aef5f47f7afd906d373c244396939fff0cd5958`.
Branch: `phase-8-release-hardening`. Implementation scope only; A28 and release
acceptance are **OPEN**. Rendered keyboard, spoken output, contrast and focus
observations are **UNRUN (deferred by user)**. Database-backed cases are
**UNRUN (deferred by user — until Version 1 implementation is complete)**.

## Routes and states

| Route/surface                                                        | Existing keyboard path and P8-03 integration                                                                                                                                                                                                                                      | Eventual proof                                                                                                                                                               |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home/sign-in, `/boards`, invitations                                 | Native links/buttons, GitHub sign-in, board actions and labeled creation form; existing account-transition/pending-change dialog protects local work. Board fields describe action errors.                                                                                        | Actual sign-in/return path, board creation/replay/error, invite accept/open, uncertain sign-out and account-change focus. Requires final database and browser prerequisites. |
| `/demo`                                                              | Add to board creates Component/Code/Schema/Note/Boundary through session commands. Properties → Browse objects selects any object or a group. Numeric fields, clipboard/object actions, keyboard connection, steps, local Present, image/local recovery exports remain reachable. | Full keyboard workflow, local persistence failure and reload/restore semantics, inert text and file behavior.                                                                |
| `/boards/$boardId` owner/editor                                      | Same editor paths, plus Sharing, Discussion, live presentation and Checkpoints & JSON; permission/save/pending states stay visible in text.                                                                                                                                       | Real authenticated creation/edit/connect/discussion/steps, server acknowledgment and resource limits, revocation and pending recovery.                                       |
| Viewer/archived/access-changed/session-expired                       | Object selection and read/present/export paths remain available; commands still enforce session authority. Mutation buttons are disabled with existing explanatory state text. Discussion retains its authority checks.                                                           | Attempt keyboard mutation and verify rejection/no changes; exports/recovery retain available data; distinguish archive and access/session changes.                           |
| Cached offline                                                       | Cached role policy remains authoritative for local editability. Offline/server-dependent action explanations, pending changes and full recovery export remain. No reconnect auto-submit was added.                                                                                | Both cached editor and cached viewer, local pending bytes, replay/uncertain creation and server conflict after reconnect.                                                    |
| Narrow screen                                                        | Editing remains disabled. Board panels opens the existing Properties/Steps/Discussion content in a named modal; object browsing, reading and local step playback work without desktop sidebars. Present closes the panel before playback.                                         | Narrow read/present/export, viewport reflow and text zoom; no mobile authoring.                                                                                              |
| Checkpoint view, import, JSON/image export, recovery/storage dialogs | Existing labeled controls and inert previews, semantic error/status text and Radix dialogs remain. Invalid import file describes its error. Common DialogContent preserves explicit focus policies and restores programmatic openers with a canvas fallback.                      | Actual initial/trapped/returned focus, file/download/cancel/error behavior and pending-work preservation.                                                                    |

## Implemented controls and focus policy

- Properties → **Browse objects** → **Find cards, boundaries or connections**
  searches the current projection. **Select only** selects and focuses **Selected
  object properties**; Tab reaches its first field. **Add to selection** / **Selected**
  toggles membership; **Go to selected properties** reaches group geometry.
  **Clear object selection** clears it. **Show more objects** reveals further
  batches of 50; the full board is searchable/discoverable without changing caps.
  Canvas graphics use this explicit selection path instead of React Flow's separate
  keyboard mutation behavior. The canvas itself is a focusable named region.
- Geometry has X/Y/Width/Height and **Apply geometry**, or Move X/Move Y and
  **Move selection**, plus alignment controls. Empty/non-finite numeric fields fail
  before mutation; errors are associated with fields and announced. Shared model
  bounds and session command guards still enforce the actual update.
- **Connect cards** retains source/target card and four fixed-handle choices,
  **Review connection**, **Back**, **Create connection** and **Cancel**. Missing
  endpoints and self-loops have explanatory errors. Review/error and Back transitions
  focus the corresponding heading/error/source control. Closing returns to the
  opener, or Browse objects if the selected card disappeared. Domain validation,
  role/archive restrictions and immutable connection replacement remain intact.
- **Earlier**/**Later** reorder through the existing step command, return focus
  to that step's selector and announce its new position. **Delete step** retains
  the deleted-step explanation. If a focused property/step/object control disappears
  and focus falls to body, the inspector recovers to Browse objects or the active
  panel tab. It does not steal focus from another control or an external modal.
- Object deletion returns focus to the canvas, including large-delete confirmation
  closure. Restore deleted remains available until reload/reset with fresh IDs.
  **Return to canvas** leaves desktop panels; closing narrow Board panels returns
  to its opener (or Exit presentation when playback starts). Palette/inspector
  collapse controls expose their expanded state and keep their focused button.
- Text fields keep focus after Enter commits; Tab continues in the inspector.
  Escape cancels a field draft. Composition events keep their native text-entry
  behavior. Editor commands ignore fields, contenteditable/textbox/combobox/slider/
  spinbutton/menu/listbox ownership and modal dialogs. Ctrl/Cmd +/- remain browser
  zoom; unmodified F/+/- are canvas view commands. Presentation Left/Right/Escape
  retains its existing typing/modal/modifier guard and local camera policy.
- Visible save/pending text stays current. Spoken editor status settles for 800 ms,
  deduplicates equal messages and spaces routine messages by 10 seconds. Pending
  counts/individual receipts share one spoken message; important noneditable states
  bypass that routine interval. Remote text/cursors/ACKs are not individually spoken.
  Local errors, explicit reorder actions and presenter state retain semantic notices.
- Existing theme tokens, focus styles, Radix focus traps, reduced-motion dialog/
  skeleton behavior and zero-duration presenter fitting remain. Toolbar/footer rows
  size to their contents; controls remain reachable when text grows, with horizontal
  toolbar scrolling rather than clipping action buttons. No contrast claim is made.

## Prepared full keyboard procedure (UI-07 / A28)

Execute only after explicit browser resumption; real board/auth cases also await
complete M00–M08 implementation and verified isolated targets. Use the production
web build with its actual worker/API, not development HMR. Preserve the existing
Phase 7 reviewed row `A28-and-template-legibility`; attach new observations to the
final source/build instead of rewriting historical evidence. Use synthetic board
text and accounts; do not record credentials, invite tokens or personal content.

1. Record the environment/result fields below. Start with a keyboard only; do not
   use pointer shortcuts to repair focus. Tab/Shift+Tab traverse controls, Enter/Space
   activate buttons, arrows choose Radix tabs/selects, and Escape closes dialogs.
   Log any unexpected focus jump or unreachable control as a failure.
2. From home, sign in, open boards, choose create, select Blank, edit title and
   description and submit. Repeat with each bundled template, including an empty
   title. Close/cancel board action dialogs and verify initial/trapped/returned focus.
   Check field errors and creation uncertainty/retry explanations without discarding
   retained requests. Archive/restore/rename/duplicate must return to their opener or
   Your boards heading when a menu opener disappeared. Verify that focus stays useful after
   closure. Real sign-in/creation is deferred under the database policy.
3. In demo and an editable live board, use Add to board to create all four card kinds
   and a Boundary. Expand inspector if collapsed. Browse objects, find/select each
   kind and confirm focused properties. Edit title and kind-specific text including
   code/schema/note, punctuation and IME composition. Type F, +, -, ?, Delete and
   Ctrl/Cmd+C/V/Z in fields; verify native text/clipboard/history scope and that the
   graph selection/camera is not changed accidentally. Enter commits without losing
   field focus; Escape cancels an invalid draft.
4. Edit numeric X/Y/Width/Height and Apply geometry. Try empty, non-finite and
   out-of-bounds values; verify associated errors and unchanged graph. Browse and
   toggle two cards and a boundary, Go to selected properties, Move selection, then
   select two cards and exercise each alignment. Verify a single command per operation.
5. Select one card, Connect cards, choose source/target and each fixed handle;
   reject a self-loop, review, go Back, then create. Select the resulting connection
   through Browse objects and edit label/protocol/direction/style. With a second
   client deleting an endpoint or revoking edit access during review, verify safe
   rejection and useful focus; no invalid or unauthorized edge may persist.
6. Return to canvas; test F, +/-, footer Zoom in/out, Reset zoom and Fit content.
   Ctrl/Cmd +/- must zoom browser text rather than the canvas. Keyboard help documents
   Space+drag pan, Ctrl+scroll zoom and Alt snap bypass for mixed-input use. Verify
   every keyboard operation has a named control; no connection drag is required.
7. Duplicate/copy/paste/paste-as-note, delete and Restore deleted. Include a selection
   above 10 objects: confirm modal initial focus on a safe action, Tab containment,
   Escape/Cancel and successful Delete objects → canvas focus. Restore uses fresh
   IDs and does not claim structural Undo. Repeat a focused remote deletion and
   verify recovery without stealing another panel/modal's focus.
8. Live board Discussion: select an anchor, open Discussion tab, Discuss selected
   card or connection, enter a message, send/read/reply, resolve/reopen and use
   authorized edit/delete controls. Test numeric point and viewport-center alternatives,
   deleted anchors, retained unsent drafts, offline/read-only explanation and server
   rejection. Verify each dialog and action error can be reached/spoken.
9. Steps: Capture new step, edit Step title/notes, recapture rectangle and replace
   highlights with selection. Create several steps; reorder with Earlier/Later at
   both ends, checking focus and announced position. Delete a selected/focused step.
   Present; use Left/Right and named Previous/Next controls, then Escape/Exit.
   Check notes/highlights after referenced objects or the active step disappear.
   Verify presenter/follower choices remain explicit and do not force shared camera.
10. Open Checkpoints & JSON, authorized checkpoint creation/view/restore and duplicate,
    JSON/local recovery and Export image (SVG/PNG). Use labeled choices and cancellation;
    record file success/failure, image limit explanations and complete recovery above
    the import cap. Import invalid and valid files from boards, inspect previews and
    exercise retry/uncertainty. Test Local storage status and recovery/reload/reset
    dialogs without silently dropping pending work. Do not approve destructive reset
    without a disposable test fixture and a verified recovery copy.
11. Repeat read/present/export and disabled mutation attempts as viewer and archived,
    cached offline editor/viewer, read-only other tab, expired/revoked session,
    unsupported storage/lock/schema and storage failure. Record permission/save/
    offline/pending/limit/storage/presenter explanations in text and speech.
12. Repeat in Light, Dark and System (including OS preference changes), reduced
    motion, zoomed text at 200% and 400%, collapsed panels, and narrow viewport.
    Board panels must expose readable properties/steps/discussion; Present must close
    the modal and focus Exit presentation. Exit/close must restore useful focus.
    Editing must stay unavailable on narrow screens. Inspect each bundled template's
    card text, edge labels, boundaries, notes and step highlights for legibility.

## Spoken and visual protocol / result record

Use an actual supported screen reader, for example NVDA with a supported desktop
browser on Windows; record installed tool/browser versions rather than assuming
them. Repeat at least creation, object selection/properties, field error, connection
review, step reorder, presentation/exit, offline/pending and recovery/export paths.
Use both normal Tab navigation and the reader's reading/browse mode for static
notes/disabled fields. Record the words actually spoken, not the expected DOM label.
Verify names/roles/state, field help/error association, modal entry/trap/return and
coalesced statuses; sustained remote typing/presence/ACK traffic must not flood speech.

| Required record field                                                    | Observation |
| ------------------------------------------------------------------------ | ----------- |
| Source commit / production build / worker version                        | UNRUN       |
| Test date / operator / reviewed artifact ID                              | UNRUN       |
| OS / browser exact version / viewport / text zoom / theme                | UNRUN       |
| Assistive tool exact version / mode / configuration                      | UNRUN       |
| Fixture/template / role / online/archive/storage/pending state           | UNRUN       |
| Procedure step / keys / expected result                                  | UNRUN       |
| Observed active control, initial/trapped/returned focus and sequence     | UNRUN       |
| Actual spoken words, duplicate/missing/overwhelming announcements        | UNRUN       |
| Visual focus, contrast, text clipping/reflow, reduced-motion observation | UNRUN       |
| PASS/FAIL/UNRUN, reproduction, fix commit and reproof artifact           | UNRUN       |

Record text/non-text contrast measurements and rendered focus/state contrast in
both themes. Source token names, Node policy tests and builds are supporting proof
only. Any observed defect needs a focused repair/reproof; keep A28 OPEN until the
complete keyboard workflow and reviewed spoken/visual observations are available.
