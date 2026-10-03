# Phase 8 security, privacy and recovery

P8-06 implementation map, 3 October 2026. Integrated A10/A11/A18/A22/A24/A25/A27
acceptance remains **OPEN** under the [verification policy](verification-policy.md).

## Authority and response boundaries

API production configuration now requires exactly one allowed web origin equal to
the HTTPS public API origin. Development/test may still use explicit separate
origins. Better Auth retains trusted-origin/CSRF checks, identity-only GitHub scopes,
and its session cookies; secure production, HttpOnly and SameSite=Lax attributes
are explicit. Auth wrapper and collaboration upgrade reject untrusted origins.
No new auth protocol, migration or role contract is introduced.

`configureProtectedResponses` runs before CORS, Better Auth and product parsing.
All `/api`, `/auth`, `/ws`, `/health` responses, including unknown paths, parser
failures, denials and redirects, get no-store, no-referrer and nosniff. Existing
explicit checkpoint/invite headers remain compatible. This is generic HTTP policy;
approved account-scoped IndexedDB graph/metadata/thread caching remains separate.

Existing `board-permissions`, `board-authority-transaction`, gateway protected
delivery guards, current-session lookups and local revocation events remain the
authority owners. Nonmembers receive scoped 404, insufficient known roles 403;
archived writes fail. Session reevaluation and presenter lease stay at 30 seconds.
In-memory permission/upgrade/gateway units support these rules; actual concurrent
DB reads/writes/fanout and secure cookies still require consolidated verification.

## Shell and host policy

`apps/web/security-policy.mjs` is the shared production policy and the P8-07 host
handoff. Vite injects its CSP into built HTML and applies headers to preview; no
preview was served here. Production connect-src is self only. Localhost HTTP/WS
ports are allowed only in the development policy. Bundled Shiki WASM needs
wasm-unsafe-eval; JavaScript eval is prohibited. React Flow geometry and Radix
positioning use inline styles. Images/export URLs allow data/blob; bundled workers
allow self/blob. Fonts/scripts remain local, object-src is none, base/form actions
are self. Frame-ancestors none belongs to the HTTP header, not the HTML meta policy.

P8-07 must consume these exact headers at Caddy and apply no-store/no-referrer to
invitations and all protected paths. SPA fallback may match only recognized app
routes; API/auth/WS/health and missing static files must retain their real status
and response type. The service worker has an explicit app navigation allowlist,
protected/health/assets deny rules and no runtime caching routes. This task does
not claim that Vercel configuration or a meta element proves the future Caddy host.

## Diagnostics and scans

The Nest `PrivacyLogger` drops arbitrary messages, objects, stacks and contexts,
retaining severity and a fixed event. Bootstrap rejection emits only a fatal event;
auth provider diagnostics accept fixed severity names and swallow sink failures.
Existing product request logs use route templates (unmatched for unknown paths),
not original URLs, queries or bodies. Collaboration diagnostics allow finite event
names, numeric measurements, the duplicate flag, published error codes and finite
failure kinds. Arbitrary labels, content, invalid measurements and event overrides
are omitted. Operational context comes from these safe structured metrics; driver
exception detail is intentionally unavailable in application logs.

**Proxy log contract for P8-07:** omit raw URI/query, request/response headers,
cookies, body, user identity and Referer from access/error logging. If route
information is retained, use an allowlisted route category, replacing invitation
paths with `/invite/:redacted` and omitting all query values. Do not log a raw path
and redact it only after writing. OAuth continuations and unknown URL paths are
sensitive too. Verify with synthetic invitation/auth requests and scan proxy output
in an isolated hosted run; no real token or credential fixture is permitted.

The public scan covers source, built assets, service workers and any `.map` files,
checks backend variable names, optionally supplied environment values and credential/
token patterns. The Phase 8 evidence scan checks credential/token patterns without
opening secret files. Synthetic tests also check comment/code/email canaries.
Scans emit counts only, never matching values, filenames or excerpts. These are
bounded detectors, not proof that arbitrary private prose is absent. Evidence
authors must still use numeric stages, fixed case IDs and sanitized summaries;
never commit raw exception dumps, browser profiles, traces or backup data.

## Pending work and late results

The existing writer/session/outbox owns exact pending IDs/bytes and account origin,
user, board and schema namespace. Temporary rate/queue errors preserve FIFO retry.
Storage failure retains the in-memory graph. Recovery download captures the whole
projection through the shared export package, without applying the 5 MiB import cap;
the existing download boolean/UI warns when the full artifact cannot be reimported.
Rejected updates and dependents are retained; clearing local state requires the
existing explicit warning/preservation choice. Checkpoint/create intent uncertainty
continues to require explicit identical-key retry, never reconnect submission.

P8-06 fences aborted session reads and expires pending switch/approval on session
loss and account notices. Earlier consent cannot bypass review of the old account's
pending work after a later boundary. Board access checks carry request-generation
guards through asynchronous bootstrap/cache work; a later denial, socket access
change, route cancellation or close prevents stale completion from restoring access
or resuming drain. None of these checks deletes the document or outbox.

Worker review now captures both account markers and the session boundary epoch.
After compatibility and pending-work reads, it rechecks the reviewed account/version.
Apply checks the boundary before preparation and immediately before activation;
the editor set must still match the prepared set. New editors during saving abort
handoff and restore prepared editors instead of closing/reloading them. Pending
IDs, namespaces, tab/schema compatibility and waiting-worker identity still have
their existing checks. Review failure leaves the current page/local data available.

## Recoverable prepared cases

All DB cases below are **UNRUN (deferred by user — until Version 1 implementation is complete)**.
All browser/manual cases are **UNRUN (deferred by user)**. Cases requiring both wait
for both conditions. Use isolated accounts/DB, independent contexts, same-origin
HTTPS P8-07 package and exact final build hashes. No current release PASS follows.

| Case                       | Prepared command or procedure                                                                                                                               | Required observation                                                                                                                                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SEC-HOST / A18,A25,A27     | `node scripts/security/release-host.browser.mjs`, `P8_WEB_ORIGIN=https://<isolated-host>`                                                                   | Exact served CSP/referrer/nosniff, protected no-store including denied/unknown paths, no HTML API/health/WS fallback, static 404, invite no-store, denied Origin, blocked external connect with no remote request            |
| SEC-AUTH / A11,A18,A27     | API Jest integration selection `me\|invites\|board-permissions\|discussion\|auth-websocket` under `jest.integration.config.cjs`                             | Real production cookie attributes, current roles/archive/session, nonmember scoping, denied writes/fanout including local revoke and 30-second reevaluation; no sequence/receipt/broadcast for rejects                       |
| SEC-INERT / A18            | `node scripts/p7-09-image-export.browser.mjs` and `node scripts/p7-11-portability-lifecycle.browser.mjs` with Phase 7 documented environment/state fixtures | Hostile graph/code/note text inert; actual import/file bytes, XML/PNG decode, no remote execution/fetch, allocation limits before canvas creation, URL/image/canvas cleanup on success/failure/cancel/unmount/account switch |
| REC-COMBINED / A10,A22,A24 | P7-11 offline original plus the reviewed procedure below, P5-08/P5-09 procedures and native writer tests after resumption                                   | Complete pending/in-memory bytes remain in original namespace across storage, access, account, tab and worker boundaries; no stale consent or cross-account upload                                                           |
| SEC-PROXY / A18            | P8-07 isolated synthetic auth/invite/unknown-route requests and scan access/error logs with synthetic body/email/code/token canaries                        | No sensitive URI/query/header/body/context reaches logs; counts-only review report                                                                                                                                           |

### Reviewed combined preservation procedure

For the missing `A10-A22-A24-recovery` row, record production/source hash, date,
reviewer, browser/OS, case IDs and parsed exported bytes/graph invariants. Begin with
P7-11's independent offline original and frozen checkpoint. Download baseline full
JSON; read exact pending update IDs/bytes and namespace through the test adapter.
Keep raw private snapshots outside evidence; use synthetic fixtures only.

1. While offline, edit graph and step text; reload and check complete content and
   unchanged queued IDs. Open a second tab: it remains read-only while the writer
   holds its lock. Verify the alternate tab does not create a second upload queue.
2. Inject IndexedDB write rejection/quota failure through the isolated browser test
   adapter, then edit again. The UI must show storage failure and retain complete
   in-memory content. Download recovery before navigation; compare the parsed graph,
   including that last unsaved edit. Do not reload away unsaved content to continue.
3. Independently downgrade/remove membership and archive the board from the owner
   context; deliver those events after retaining pending work. Attempt old writes,
   comments, presence and presenter fanout. Server rejects current unauthorized work,
   no protected content reaches removed peers, and local recovery remains complete.
4. Start delayed GET/file/creation results and a worker compatibility review. Sign
   out or switch accounts while they are pending; resolve them afterward. No old
   result, role, follow intent, switch approval or update consent becomes authority
   in the new namespace. Explicit old-account export/keep choice remains available.
   Recheck that the new account never uploads original queued IDs/bytes.
5. With another tab opening during saving, apply the reviewed worker update. It must
   remain waiting, leave the page open and preserve bytes. Repeat with same-account
   logout/relogin between review and apply: prior consent expires despite equal
   account ID. Supported stable handoff preserves exact pending IDs on reload;
   unsupported schema and other open tabs refuse activation.
6. Test eviction independently after exporting memory; loss is labeled truthfully,
   never reconstructed as an empty saved board. Repeat with a valid synthetic graph
   whose serialized JSON exceeds 5 MiB: export stays complete and warns about import
   capacity. Native browser durability, actual downloads and spoken feedback are
   required observations, not replaceable by Node serialization assertions.

For the missing `A18-host-and-image-limits` reviewed row, run SEC-HOST and SEC-INERT
on that same final host/build, then record header/network/file/allocation/cleanup
observations and reviewer/date. Both reviewed rows remain OPEN until performed.
The existing evidence validator must receive these structured reviewed observations
at P8-10/P8-12; a PASS sentence alone does not satisfy it.
