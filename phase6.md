# Archboard — Phase 6: Discussion and Sharing UX

Version: 1.0<br>
Date: 30 September 2026<br>
Status: Implementation specification<br>
Governing specification: `plan.md` version 1.1<br>
Prerequisites: Phase 3 identity, board permissions, memberships, and invites; Phase 4 authenticated
collaboration and access-change handling. Integrate with the Phase 5 offline/account lifecycle.
Read `docs/phase-3-identity-boards.md`, `docs/phase-4-collaboration.md`, and
`docs/phase-5-offline.md` before deriving implementation tasks.

## 1. Purpose and authority

This document defines milestone M06: finish board sharing and online discussion as integrated
product flows. It adds the share dialog, invitation review and acceptance, member role controls,
anchored comment threads, conflict handling, and REST resource invalidation around the existing
identity, permission, and collaboration foundations.

`plan.md` is the product and architecture authority. This file translates its sharing and
discussion requirements into bounded Phase 6 work, dependency order, observable evidence, and an
exit gate. In a conflict, use the user's latest written instruction, then `plan.md`, then this
document, then implementation details. MUST means required for Phase 6. DEFERRED means later
milestone work, not removed from version 1. This document is a plan, not implementation evidence,
authorization to deploy, or a claim that any acceptance case already passes.

Phase 3 records **PASS** for its historical identity and board-lifecycle evidence, including
server invite/member operations. That is a foundation, not proof of the finished sharing UX.
Phase 4 and Phase 5 record **OPEN** gates; the Phase 2 editor audit is independently **OPEN**.
Phase 6 may build on those implementations, but it cannot relabel their missing or failing
evidence as passed. Report current dependencies and affected regressions in the final audit.

### Version 1 implementation verification pause

The user has deferred all browser-running checks during current implementation. Do not run
Playwright, native browser package suites, served production-preview flows, or aggregate commands
that launch them (`pnpm test`, `pnpm test:browser`, `pnpm phase4:quick`, and full phase
verifiers). All database checks/tests are additionally deferred until the entire Version 1
implementation (M00–M08) is complete. This includes database-backed HTTP/auth/session/socket
tests, auth schema and configured migration checks, and aggregates with database children,
even in `--non-browser` mode. Finishing Phase 6 does not resume them.

Run focused database-free, non-browser formatting, lint, types, builds, boundaries, static
scans, and API unit/Node checks. Prepare database/session/socket tests but record them as
**UNRUN (deferred by user — until Version 1 implementation is complete)**. Browser cases
remain **UNRUN (deferred by user)** under the independent browser pause. The shared
[verification policy](docs/verification-policy.md) overrides all check execution instructions
below. Tasks and later phases may proceed with OPEN acceptance gates. Historical results
remain attached to their original builds; full phase/release PASS requires final verification.

## 2. Phase outcome

An owner can open a board's share dialog, see its immutable owner and members, create an editor
or viewer invitation, copy the newly issued link, inspect expiry/consumption state, revoke an
invite, change a nonowner's role, and remove a member. A recipient signs in, reviews the board
title, inviter, role, and expiry, and explicitly accepts. Concurrent acceptance still has one
winner under the server's single-use rule. Users receive useful expired, revoked, exhausted,
already-member, offline, and session-expiry states.

Owners and editors can start a discussion on a node, edge, or canvas point, reply, edit their own
messages, and resolve or reopen a thread. Owners can moderate any message. Viewers can read
discussion. Deleted messages remain as markers; deleted graph anchors retain fallback context.
Stale edits receive a conflict instead of overwriting newer server content.

Other connected readers see committed discussion and access changes through REST re-fetches
triggered by the existing socket protocol. Reconnection refreshes relational resources even if
an invalidation was missed. Offline discussion is read-only where cached data is available;
posting and all access-management mutations require connectivity. Local drafts remain clearly
unsent. Graph editing, durable ACKs, account isolation, and recovery retain their existing rules.

## 3. Consumed baseline and open dependencies

| Existing foundation                           | Phase 6 use and verification                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| Phase 3 Better Auth and `/me`                 | Derive the actor from the real session; preserve sign-in/sign-out behavior              |
| Phase 3 centralized permission service        | Reuse one owner/editor/viewer policy across REST and WS                                 |
| Phase 3 members and hashed single-use invites | Finish their product UI and rerun transaction/security cases                            |
| Shared contracts, REST envelopes, and Swagger | Add or complete discussion DTOs without parallel types                                  |
| TypeORM foundation and committed migrations   | Inspect existing thread/comment tables before adding a forward migration                |
| Phase 4 room queue and committed graph reader | Validate anchor targets against accepted graph state                                    |
| Phase 4 `invalidate` and `access.changed`     | Refresh REST data after commits; enforce access changes independently                   |
| Phase 5 account/cache/recovery lifecycle      | Keep offline mutations disabled, preserve pending graph work, isolate query/draft state |
| Phase 2 editor selection and inspector        | Integrate anchor actions and a discussion tab without bypassing domain commands         |

Implementation begins with an inventory of what actually exists. Do not rebuild member/invite
services merely because the phase adds UI. Check DTOs, migrations, route registration, existing
query keys, socket events, and permission behavior before selecting owned changes. Read
`apps/web/AGENTS.md` before frontend work and `apps/api/AGENTS.md` before API work.

The Phase 5 audit carries forward Phase 4's last recorded visibility miss (4,876 ms p95 against
500 ms), unapplied configured receipt-retention migration, 11 dependency-boundary violations,
missing fault/browser proofs, and a recorded presence-fanout failure. Its full offline acceptance
also remains unproven. These are historical findings to check against current evidence, not new
measurements. Fix any finding that blocks a Phase 6 behavior in its owning layer; list unrelated
open findings separately without claiming the earlier phase or release has passed.

M06's governing dependencies are M03 and M04. Phase 5 integration does not add a requirement to
reimplement M05, nor does a partial non-browser Phase 6 result close its OPEN gate.

## 4. Scope

### 4.1 Included

- Board share dialog with readable member list, owner identity, role labels, loading/error/retry,
  and role-appropriate actions.
- Owner-only invitation creation/list/revocation, one-time link display/copy, and visible expiry,
  revoked, and consumed states.
- `/invite/:token` sign-in, safe preview, explicit acceptance, and all required result states.
- Member role changes, removal, nonowner self-leave, owner immutability, and preservation of
  pending local graph work when leaving or losing access.
- Online node-, edge-, and point-anchored threads with paginated lists and messages, plain-text
  replies, message editing/deletion markers, resolution/reopening, and fallback anchor context.
- Shared discussion schemas, TypeORM services, transaction-safe limits, idempotent creation,
  version conflicts, board-scoped lookups, and matching OpenAPI.
- Discussion inspector tab and canvas anchor affordances, with usable keyboard alternatives.
- Post-commit resource invalidation and authenticated REST re-fetch on reconnect/access changes.
- Unsent draft/error states, read-only cached discussion where available, and account-scoped
  query/draft cleanup consistent with Phase 5.
- Real API/PostgreSQL security and concurrency evidence, later browser proof of A11/A19/A20,
  and an explicit audit of the complete role matrix.

### 4.2 Excluded

- Email delivery, organizations, ownership transfer, enterprise roles, a commenter role, public
  anonymous board links, public discussion, and changes to GitHub identity scope.
- Offline sharing or comment mutations, queued comment sends, and synchronization of comments
  through the graph CRDT/outbox. Persistent offline thread caching is optional, not a new write path.
- Rich HTML/Markdown rendering, attachments, image uploads, mentions, notifications, reactions,
  full previous-body history, thread hard deletion, and graph-anchor reassignment.
- Presentation/following, checkpoints, full JSON/SVG/PNG portability, and bundled templates:
  Phase 7. `checkpoints` invalidation remains compatible with that future consumer.
- Release-wide accessibility certification, broad performance/backup/deployment acceptance:
  Phase 8. Phase 6 controls still require keyboard access and clear states.
- A new auth provider, permission system, CRDT, periodic REST graph saves, or multi-process room scaling.

## 5. Non-negotiable architecture rules

1. PostgreSQL owns memberships, invitations, threads, messages, authorship, timestamps, and
   versions. TanStack Query holds fetched views; Y.Doc contains no discussion/access records.
2. Every REST request and persistent WS update uses the existing server permission service.
   Hidden buttons, cached roles, and an earlier successful preview are not authorization.
3. Mutations check current membership and archive state at the transactional boundary. Member
   changes serialize with board writes; commit access changes before notifying affected sockets.
4. Resolve every thread, comment, member, and invite through the path board. A resource ID from
   another board grants no access. Nonmembers receive 404; known members lacking role receive 403.
5. Server identity supplies authors and moderation actors. Clients cannot choose author IDs,
   creator IDs, security fields, timestamps, or versions on creation.
6. Thread/reply creation uses actor/operation-scoped idempotency with a transactional effect and
   response. Edit, deletion, and resolution use resource versions; a stale write changes nothing.
7. Thread anchors use the strict shared union and committed graph, with trustworthy fallback
   context captured by the server. A local unacknowledged object is not yet a valid server anchor.
8. Comment deletion replaces content with a deletion marker; it does not remove the row or
   rewrite unrelated history. Preserve `editedAt`/`deletedAt`, author, and original creation time.
9. Invitation tokens are bearer secrets: 32 random bytes, base64url links, SHA-256 hashes in
   invite records, seven-day expiry, and atomic single-use acceptance. Preserve the Phase 3
   one-time disclosure/idempotency design; never expose token hashes in response DTOs.
10. `invalidate` is a post-commit hint to re-fetch REST state. It carries no comment body/token,
    creates no graph update/ACK, and cannot replace `access.changed` or server session checks.
11. Offline, archived, revoked, or viewer states stop the applicable mutations. Failed or
    uncertain requests never appear sent, saved, or resolved merely because the UI changed.
12. Sign-out/account switch isolates queries, in-flight results, and drafts. Losing access never
    silently discards Phase 4/5 graph bytes or uploads them under another account.
13. Render messages and anchor labels as inert plain text. Do not fetch URL previews or log
    message bodies, raw invite tokens, cookies, OAuth data, or private graph content.
14. `/demo` remains a separate local-only experience with no server invitations or discussion writes.

## 6. Sharing, invitations, and role controls

### 6.1 Share dialog and member actions

The editor top bar opens a named, keyboard-operable dialog. All readers can see the owner and
member list. Only the owner sees invite management and controls to change/remove other members;
a nonowner can leave their own membership. The owner role is derived from the board, never
stored as a mutable member role, and has no demote/remove/transfer action.

Show effective roles in text. Disable management mutations while offline or archived and explain
why. Keep readable member data available when authorized; label stale cached data if shown.
Loading, empty-member, request-error, pending-action, and retry states are explicit. After a
mutation succeeds, re-fetch relevant members/metadata rather than constructing new authority
from the submitted form. If another owner's action changes access meanwhile, the server decides.

Removal and leaving explain the consequence before submission. For self-leave with pending
graph updates, use Phase 5's preservation/export/cancel flow before sending the online request.
Do not delete an outbox to simplify navigation. After removal, stop reads/uploads and close the
board view appropriately; a preserved local recovery copy is not continued server access.

### 6.2 Invitation management

Owners select editor or viewer and create an invitation online using `Idempotency-Key`. Display
the new invite URL only within the creation result, with an explicit copy action and manual
sharing guidance. List metadata without raw tokens/hashes, including role, expiry, revocation,
and consumption state. An old list entry cannot reconstruct the secret link. Copy failure leaves
the new result available for manual copying; revoke offers a clear pending/success/error state.

Reusing an invite-creation key follows the existing Phase 3 one-time-disclosure contract. Do not
add raw token persistence to list/query caches or a second response store to make retries easier.
If the response is uncertain and the link cannot be recovered under that contract, reconcile
the invite metadata and offer revoke/new creation rather than silently issuing repeated invites.

An invitation does not create public read access. Preview and acceptance require sign-in.
Acceptance never demotes an existing editor; an editor invitation can upgrade an existing viewer.
Owner acceptance is a no-op with no membership row. Repeated acceptance by the recorded accepting
user succeeds; a different user sees exhausted. Expiry/revocation/consumption are checked again
within acceptance, not only during preview. Preserve the existing handling of these outcomes
for already-member and owner cases; UI does not invent a second acceptance rule.

### 6.3 Invitation route

`/invite/:token` supports sign-in required, preview loading, valid preview, expired/revoked,
exhausted, already-member, accepting, accepted, offline/unavailable, and session-expired states.
Before sign-in, reveal no protected board metadata. After sign-in, POST the token to preview and
show only board title, inviter name, offered role, and expiry. Acceptance is an explicit action,
never a page-load side effect. On success navigate to the returned board ID and re-fetch its
effective role. Preview network failure is distinguishable from a definitively invalid token.

Apply `Referrer-Policy: no-referrer` to invite navigation/documents under the same-origin hosting
configuration. No third-party analytics or embedded resources may receive the token-bearing URL.
Redact the token from access/error logs, telemetry, evidence, and auth continuation diagnostics.
Any sign-in continuation stays within the app and uses the existing safe redirect mechanism;
do not introduce an open redirect. The service worker must not cache token-bearing invite
navigation/responses. Do not persist the bearer token as an account, board, or graph cache field.

## 7. Discussion data, anchors, and persistence

### 7.1 Shared DTOs and relational records

Use `packages/contracts` for strict request/response schemas, anchor union, versions, errors,
limits, and cursor forms. Unknown fields and client-owned authorship/security metadata are
rejected. Use server ISO 8601 UTC timestamps and the existing Better Auth user ID mapping;
do not assume auth user IDs are application UUIDs.

| Record            | Required fields and behavior                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `comment_threads` | UUID ID, board FK, anchor JSONB, nullable `resolved_at`/`resolved_by`, integer version, creator FK, creation time    |
| `comments`        | UUID ID, thread FK, author FK, plain-text body, integer version, nullable `edited_at`/`deleted_at`, creation time    |
| `api_idempotency` | Existing actor/operation/key uniqueness, request hash, response/status, 24-hour expiry; same transaction as creation |

Inspect the initial migration and entities before adding tables. Add a committed forward
TypeORM migration only for an actual schema/index/constraint gap; never enable synchronization,
edit an already-applied migration, or regenerate auth tables. Required list indexes are
threads by `(board_id, created_at, id)` and messages by `(thread_id, created_at, id)`.

Thread summaries include message count and a latest-message summary with author/time/deletion
state. Thread lists sort by `(createdAt, id)` descending; message pages sort by `(createdAt, id)`
ascending, with matching stable cursors. Counts include deletion-marker rows, and a latest
deleted message is summarized as a marker without its old body. Shared limits are
2,000 threads per board, 500 messages per thread, and 4,000 characters per message. Reject blank
submissions with field errors, preserve nonblank plain-text formatting, and define character
counting once in the shared schema. UI counters mirror server validation.

Creation of a thread and its first message is atomic. Replies, edits, deletion, and resolution
must leave no partial records or invalidation on rollback. Enforce limits transactionally so
concurrent creates cannot exceed caps. Version updates use compare-and-set, not a read followed
by an unconditional write. Record the actual locks/queries in database evidence.

### 7.2 Anchor contract and committed graph

The strict `anchor` union from `plan.md` is:

```text
{ type: 'node', id, label, position }
{ type: 'edge', id, label, position }
{ type: 'point', position }
```

Node/edge IDs are application UUIDs; positions are finite bounded world coordinates using shared
graph limits. Boundaries are not comment anchor targets in version 1. Reject unknown types,
missing fields, extra security fields, invalid coordinates, and cross-board targets.

On node/edge thread creation, resolve the target in a consistent projection of the board's last
committed graph. Hidden/tombstoned nodes or edges with missing/deleted endpoints are not valid
targets. Use the existing committed-state reader/room ordering so a concurrent graph change
cannot cause a draft or uncommitted candidate to supply fallback context. Capture the trustworthy
label and world position from accepted state. For an edge, use its accepted label and the midpoint
between its endpoint node centers as the deterministic fallback position; do not trust a
fabricated client label/position.
Point anchors use the validated world point.

A user may have a newly created local node whose update is still pending. Explain that its
thread must wait until that target is committed; retain the unsent draft. This is not a rule
that every graph outbox must be empty for every comment. Existing committed anchors and point
threads remain available when otherwise authorized and online. If the target disappears before
creation, return an explicit failure and keep the draft.

Later deletion of an anchor never cascades into discussion deletion. Show the thread in the
panel with “Original object deleted” and its fallback label/position. Do not recreate a node,
move a thread to a fresh node ID, or mutate graph history to repair a reference.

## 8. Comment permissions, versions, and idempotency

### 8.1 Phase 6 role matrix

The table applies to active boards with a current authenticated session. Archived boards retain
authorized reading; every mutation listed here is blocked until restoration.

| Operation                                                | Owner                  | Editor | Viewer |
| -------------------------------------------------------- | ---------------------- | ------ | ------ |
| Read members, threads, and messages                      | Yes                    | Yes    | Yes    |
| List/create/revoke invites; change/remove another member | Yes                    | No     | No     |
| Leave own membership                                     | No; owner is immutable | Yes    | Yes    |
| Start/reply to a thread; resolve/reopen                  | Yes                    | Yes    | No     |
| Edit/delete own message                                  | Yes                    | Yes    | No     |
| Edit/delete another author's message                     | Yes                    | No     | No     |
| Write graph data                                         | Yes                    | Yes    | No     |

Authorship does not bypass current access: a former editor downgraded to viewer cannot edit old
messages, and a removed member cannot read or moderate them. Owner moderation is attributed to
the acting owner in safe operation logs without replacing the original message author. Reject
forged actor/version/time fields and cross-board comment/thread/member/invite IDs.

### 8.2 Version conflicts and message lifecycle

Message editing/deletion sends the current message `expectedVersion`; resolution/reopening sends
the current thread `expectedVersion`. A successful state change increments that resource's
version atomically. Message edits set `editedAt`; deletion stores the deletion marker and
`deletedAt`, preserving author/creation metadata. Marker rows cannot be edited back into live
messages; an already-deleted request must obey the documented version/idempotent-state behavior
without erasing its deletion timestamp. Full previous-body history is deferred.

On stale version, return 409 `VERSION_CONFLICT` and preserve the newer row. The client retains
its unsent text, fetches the current resource, and offers an explicit review/cancel/retry action.
Never automatically overwrite newer content or silently merge relational messages as Y.Text.
Resolve/reopen and edit/delete races have the same no-lost-update rule. Failed mutations do not
update server-authoritative UI state to success.

### 8.3 Creation retry and uncertainty

Each logical thread/reply creation gets a UUID `Idempotency-Key` retained with its exact submitted
payload for retries. Scope it to authenticated actor and operation/target; store hash and response
transactionally with the effect for 24 hours. The same key and content returns the original
result with no extra row. Different content with the key returns 409 `IDEMPOTENCY_CONFLICT`.
Permission checks still govern retries; an old response cannot disclose a board after removal.

After an uncertain response, retain the draft and key and reconcile/retry the identical request
while valid. If the user changes the intended content, start a distinct logical request after
resolving the earlier outcome. After expiry, check visible results before asking to submit a new
creation; do not automatically resend with a fresh key. Invite acceptance uses its existing
durable single-use record rather than generic creation idempotency.

## 9. REST contracts and API integration

Product routes retain `/api/v1`; Better Auth remains `/api/auth/*`. Success objects return
`{ data: ... }`; collections return `{ data: [...], nextCursor: string|null }`. Page size defaults
to 30, maximum 100, with stable timestamp/ID cursors. Errors use the shared safe
`{ error: { code, message, fieldErrors?, requestId } }` envelope. Swagger must describe the exact
shared DTOs, cookie security, bodies (including DELETE version bodies), statuses, and pagination.

| Method/path                                   | Request                                | Phase 6 behavior                                       |
| --------------------------------------------- | -------------------------------------- | ------------------------------------------------------ |
| GET `/boards/:id/members`                     | None                                   | Members and derived owner; any reader                  |
| PATCH `/boards/:id/members/:userId`           | `role: editor/viewer`                  | Owner changes nonowner role                            |
| DELETE `/boards/:id/members/:userId`          | None                                   | Owner removes nonowner, or nonowner leaves self; 204   |
| GET `/boards/:id/invites`                     | `cursor?`, `limit?`                    | Owner-only metadata; no tokens/hashes                  |
| POST `/boards/:id/invites`                    | `role`; idempotency header             | Owner creates; invite URL once plus metadata; 201      |
| DELETE `/boards/:id/invites/:inviteId`        | None                                   | Owner revokes; 204                                     |
| POST `/invites/preview`                       | `token`                                | Signed-in minimal preview                              |
| POST `/invites/accept`                        | `token`                                | Atomic acceptance; board ID and effective role         |
| GET `/boards/:id/threads`                     | `cursor?`, `limit?`, `resolved?`       | Any reader; summaries and pagination                   |
| GET `/boards/:id/threads/:threadId/comments`  | `cursor?`, `limit?`                    | Any reader; message pages                              |
| POST `/boards/:id/threads`                    | `anchor`, `body`; idempotency header   | Owner/editor; thread and first message atomically; 201 |
| POST `/boards/:id/threads/:threadId/comments` | `body`; idempotency header             | Owner/editor; reply; 201                               |
| PATCH `/boards/:id/comments/:commentId`       | `body`, `expectedVersion`              | Current author/editor or owner; updated message        |
| DELETE `/boards/:id/comments/:commentId`      | `expectedVersion`                      | Current author/editor or owner; deletion marker        |
| PATCH `/boards/:id/threads/:threadId`         | `resolved: boolean`, `expectedVersion` | Owner/editor; updated thread                           |

Use existing member/invite implementations where they satisfy these contracts. Member auth user
IDs follow Better Auth's mapped type. All subordinate records are resolved through their board;
thread existence alone is never a permission check. No comment endpoint accepts graph snapshots
or independently updates `latestSeq`; discussion is not a graph persistence path.

Retain shared error meanings: validation 400, unauthenticated 401, known-member forbidden 403,
not found/nonmember 404, stale version/idempotency/invite exhaustion 409, invite expiry 410,
payload limit 413, rate limit 429, temporary service failure 503. Missing/revoked tokens use
`INVITE_UNAVAILABLE` 404. Limits and deleted/missing anchors use documented shared errors with
clear UI messages; do not invent per-controller envelopes.

## 10. Discussion interface and drafts

Add discussion as one primary right-inspector tab, sharing the shell with selection and future
presentation tabs. Provide unresolved/resolved filtering, paginated thread summaries, thread
detail/replies, empty/loading/error/retry states, author/time labels, edited/deleted markers, and
resolve/reopen controls. Selecting an available node/edge anchor can focus it locally; this is
local selection/viewport state and does not move collaborators or write graph history.

Provide named actions to start discussion from a selected node or edge and from a chosen canvas
world point. A keyboard user can choose a selected object or specify a point through an
accessible action; dragging/hover/right-click cannot be the sole entry path. Thread markers must
not intercept editor dragging, connection handles, or ordinary text shortcuts. Mark resolved
state in text, not color alone. Deleted anchors still open their discussion panel and fallback
context without pretending the original object is selectable.

Forms show the 4,000-character limit, validation feedback, sending state, and an explicit unsent
state on failure. Disable duplicate submission while a request is in flight. Prefer committed
server responses for sent messages; any pending presentation must visibly remain pending until
success. Preserve typed content during version conflicts, connectivity loss, and recoverable
server errors. Deletion/moderation actions explain that a marker remains.

Drafts are local UI state, separate from Y.Doc, the graph outbox, and service-worker caches.
They never send automatically on reconnect. Memory-only drafts are allowed if their reload
limit is explicit. If persisted, namespace them by deployment/account/board/thread or new-anchor
identity, bound storage, and incorporate them into sign-out/account-switch preservation. A
late response from an old account/board cannot replace the current draft or populate new-account
queries. An inaccessible draft is available only through the established recovery decision.

Use focus trapping and return focus for the share dialog, named controls, visible focus,
keyboard-operable filters/forms/menus, inline field errors, and accessible status announcements.
Phase 6 validates its own paths; it does not claim the full A28 presentation/editor gate.

## 11. Resource invalidation, offline behavior, and recovery

### 11.1 Commit before notification

After a committed discussion mutation, broadcast the existing server-to-client
`invalidate { resource: 'comments' }` to currently authorized board connections. Member changes
invalidate `members` and affected metadata as appropriate; board metadata uses `metadata`.
Invite mutations refresh the owner's invite queries from the local mutation response/re-fetch
and existing resource mapping, without adding an unsupported `invites` protocol enum. Invite
acceptance refreshes membership/board-list views. No notification is sent for a rolled-back
effect, denied request, or idempotent replay pretending to be a new mutation.

Membership/archive operations commit first, notify/disconnect affected connections before
further broadcasts, and use `access.changed` plus session reevaluation to stop access. A
best-effort invalidation cannot enforce removal or prevent reads by a revoked socket. Use the
Phase 4 queue/permission boundary; do not introduce a second notification server or bypass the
existing serialization rule. Graph sequence/ACK state is unchanged by REST invalidation.

### 11.2 Query ownership and reconnect

Centralize TanStack Query keys with authenticated account and board/resource scope. A discussion
invalidation refreshes summaries and the open thread's affected message pages, including cached
resolved/unresolved filters. Members/metadata invalidation refreshes effective role and readable
share data. Coalesce bursts without losing the final fetch; avoid invalidating unrelated boards.
The actor also updates/refetches its own queries, since a socket may be absent or disconnected.

Invalidate/refetch relevant relational views after authenticated socket readiness/reconnect,
return to online use, and invite acceptance. A reconnect may have missed every event while
offline; resource views have no durable notification log or graph sequence to prove freshness.
Do not mark them live/current until the REST fetch succeeds. An invalidation never applies
message bodies to Y.Doc, changes pending graph count, or generates “Saved to server.”

On board/account change, cancel old requests and prevent late completions from populating the
new scope. On sign-out/removal, clear protected active query state and stop automatic retries;
on 401 require sign-in, on 403 update permitted actions, and on 404 stop exposing server content.
Preserve only local recovery data under the prior authorized namespace according to Phase 5.

### 11.3 Offline and failure behavior

No share/member/invite/comment mutation runs offline, including automatic retries and background
sends. Cached discussion may be read with its fetch time and an explicit stale label; a never-
fetched list shows unavailable instead of an invented empty discussion. If durable offline
thread caching is implemented, it is an explicit account-scoped read cache, never blanket
service-worker caching of authenticated API responses. Memory-only cached views do not claim
to survive offline reload.

Archived boards permit authorized reading but block new threads, replies, message edits/deletes,
resolution, and invite/member mutations under the governing archived-board policy. Access
downgrade immediately removes write controls; removal/session failure stops ongoing protected
reads. Offline cached content is already downloaded data, not a guarantee of continued server
access or remote erasure. Keep existing graph preservation/export rules intact on every path.

## 12. Security and failure matrix

| Scenario                                                  | Required Phase 6 behavior                                                  |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| Editor/viewer forges member/invite management             | 403 for known member; no relational or graph change                        |
| Viewer or downgraded former author posts/edits/resolves   | Denied under current role; old authorship grants no write access           |
| Cross-board thread/comment/member/invite ID               | Board-scoped lookup rejects; no protected content or existence leakage     |
| Node/edge anchor exists only in local pending graph       | Thread not created; explain commitment requirement; preserve draft         |
| Anchor deleted before/after thread creation               | Before: reject missing target; after: preserve thread and fallback context |
| Client forges fallback label/position or author/time      | Server-derived context/identity wins; invalid DTO fields rejected          |
| Two users accept one invite concurrently                  | One recorded new accepter; no second membership effect                     |
| Preview succeeds, then token expires/is revoked           | Acceptance rechecks state; no membership created                           |
| Same accepting user retries; another user retries         | Same user's recorded success; other's exhausted outcome                    |
| Existing editor/viewer/owner accepts invite               | No demotion; permitted upgrade only; owner membership remains absent       |
| Creation response lost or duplicate request               | Original keyed result/effect reused; no extra thread/message/invite        |
| Same key used with different body/anchor                  | 409; prior effect unchanged                                                |
| Two edits, delete/edit, or resolve/reopen share a version | One valid state change; stale write 409; newer state preserved             |
| Concurrent creations at thread/message cap                | Transactional cap holds; no excess/partial records                         |
| DB transaction fails                                      | No success state, partial thread/message, or post-commit invalidation      |
| Event missed while disconnected                           | Authenticated reconnect refetches REST views                               |
| Role/remove/archive races with a mutation                 | Defined board transaction order; no post-change unauthorized write         |
| Sign-out/account switch during fetch or send              | Old results cannot populate new account; local graph/draft rules respected |
| Offline discussion/share action                           | Disabled with explanation; draft remains unsent; cached reads show age     |
| Malicious message/anchor text or token URL                | Inert text; no execution/preview fetch/token leakage to logs or referrers  |

Use synthetic accounts/content. Verify response bodies, API/socket behavior, logs, public bundles,
and later actual Cache Storage/IndexedDB surfaces at their real boundary. Never place cookies,
OAuth codes, raw invitation tokens or hashes, message bodies, private graph payloads, or database
URLs in evidence. A screenshot or logged route must redact token-bearing URLs.

## 13. Work breakdown

Implement one bounded task at a time in dependency order. Each task records owned files/modules,
contracts, non-goals, exact checks, and a report under `docs/evidence/phase6/`. Internal filenames
may follow the existing layout; do not create all task prompt files as part of this specification.

| ID    | Task and primary ownership                                                    | Depends on               | Primary output                                                                         | Completion evidence                                                                  |
| ----- | ----------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| P6-01 | Baseline/contracts inventory; contracts and API schema                        | M03, M04 implementations | Existing-service map, strict discussion DTOs/errors/limits, actual schema-gap decision | Contract negatives, typecheck, migration inventory; inherited statuses recorded      |
| P6-02 | Discussion persistence and anchors; API comments/committed graph reader       | P6-01                    | Atomic thread/reply creation, trusted anchors, pagination, caps, idempotency           | Real DB rollback/retry/cap races and committed/deleted/cross-board anchor tests      |
| P6-03 | Message lifecycle and resolution; API comments/permissions                    | P6-02                    | Authorship/owner moderation, deletion markers, versioned edit/delete/resolve           | A20 and full API role/version-race evidence                                          |
| P6-04 | REST resource invalidation; collaboration services/sync event consumer        | P6-02, P6-03             | Post-commit hints, access-change ordering, reconnect refresh contract                  | Real socket/DB notification/denial checks; no graph-sequence side effects            |
| P6-05 | Share dialog and members; web sharing/board queries                           | P6-01, P6-04             | Readable roles, owner controls, remove/self-leave with preservation flow               | API role regressions plus rendered keyboard/access/pending-work proof                |
| P6-06 | Invitation management; web sharing/existing API invites                       | P6-05                    | Create/copy/list/revoke and one-time secret handling                                   | API retry/redaction/archive cases plus rendered creation/copy/revoke proof           |
| P6-07 | Invitation route and acceptance; web routes/auth/invite queries               | P6-06                    | Safe preview/sign-in/accept and all token/member result states                         | A19 real DB race plus two-user route/session proof and referrer checks               |
| P6-08 | Discussion panel and anchoring; web discussion/editor integration             | P6-03, P6-04             | Lists/messages, create/reply, markers/filtering, deleted-anchor fallback               | All anchor kinds, pagination, viewer reads and independent-reader refresh proof      |
| P6-09 | Conflict, drafts, and moderation UX; web discussion                           | P6-08                    | Review/retry on 409, own/owner actions, unsent and deleted states                      | Rendered A20, moderation matrix, uncertain-create retry and draft-preservation proof |
| P6-10 | Account/offline/access integration; web lifecycle/query ownership             | P6-05, P6-07, P6-09      | Scoped queries/drafts, reconnect fetch, archived/offline/revoked states                | Non-browser state/API checks plus independent-account/offline/access browser cases   |
| P6-11 | Integrated acceptance and verifier; scripts/API tests/later browser harnesses | P6-04–P6-10              | A11/A19/A20, security/concurrency matrix, full and non-browser verification modes      | Exact DB/socket/UI boundaries and commands with PASS/FAIL/UNRUN                      |
| P6-12 | Phase audit and handoff; documentation                                        | All prior tasks          | Final matrix, OpenAPI/run guide, inherited findings and next-phase handoff             | Every exit criterion linked to evidence or explicit blocker                          |

P6-05–P6-07 and P6-08–P6-09 are separate feature paths after the shared prerequisites.
Discovery of a Phase 3/4/5 defect is fixed and evidenced at its owner layer, with affected
regressions rerun. Do not weaken invite, permission, or save-state contracts to pass new UI tests.

During the temporary pause, browser-specific proof is **UNRUN (deferred by user)**.
Implementation and non-browser evidence may be delivered; browser acceptance and
the full Phase 6 gate cannot be marked PASS from substitutes.

## 14. Verification requirements

### 14.1 Shared contracts, schema, and real database

- Strict anchor/request/response validation, plain-text/length limits, pagination/cursors,
  auth user ID mapping, and Swagger agree across contracts, API, and frontend.
- Existing tables are reused; necessary forward migrations apply to an isolated real PostgreSQL
  schema with foreign keys, versions, indexes, and idempotency constraints intact.
- Thread plus first-message rollback is atomic; duplicate/reordered retries do not add rows;
  24-hour key conflict/expiry handling and concurrent caps have real transaction proof.
- A20 checks stored body/version/metadata before and after a stale request, not just an HTTP code.
  Edit/delete and resolve/reopen races preserve the winning committed state.
- Creation validates all anchor variants; committed-context capture, pending/missing/deleted
  targets, graph-delete races, and malicious cross-board IDs have focused evidence.
- Query plans/pagination use representative synthetic discussion data; record observed plans
  and timing without inventing a new product performance target.

### 14.2 Required acceptance cases

| Test | Phase 6 assertion and evidence boundary                                                                                                                                                                                                                                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A11  | Viewer raw WS graph update is denied without state/sequence change; cross-board thread/comment/member/invite requests reveal no data. Use real session, socket, HTTP, and DB checks; later UI shows the same role restrictions.                                             |
| A19  | Two different signed-in users accept one single-use invite concurrently using independent DB connections; exactly one new accepting user wins. Retry/expiry/revoke/no-demotion/upgrade/owner cases also pass. Later route/UI proof uses independent authenticated contexts. |
| A20  | Two readers edit the same message version; the stale request returns 409 and newer body/version remains stored. Later UI retains unsent text, re-fetches current content, and requires an explicit next action.                                                             |

Retest A10 when self-leave/removal/downgrade touches pending graph preservation; A24 for scoped
queries/drafts and late account-switch responses; A25 for direct invite/editor routes and cache
exclusions; A27 for archive versus REST/graph writes. Existing A11 raw-update proof does not
alone satisfy the new REST discussion checks. Scope A18 negative text/security cases to comment
and anchor rendering; full import/XML acceptance remains Phase 7. Exercise Phase 6 keyboard and
screen-reader paths without claiming complete release-wide A28.

Browser assertions are **UNRUN (deferred by user)** until resumed. When run, use a served
production build, real Better Auth sessions, and independent browser contexts for sender/reader
and inviter/recipient. Mocked UI states may support component behavior but cannot prove
membership acceptance, PostgreSQL conflicts, or live invalidation. Service-worker/offline/cache
assertions require an active worker and actual offline mode; a React flag is insufficient.

### 14.3 Invalidation, security, and access tests

- A commit emits the appropriate hint to authorized readers; a rollback or denied mutation does
  not. REST reads observe committed state after the hint. Graph ACK/sequence/outbox are untouched.
- Reconnect and focus/online recovery refresh stale views after missed hints. Multiple pages and
  resolved filters reconcile; an old account/board response cannot populate a new namespace.
- Members/role/archive/session changes stop forbidden reads and writes before further protected
  fanout. Exercise revocation and archive races through real sockets and PostgreSQL.
- Invite logs/list DTOs/query persistence expose neither tokens nor hashes; preview is minimal,
  redirects are safe, and no-referrer/service-worker exclusions are applied and later inspected.
- Plain-text script/HTML/URL payloads remain inert. Forge author, creator, time, version, and
  cross-board references through raw requests, rather than relying on hidden UI controls.
- Offline failures, 401/403/404, expired invitation, rate limits, caps, version conflicts, and
  uncertain POST responses leave truthful states and preserved unsent text/local graph work.

### 14.4 Evidence realism and inherited gates

Report PASS, FAIL, or UNRUN for each named boundary. A mock repository cannot prove a DB lock,
transaction, cap, or acceptance race. A captured `invalidate` frame cannot prove a reader UI
re-fetched. A frontend build cannot prove referrer behavior, clipboard access, keyboard use, or
account isolation. Record partial API/socket success separately from deferred browser success.

Track applicable Phase 3 regressions and Phase 4/5 open dependencies explicitly. Resolve a
binding permission, migration, access-event, or room-order failure before passing its dependent
Phase 6 criterion. Keep unrelated Phase 2/4/5 findings visible under their own audits; no Phase 6
result certifies offline completion, global performance, deployment, or version 1 release.

## 15. Required verification commands

Add a fail-propagating `pnpm phase6:verify` with documented `--non-browser` and
`--implementation` modes during implementation. These are intended new interfaces, not
existing scripts at specification time. Implementation mode excludes database/browser
children and reports deferred requirements as UNRUN with the full gate OPEN. Non-browser
mode retains real database coverage for final verification and is deferred until then.
Record actual commands, selected suites, test counts, durations, and child results in evidence.
The non-browser mode must never spawn Chrome, Playwright, preview/browser harnesses, or native
browser suites, and its success is not a full phase PASS.

Run relevant database-free, non-browser checks for owned changes; an aggregate should run
shared checks once and use focused Node/API units without hidden database/browser children:

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @archboard/api test
pnpm --filter @archboard/web build
pnpm --filter @archboard/api build
pnpm build
pnpm boundary:check
pnpm phase6:verify --implementation  # once implemented; no DB/browser children
```

Database commands remain **UNRUN (deferred by user — until Version 1 implementation is complete)**:

```text
pnpm test:integration
pnpm --filter @archboard/api test:integration
pnpm auth:schema:check
pnpm db:migration:show
pnpm phase5:verify --non-browser
pnpm phase6:verify --non-browser  # once implemented; contains real DB/socket checks
direct Node/Jest database-backed HTTP/auth/session/socket and migration wrappers
```

After all M00–M08 implementation, use isolated migrated PostgreSQL schemas/databases for
the consolidated transaction/race verification pass. Report configured
database migration state separately; an isolated test migration does not resolve an unapplied
migration in another environment. Only apply forward migrations to a verified intended target
under implementation authorization; this planning document performs none.

Browser-running commands remain **UNRUN (deferred by user)**:

```text
pnpm test
pnpm test:browser
pnpm --filter @archboard/sync-client test
pnpm phase1:verify
pnpm phase2:verify
pnpm phase3:verify
pnpm phase4:quick
pnpm phase4:verify
pnpm phase4:verify:legacy
pnpm phase5:verify             # full browser mode
pnpm phase6:verify             # future full browser mode
served production-preview sharing/discussion/offline/browser scripts
```

The later full Phase 6 verifier must include real DB/session/socket tests, independent served
browser sharing/discussion flows, focused accessibility/security checks, and cache/referrer
inspection where required. It returns nonzero for failures and cannot hide required unrun cases
behind API-only substitutes. Document separate manual checks and unresolved inherited findings.

## 16. Deliverables

Phase 6 is complete only when these deliverables agree:

1. Shared discussion/anchor/version/error/cursor contracts, centralized limits, and matching API
   documentation, with existing member/invite contracts preserved.
2. TypeORM-backed comment services over verified tables/migrations, with transaction-safe
   creation, trusted anchors, idempotency, pagination, caps, and version conflict handling.
3. Permission-correct message authorship, owner moderation, deletion markers, resolution, and
   retained fallback context after graph deletion.
4. Share dialog and member role/removal/self-leave controls with immutable ownership and pending
   graph preservation.
5. Owner invitation creation/copy/list/revoke UX and safe, authenticated `/invite/:token`
   preview/acceptance with complete token/member states.
6. Discussion panel and node/edge/point actions, keyboard alternatives, read-only viewers,
   unsent drafts, and explicit conflict/retry behavior.
7. Post-commit resource invalidation, reconnect REST refresh, and current-access enforcement
   without graph sequence/outbox/ACK side effects.
8. Offline/archive/account/session/access-change integration preserving graph recovery and
   preventing cross-account query/draft disclosure.
9. Real A11/A19/A20 API/database/socket evidence, independent browser product proof when resumed,
   role-matrix negatives, and relevant inherited regressions.
10. Full/non-browser/implementation Phase 6 verifier interfaces and updated local API/UI run guidance.
11. `docs/phase-6-discussion-sharing.md` final audit and per-task evidence/index under
    `docs/evidence/phase6/`.

The audit/evidence files above are implementation deliverables; creating them is not part of
writing this specification.

## 17. Exit gate

Phase 6 passes when:

- Every P6 task has its required evidence; no required proof is failing or missing.
- A real owner can share a board, manage invitations/members, and preserve immutable ownership;
  editors/viewers cannot forge owner operations or write on archived boards.
- A19 proves single-use acceptance and repeat-user semantics against PostgreSQL, with the
  sign-in/preview/accept UX verified in independent authenticated browser contexts.
- All anchor variants use the committed graph/world-coordinate contract; discussion remains
  readable with truthful fallback context when an object disappears.
- Owners/editors/viewers obey the complete current-role discussion matrix through UI, raw REST,
  and WS; A11 rejects cross-board identifiers without data or state leakage.
- Thread/reply idempotency and transactional caps hold; deletion markers and versioned mutation
  races retain correct authorship/timestamps and no partial writes.
- A20 proves the stored newer message survives a stale edit and the rendered client preserves
  unsent text with an explicit conflict recovery action.
- Connected readers refetch committed REST state after invalidation; reconnect repairs missed
  hints; access removal stops protected fanout and writes before further exposure.
- Offline/archive/session/account states are truthful, drafts remain unsent, and graph outbox
  preservation and account isolation regressions pass.
- Invite secrets do not enter graph/cache/log/evidence surfaces; referrer and caching policy,
  inert text, keyboard access, safe envelopes, builds, types, and package boundaries are verified.
- Binding prerequisite failures are resolved or remain explicit blockers; earlier phase audits
  retain their own status. No Phase 7/8 or version 1 readiness claim is made.

While database or browser verification is paused, report implementation/fast-check progress
and keep the full gate **OPEN**, listing each deferred boundary as UNRUN under its respective
pause. Continue later implementation milestones without claiming phase/release PASS.
If a requirement fails, fix its
owning implementation or propose a targeted contract amendment with evidence and consequences.
Do not treat a visible share button, successful API mock, or socket hint as an integrated feature.

## 18. Handoff record

Each Phase 6 task report contains:

```text
Task: <P6-ID and title>
Implemented behavior: <observable result>
Changed files/modules: <owned scope>
Contracts used: <role, anchor, versions, idempotency, tokens, invalidation, offline rules>
Schema/API impact: <existing tables/routes reused; forward migration/Swagger changes or none>
Checks run: <exact commands and selected suites>
Results: <PASS/FAIL/UNRUN with counts, durations, build/runtime versions>
Database/socket evidence: <transaction, race, stored state, event/denial; real or mocked>
Browser/UI evidence: <independent sessions, URL redacted, build, role/action/result or deferred>
Security/account evidence: <scoping, token redaction, actor validation, late-response isolation>
Draft/recovery evidence: <unsent/conflict/offline state and pending graph preservation>
Known gaps: <missing proof, inherited audit status, blockers>
Decision or amendment: <none, or exact link and rationale>
Next dependency unlocked: <task ID or phase exit>
```

The final audit maps every deliverable/exit criterion to a real HTTP/session/database/socket
result, served-browser result, focused test, build, inspection, or explicit blocker. Record
runtime/PostgreSQL/browser versions, build hash, commands, test counts, timings, and
PASS/FAIL/UNRUN. Separate historical evidence, synthetic UI checks, current non-browser results,
and later independent-browser proof. The Phase 7 handoff confirms that discussion/access data
remains server-owned and excluded from graph exports, copies, templates, and checkpoint restores.
