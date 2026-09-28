# Archboard — Phase 5: Offline Product Completion

Version: 1.0<br>
Date: 28 September 2026<br>
Status: Implementation specification<br>
Governing specification: `plan.md` version 1.1<br>
Prerequisites: Phase 4 durable collaboration implementation and the Phase 1–3 foundations. Read
`docs/phase-4-collaboration.md` for the current Phase 4 **OPEN** gate and
`docs/phase-2-editor.md` for the separate open editor audit.

## 1. Purpose and authority

This document defines milestone M05: make previously opened authenticated boards usable through
an offline reload, then reconcile their locally durable edits when connectivity returns. It adds
the application shell, explicit account-scoped cache experience, revocation and sign-out recovery,
account switching, and safe application update behavior around the Phase 4 synchronization client.

`plan.md` is the product and architecture authority. This file narrows its offline requirements
into bounded Phase 5 work, a task order, observable evidence, and an exit gate. In a conflict, use
the user's latest written instruction, then `plan.md`, then this document, then implementation
details. MUST means required for Phase 5. DEFERRED means later milestone work, not removed from
version 1.

Phase 4's P4-01–P4-12 implementation exists, but its audit is **OPEN**. The last recorded gate
failed the collaboration visibility target, configured migration state, and package boundaries;
several crash, causal-gap, access-change, and storage-error proofs were unrun. Phase 5 may build
on the implementation and add its own evidence. It must not present an inherited failing or unrun
Phase 4 proof as passed, and its final audit must report those dependencies explicitly. The Phase
2 pan-performance and human/browser audit gaps also remain open unless separately resolved.

## 2. Phase outcome

A signed-in editor who has opened a board online can lose connectivity, reload its direct editor
URL from a production build with the service worker active, and continue editing the cached board
using its last known role. The app reports device persistence accurately. The exact queued bytes
survive reload and reconnect; server authorization is checked again before an upload commits.
Independent edits made elsewhere converge without replacing the offline document.

The offline dashboard shows only boards cached under the current local account namespace and
labels their metadata and freshness as cached. Users can distinguish unavailable online actions
from durable local graph editing. If access changed while offline, the editor freezes on reconnect,
preserves its local work, and offers recovery. Sign-out and account switching make an explicit
preservation choice before local data is cleared or hidden. A new application version waits for a
safe user-directed transition and cannot silently discard an older client's pending edits.

Phase 5 does not create server boards offline or turn REST metadata, comments, invites, and access
management into offline writes. It does not provide automatic conflict resolution beyond the
existing Yjs rules or guarantee against browser storage eviction.

## 3. Consumed baseline and open dependencies

| Existing foundation                                                             | Phase 5 use and verification                                                       |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Phase 2 local Y.Doc editor, IndexedDB adapter, Web Lock, and `/demo`            | Preserve local commands and one-writer semantics while loading routes offline      |
| Phase 3 Better Auth session and dashboard                                       | Keep online sign-out/session authority and board metadata in their existing owners |
| Phase 4 account/board/schema namespaces, outbox, receipts, and reconnect client | Reuse exact local bytes and ACK handling; never add a parallel save path           |
| Phase 4 authenticated editor route and recovery download                        | Expose cached/offline, storage, access-change, and reload states in the served app |
| Phase 4 cookie/Origin gateway and transaction-time permission service           | Revalidate every upload; cached roles authorize only temporary local editing       |
| Phase 4 audit                                                                   | Carry forward its OPEN findings until separately fixed and evidenced               |

The implementation first checks which Phase 4 baseline behaviors actually exist and which are
only planned or partially proven. Phase 5 work cannot conceal a Phase 4 gap behind a new service
worker or UI state. A concrete dependency failure is fixed in its owning layer and recorded in
the Phase 5 evidence and the Phase 4 audit follow-up.

## 4. Scope

### 4.1 Included

- A versioned Vite PWA/Workbox service worker that caches the static application shell and local
  assets required for direct-route offline navigation, with a tested navigation fallback.
- Production-build direct-route refresh for `/`, `/boards`, `/boards/:boardId`, and `/demo` where
  appropriate, including explicit first-use/offline-unavailable states.
- An offline dashboard sourced from explicit account-scoped `boardCache` records, with cache
  timestamps, role/archive hints, and links only to locally available board documents.
- Previously opened authenticated board loading from the local snapshot/log while offline, with
  last-known-role local editing, one-writer lock, and exact save-state labels.
- Reconnect from an offline reload through Phase 4 `ready`, authorization, ordered outbox drain,
  receipt handling, and independent remote-edit convergence.
- Access downgrade, removal, archive, session-expiry, schema mismatch, and permanent-rejection
  recovery that preserves outbox bytes and supports local export.
- Online and offline sign-out behavior, cross-tab notification, a preservation choice for
  unsynchronized work, and isolation when a different account signs in.
- An application update prompt that defers activation/reload while editing or while pending
  content requires preservation, plus old-client/schema compatibility handling.
- Storage status and recovery messaging for quota, blocked IndexedDB, eviction, unavailable Web
  Locks, or an uncached board; no false durability or freshness claim.
- Real service-worker-enabled production-preview browser evidence for A06, A07, A10, A22, A24,
  and A25, plus affected Phase 4 regressions.

### 4.2 Excluded

- Offline creation of new server boards; offline title changes, archive/restore, duplicate,
  membership/invite operations, and comment posting or resolution. These require connectivity.
- Full JSON import/export product controls, SVG/PNG export, checkpoints, presentation, and all
  bundled templates: Phase 7. The existing recovery download remains available in Phase 5.
- Finished share dialog, invite pages, role controls, comment UX and REST invalidation UX:
  Phase 6. Offline cached comments may remain a later read-only enhancement; they are never
  presented as current server data.
- Offline GitHub sign-in, a new identity provider, background server synchronization without an
  authenticated open client, push notifications, and automatic cross-account cache migration.
- Storage guarantees against user clearing site data, browser eviction, or a lost device;
  database backup/restore and broader release operations remain Phase 8.
- A new CRDT, periodic whole-board REST saves, multi-tab writers, or multi-process room scaling.

## 5. Non-negotiable architecture rules

1. The service worker caches versioned static application assets and navigation shell only. It
   does not blanket-cache authenticated API responses, WebSocket traffic, OAuth callbacks, invite
   tokens, or account-specific graph data.
2. IndexedDB remains the explicit account/board/schema-scoped store for cached metadata, Yjs
   snapshots/log, outbox, and receipts. The service worker cannot become a second graph authority.
3. Device save means the IndexedDB transaction committed. Server save means every local update has
   a durable server ACK after hydration, with no recovery error. Neither a cached shell nor an
   `online` browser event proves server freshness or persistence.
4. Cached role enables offline local edits only for a previously opened board. On reconnect, the
   server's current role/archive/session state governs upload and continued access.
5. Do not drop, rewrite, skip, or re-ID a pending update to get past revocation, validation,
   schema, or network failure. Preserve the graph and bytes for export or an explicit recovery
   decision.
6. The app never silently opens one account's graph or metadata cache under another account.
   Namespace selection follows a trusted previously established local account identity, and
   server responses can replace it only after authentication.
7. Offline sign-out stops local authenticated editing and sockets immediately, broadcasts to the
   user's other tabs, and says clearly that server invalidation is pending. It is not a claim that
   the Better Auth session was revoked remotely.
8. Before local cache clearing or account switching can make unsynchronized edits inaccessible,
   offer an explicit preservation choice and local recovery export. No automatic transfer to a
   different user or board occurs.
9. One tab holds the Web Lock for each account/board namespace. A second tab is read-only; lock
   transfer works after the first closes. BroadcastChannel conveys state changes and sign-out,
   not an independent unacknowledged write stream.
10. An application update cannot force reload during editing or while pending work lacks a safe
    transition. If the new app or graph schema is incompatible, keep compatible cached assets
    running when possible or show an explicit unsupported/recovery state; keep pending data.
11. `/demo` remains local-only and independent of authenticated cache clearing or sign-out.
12. Browser storage is best-effort. Show meaningful storage status and recovery guidance without
    describing the cache as a server backup or a permanent guarantee.

## 6. Offline shell and request caching

Use the selected Vite PWA integration/Workbox to precache the versioned HTML entry and all local
JS, CSS, fonts, icons, worker scripts, and other build assets needed to open the editor. The
served production build must install/activate a service worker under the same origin as the
frontend and return the cached app shell for supported navigation requests, including a direct
refresh of `/boards/:boardId` and `/boards`. The router then loads only local account-scoped data
when offline. A board never opened and cached online shows a clear unavailable state.

Use explicit allowlisted navigation fallback routes and bounded static-asset caching. Network
responses for `/api/*`, `/ws/*`, OAuth callbacks, invitation tokens, and any authenticated or
user-specific response must not be stored by a catch-all runtime rule. A service worker cannot
read an HttpOnly session cookie to choose a user cache. Account-scoped records stay in IndexedDB
behind application code. Build output must not depend on a third-party CDN, remote font, or a
runtime network fetch for essential editor UI. Verify the resulting CSP and worker asset loading
in a served production build.

On first online load, do not promise offline availability until the required shell assets are
cached and the chosen board has a locally committed snapshot/log. A completed service-worker
installation alone does not mean the board's data is present. A browser may evict assets or
IndexedDB data; a missing shell cannot be repaired offline, and a missing board cache cannot be
fabricated from a stale dashboard entry.

## 7. Account-scoped cached board navigation

`boardCache` holds the last known safe board metadata, effective role, archive state, cache time,
and last received server sequence under deployment origin, authenticated user ID, board ID, and
schema version. The online dashboard still uses authenticated REST/TanStack Query data. The
offline dashboard reads only current local-account records and labels the list “Cached boards”
with each record's fetch or commit time. Search/filter may operate on that local subset, but the
UI must not imply a complete or current server list. A record without a usable local document
is shown as unavailable, not as an editable board.

The local account selector comes from an account identity established during a prior successful
session and stored only as a safe local cache key/summary. It is not proof of an active server
session. If there is no recognized local account, show the signed-out/offline state and a path to
the separate `/demo`; do not enumerate every cached user's boards. After a real online session
resolves, select only that user's namespace. Auth network failure must not be interpreted as
definitive sign-out or as permission to show another account's data.

Creating, renaming, archiving/restoring, duplicating, managing access, accepting invites, and
other relational operations remain disabled while offline with a clear explanation. A cached
viewer and an archived board stay read-only. A cached owner/editor may edit a previously opened
active graph under the local Web Lock, with an explicit “will sync after reconnect” status.

## 8. Offline edit, reload, and reconnect

Offline entry loads local snapshot plus ordered log, acquires the per-namespace Web Lock, attaches
the Phase 4 persistence adapter, and only then enables local commands. An edit is saved to the
device only when its update and matching outbox entry commit in one IndexedDB transaction.
Remote-origin updates never echo into the outbox. Local compaction does not delete unacknowledged
entries. A reload repeats hydration from committed local state; transient in-memory work that
never committed is not described as reload-safe.

When connectivity returns, the existing sync client authenticates and receives a full `ready`.
It merges accepted server state into the local Y.Doc without replacing pending work and drains the
persisted outbox by local sequence, one ACK at a time, with the original IDs and bytes. Receipt
persistence and outbox removal remain atomic. Independent offline and remote edits converge under
the specified Yjs rules; a deleted object remains hidden by its tombstone. A socket reconnect,
browser `online` event, or server `ready` alone cannot produce “Saved to server.” Sequence gaps
and permanent errors follow Phase 4 recovery rules.

Save labels retain the exact conditions from `plan.md` section 10.4 and `phase4.md` section 8.3:
“Saving on this device…”, “Saved on this device · offline”, “Connecting…”, “Syncing N changes…”,
“Saved to server”, “Offline · cached copy”, “Storage error · export your changes”, “Access changed
· local changes preserved”, and “Recovery required”. A cached copy with no pending edits still
has unknown remote freshness. The offline dashboard and editor use text and accessible status
announcements, not color alone, to communicate these conditions.

## 9. Access changes and preservation

An offline editor may continue using the last known editor/owner role. The server can have
revoked or downgraded that access while the browser was disconnected. Before any queued upload
commits, Phase 4's transaction-time permission check applies. On a denied reconnect, freeze the
old editor, stop sending dependent entries, retain the local graph/outbox in that account
namespace, and show “Access changed · local changes preserved” with an export action. The UI
cannot imply the queued work reached the server. It must not automatically move the work to
another board or user.

An archived board is read-only until an owner restores it online; its pending queue remains
preserved and cannot be sent while archived. A viewer downgrade freezes local graph writes even
if an older cache said editor. Session expiry or failed authentication stops upload and requires
online sign-in; a temporary network error preserves the cache without declaring the session
revoked. A newer unsupported graph schema makes an old client read-only, prompts for an app
update, and keeps local pending data exportable. A permanent validation error retains the exact
failed bytes and does not skip forward to causally dependent updates.

The Phase 4 “Reload server version” action remains a deliberate last step. Before deleting the
current namespace it warns about unsynchronized content and offers recovery export. Cancellation
leaves all local records intact. Export is a recovery capability over the local graph; the full
versioned import/export product belongs to Phase 7. Imported recovery content, if the user later
chooses to use it, must create a new private board under the Phase 7 import contract; it is never
silently attached to the old board.

## 10. Sign-out, account switching, and multiple tabs

Online sign-out invokes Better Auth's server sign-out and removes authenticated frontend/query
state. Offline sign-out stops sockets and local authenticated editing immediately, clears active
session presentation in the UI, and displays that server session invalidation remains pending
until connectivity returns. Maintain a local pending sign-out intent without storing an auth
secret. Before any later authenticated UI or upload resumes in that browser, attempt the pending
server invalidation when reachable and resolve its result honestly; do not allow a still-valid
HttpOnly cookie to silently sign the supposedly signed-out user back in.

Before sign-out/account switch clears or hides a namespace with pending edits, show the affected
board count and preservation choices: cancel, retain the local copy under the old account for a
later return, or download recovery exports before clearing it. A clear action must be explicit
and scoped; never clear every origin/user/board namespace as a side effect. If an export fails,
keep the data and let the user cancel. A retained copy remains account-scoped and is not opened
by a different signed-in user. Explain the device privacy implication of retaining local data.

Broadcast local sign-out/account-change notices to other tabs. Each receiving tab stops its
socket, releases or disables its edit session, clears authenticated query state, and respects
the preservation decision for its account namespace. BroadcastChannel is a notification channel,
not a graph update stream. Web Lock ownership still determines the sole writer and safe local
reset. A second tab never steals a held lock to clear another tab's pending work. The `/demo`
namespace and local demo data are not erased by authenticated sign-out.

## 11. Application updates and storage health

When a new service worker is installed and waiting, show an update prompt. Do not force
`skipWaiting`, `clientsClaim`, or a route reload while a user is editing, while an IndexedDB
transaction is in progress, or while unsynchronized work has not been safely preserved. A user
may apply an update after the current local transaction is complete and the active editor has a
safe transition: no pending outbox, or an explicit export/preserve decision if pending work can
survive the version transition. The update flow checks cache/schema compatibility before
activation and reopening; it never clears a namespace to make the new build start.

If an offline old client has a compatible cached shell, it continues using it. If that shell or
required worker assets are missing, show an explicit offline-unavailable state when any page can
still render; do not claim the editor is usable. If the server advertises an unsupported newer
schema when back online, stop graph writes, keep the outbox, and offer update/export. Version 1
supports schema version 1 only; a later schema needs a reviewed migration and old-client test
matrix before deployment.

Settings or a clear local-storage panel shows whether the current board has a local copy, when it
was cached, whether local writes are committed, the pending outbox count, and the browser's
reported storage usage/quota when available. These are diagnostic hints, not a durability
guarantee. On quota exhaustion or IndexedDB failure, pause editing, show “Storage error · export
your changes”, and offer an in-memory export. No “saved” label appears for an uncommitted edit.
If browser storage is later evicted, show missing-cache/unavailable state and retrieve from the
server only after authentication and connectivity return. Explain that local browser storage is
not a backup.

## 12. Security and failure matrix

| Scenario                                                   | Required Phase 5 behavior                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Offline direct editor refresh with cached shell and board  | Route and graph load; editing uses cached role and one writer                        |
| Offline direct editor refresh without board cache          | Shell loads, board unavailable; no invented graph or metadata                        |
| Offline dashboard                                          | Lists only current local account's cached boards, with age and incomplete-list label |
| API/WS/OAuth/invite request while service worker is active | No authenticated response or token enters a service-worker cache                     |
| Network loss during text edit                              | Local write/outbox commit continues; truthful offline label                          |
| Reconnect after independent remote edit                    | Full ready merges, queue drains, both supported edits survive                        |
| Revocation/viewer downgrade while offline                  | No queued write commits; local graph/outbox preserved; export offered                |
| Board archived while offline                               | Queue retained, board read-only; no upload until restored                            |
| IndexedDB or quota failure                                 | Editing pauses; no false saved state; in-memory export offered                       |
| Sign-out offline                                           | Local access stops; server invalidation visibly pending, retried before reuse        |
| Account switch with pending edits                          | Preservation choice shown; next account cannot see old cache                         |
| Two tabs on one cached board                               | One writer; sign-out notified; no lock stealing or second outbox                     |
| Waiting app version during editing                         | Prompt waits; no forced reload or outbox deletion                                    |
| New schema unsupported by cached app                       | Read-only/update/export state, data retained                                         |
| Browser evicts local data                                  | Unavailable state; never claim local backup exists                                   |

Security checks use synthetic accounts and graph content. Verify no cookies, OAuth codes,
authorization headers, invite tokens, database URLs, board payloads, or private metadata are
stored in service-worker caches, logs, evidence, or public bundles. Offline access is local access
to already downloaded data; revocation cannot remotely erase a device's copy.

## 13. Work breakdown

Tasks are completed in dependency order. Exact internal filenames may change, but each task has a
bounded owner, observable result, and evidence file.

| ID    | Task                                | Depends on          | Primary output                                                                | Completion evidence                                                         |
| ----- | ----------------------------------- | ------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| P5-01 | Offline shell and cache policy      | Phase 4             | Vite PWA/Workbox static precache, route fallback, excluded sensitive requests | Served production-build offline navigation and cache-inspection proof       |
| P5-02 | Account and board cache model       | P5-01               | Safe local account marker, timestamped boardCache access, unavailable states  | Namespace isolation and missing/evicted-cache browser cases                 |
| P5-03 | Offline dashboard                   | P5-02               | Cached-only `/boards` list/search/filter and disabled online actions          | Offline direct-route dashboard in production preview                        |
| P5-04 | Offline editor bootstrap            | P5-01, P5-02        | Cached document hydration, writer lock, local edit after refresh              | A06 full browser proof with committed bytes and app shell                   |
| P5-05 | Reconnect integration               | P5-04               | Session recovery, full-ready merge, ordered outbox drain, save status         | A07 with independent remote browser and zero pending queue                  |
| P5-06 | Access and schema recovery          | P5-05               | Downgrade/archive/revocation/session/schema freeze and export UX              | A10 combined server denial and served-browser preservation proof            |
| P5-07 | Sign-out and account switching      | P5-02, P5-06        | Pending offline invalidation, cross-tab notice, preservation choice           | A24 and session/account isolation in independent tabs                       |
| P5-08 | Safe application updates            | P5-01, P5-04, P5-07 | Waiting-worker prompt and compatible old-client handling                      | Update during pending edits preserves data; incompatible schema is explicit |
| P5-09 | Storage status and failure recovery | P5-04, P5-06        | Cache/storage status, quota/IDB failure pause and export                      | A22 served-browser fault, eviction and Web Lock fallback evidence           |
| P5-10 | End-to-end offline acceptance       | P5-03–P5-09         | A06/A07/A10/A22/A24/A25 matrix, security scan, measurements                   | Production preview with active SW and independent contexts passes           |
| P5-11 | Phase audit and handoff             | All prior tasks     | Final matrix, commands, dependency status, limitations                        | Every exit criterion linked to evidence or explicit blocker                 |

Phase 5 may reveal Phase 4 defects. Fix them at the owning boundary with focused evidence and
rerun affected Phase 4 checks. Do not move a collaboration failure into the service worker or
weaken the earlier acceptance test merely to make an offline demonstration pass.

## 14. Verification requirements

### 14.1 Static, cache, and build checks

- Frozen dependency installation, formatting, lint, strict types, unit/browser package tests,
  API/web/workspace builds, auth schema, migrations, and boundaries pass.
- The production build contains every local asset needed by the offline shell, including editor
  chunks, fonts, icons, and worker scripts. No essential runtime CDN dependency is introduced.
- The service worker's precache/navigation rules include supported app routes and exclude
  authenticated API, WS, OAuth callback, invite-token, and user-specific response caching.
- CSP and worker loading are compatible with the production build. Browser cache inspection
  confirms no protected response or secret-like value was stored.
- No second local graph store, blanket API cache, duplicate outbox, or service-worker graph write
  path is introduced. `/demo` remains isolated.

### 14.2 Acceptance evidence

Phase 5 completes these `plan.md` acceptance cases in service-worker-enabled production preview:

| Test | Phase 5 assertion                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| A06  | Disconnect, edit, wait for device-save label, close and reopen direct editor URL offline; shell and every locally committed edit load            |
| A07  | Another independent profile edits a different node; reconnect the offline profile; both edits survive and outbox reaches zero after durable ACKs |
| A10  | Revoke/downgrade an offline editor with pending bytes; on reconnect no queued write commits, editor freezes, export remains available            |
| A22  | Fail IndexedDB during a real edit; no saved label, further editing pauses, in-memory recovery export remains available                           |
| A24  | Switch accounts with pending edits; preservation choice is shown and the second account cannot enumerate or open the first account's cache       |
| A25  | Refresh direct editor/dashboard routes online and offline from a served production build; correct shell appears and no API response is cached    |

Retest A12 across two tabs after offline reload and sign-out notification. Retest Phase 4's
lost-ACK/outbox, access/archive, causal-gap, and save-label paths where Phase 5 changes their
lifecycle. A01–A05/A08–A09/A11/A13–A15/A23/A27/A30 remain relevant regressions; a Phase 5
browser script cannot replace their required server/database proofs. Phase 6–8 own comments,
presenter/checkpoints/import, and release-wide accessibility/performance/backup cases.

Use two independent authenticated browser contexts/profiles for A07/A10, real Better Auth
sessions, real PostgreSQL where a commit or denial is asserted, and a served production build
with an active service worker for A06/A25. Simulate true browser offline mode or a network cut
that leaves the local cache intact; a mocked React network flag is insufficient. Inspect actual
Cache Storage and IndexedDB before/after. Record URL, service-worker control state, browser
version, build hash, network condition, and result. Separate browser assertions from API/socket
and database assertions.

### 14.3 Account, upgrade, and recovery checks

- First visit offline, partially cached assets, missing board document, evicted IndexedDB,
  unavailable Web Locks, and cached role/viewer/archive cases have explicit states.
- Online sign-out invalidates the Better Auth session; offline sign-out says server invalidation
  is pending and blocks silent cookie-based reentry until the pending intent is resolved.
- Cross-tab account changes release editing safely without a second writer or a blanket delete.
- Pending outbox bytes and local graph survive worker update prompts, app reload cancellation,
  schema mismatch, access change, and export failure.
- A user-directed clear/reset affects only the selected account/board/schema namespace after
  warning and does not clear `/demo` or another account's data.
- Cached status is distinguishable from live server status in text and accessible announcements.

### 14.4 Evidence realism and inherited gates

The final audit reports PASS, FAIL, or UNRUN for each check. A headless/component test without an
active service worker is not A06/A25 proof. An API mock cannot establish a real session, server
revocation, durable ACK, or PostgreSQL sequence result. A synthetic network failure does not
prove the browser served a route offline unless the route was reloaded under offline conditions.
Use synthetic users and boards; never put cookies, OAuth codes, invitation tokens, database URLs,
raw private board updates, or full environment dumps in evidence.

Before declaring Phase 5 passed, rerun and report the Phase 4 gate or an exact follow-up that
resolves its OPEN blockers. At minimum, track the collaboration visibility miss, unapplied
configured migration, boundary violations, literal crash/lock-loss proofs, socket-level A23/A30,
combined A10, and served storage-error proof recorded in the Phase 4 audit. Resolve any still
binding Phase 4 failure under the governing plan; a Phase 5 document cannot waive it. Keep the
separate Phase 2 audit status honest as well.

## 15. Required verification commands

The repository should expose an aggregate `pnpm phase5:verify` with documented focused browser
and fault commands. Names below are intended interfaces; this document does not claim they exist
yet. The final audit records actual commands, child results, counts, durations, and environment.

```text
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:browser
pnpm test:integration
pnpm auth:schema:check
pnpm db:migration:show
pnpm --filter @archboard/sync-client test
pnpm --filter @archboard/api test:integration
pnpm --filter @archboard/web build
pnpm --filter @archboard/api build
pnpm build
pnpm boundary:check
pnpm phase1:verify
pnpm phase2:verify
pnpm phase3:verify
pnpm phase4:verify
pnpm phase5:verify
```

The Phase 5 aggregate must propagate failures, run a served production-build browser with active
service worker, exercise isolated real-database boundaries where needed, and perform cache
inspection. It does not replace a detailed report of its children. Prior-phase verifier results
do not erase open manual or performance findings in their audits.

## 16. Deliverables

Phase 5 is complete only when these deliverables agree:

1. Versioned PWA/Workbox static shell with tested direct-route offline fallback and safe request
   caching policy.
2. Explicit current-account boardCache model, cache age, offline dashboard, and missing-cache
   states.
3. Offline reload of a previously opened authenticated board with one writer, local Y.Doc
   hydration, and durable local update/outbox persistence.
4. Reconnect synchronization that preserves local pending bytes, merges server state, and reaches
   zero pending changes after durable ACKs.
5. Access/archive/session/schema recovery with frozen writes, preserved local graph, and export.
6. Online/offline sign-out, pending invalidation handling, cross-tab notice, and account-switch
   preservation/isolation.
7. Safe waiting-worker update prompt and old-client compatibility/recovery states.
8. Storage status, quota/IDB failure recovery, eviction state, and unavailable Web Locks fallback.
9. Real production-preview A06/A07/A10/A22/A24/A25 evidence with active service worker, plus
   relevant Phase 4/database regressions and cache security inspection.
10. Root Phase 5 verification command and updated local run/configuration guidance.
11. `docs/phase-5-offline.md` final audit and per-task evidence under `docs/evidence/phase5/`.

## 17. Exit gate

Phase 5 passes when:

- Every P5 task is complete and evidenced, with no required Phase 5 proof missing or failing.
- The served production build loads supported direct routes offline using the installed service
  worker and never stores authenticated API/WS/OAuth/invite responses in Cache Storage.
- A previously opened active board is editable offline only under its last known owner/editor
  role and the local writer lock; a never-cached board is clearly unavailable.
- A06 and A07 prove full offline reload and later convergence with a second authenticated user;
  outbox reaches zero only after server receipts.
- A10 proves revoked queued work is denied and preserved/exportable in a combined real browser,
  socket, and database flow.
- A22 proves failed local persistence pauses editing, offers recovery, and never claims saved.
- A24 proves sign-out/account-switch preservation and no cross-account cache disclosure.
- A25 proves production direct-route online/offline refresh and no accidental API caching.
- Update prompts, incompatible schema, storage eviction, unavailable Web Locks, and sign-out
  pending-invalidation states preserve local work and describe uncertainty accurately.
- Phase 4's required dependencies are no longer falsely reported as passed while failing or
  unrun; unresolved governing blockers keep the dependent Phase 5 completion claim open.
- Phase 2's independent open audit remains visible unless its own missing evidence and
  performance failure are resolved. The final audit makes no claim of Phase 6/7/8 completion or
  version 1 release readiness.

If a required proof fails, fix the owning implementation or propose a targeted contract
amendment with failed evidence and consequences. Do not mark a cached shell as a fully offline
product while authenticated board data, account separation, or recovery is unproven.

## 18. Handoff record

Each Phase 5 task report contains:

```text
Task: <P5-ID and title>
Implemented behavior: <observable result>
Changed files/modules: <owned scope>
Contracts used: <cache policy, namespace, role, outbox, save state, update/recovery rules>
Checks run: <exact commands>
Results: <PASS/FAIL/UNRUN with counts, browser/build, service-worker state>
Offline/browser evidence: <URL, build, active SW, network mode, reload, cache inspection>
Database/socket evidence: <real session, ACK/denial/sequence, or not applicable>
Security/account evidence: <cache exclusions, cross-account and sign-out results>
Storage/recovery evidence: <IDB fault, retained bytes, export/update result>
Known gaps: <honest unresolved items and inherited gate status>
Decision or amendment: <none, or link and rationale>
Next dependency unlocked: <task ID or phase exit>
```

The final audit links each exit criterion to a service-worker-controlled browser result, real
session/database/socket proof, package test, build, cache inspection, or explicit blocker. Record
runtime/browser/PostgreSQL versions, build hash, exact commands, test counts, timings, and
PASS/FAIL/UNRUN. A mocked login, synthetic offline flag, or stale earlier-phase result is labeled
as such and cannot satisfy a gate requiring a real boundary.
