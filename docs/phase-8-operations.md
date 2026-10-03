# Single-writer production operations

P8-07 implementation on `phase-8-release-hardening`. Release acceptance is **OPEN**.
The package has not been deployed or started against PostgreSQL. Database/process/
running-package proof is **UNRUN (deferred by user — until Version 1 implementation
is complete)**. Browser proof is **UNRUN (deferred by user)**. Native Caddy adaptation
and image builds are UNRUN: no running Docker daemon was available; the requested
adapter retry was interrupted. Compose parsing and source checks are separate proof.

## Package and configuration

`ops/compose.yaml` packages PostgreSQL, one Nest process and Caddy. Only Caddy publishes
ports (80/443); PostgreSQL has a persistent named volume and an internal network.
API storage is read-only with a bounded temporary mount. The process runs as `node`
under an init process; fixed container naming, replicas=1, a dedicated PostgreSQL
session advisory lock and runtime admission all enforce the single-writer contract.
Do not run PM2 cluster mode, multiple Nest workers, rolling replicas or a second
deployment against the same database. Validation workers remain internal threads.
The advisory key is database-wide, so separate test schemas do not isolate writers
from another deployment in the same database.

`ops/Dockerfile` pins Node `22.23.2-bookworm-slim`, pnpm `11.24.0`, and Caddy
`2.11.6-alpine`; Compose pins PostgreSQL `17.11-bookworm`. Installs use the committed
lockfile, production dependencies are installed separately, and compiled API/shared
packages/SQL/worker files and web assets are copied into their respective images.
No migration runs at normal startup, and schema synchronization stays disabled.
Tags are version pins, not digest guarantees: resolve and retain base/final image
digests at final image verification. Image availability and the frozen Docker build
remain unverified here. An immutable `ARCHBOARD_RELEASE` label must identify the
source commit; never overwrite an already verified release image with another build.

Copy `ops/production.env.example` to ignored `ops/production.env`. Set the actual
HTTPS hostname, source release label and GitHub OAuth client ID. Create the ignored
`ops/secrets` directory with these individual, one-line files:

| File                   | Meaning                                                                       |
| ---------------------- | ----------------------------------------------------------------------------- |
| `postgres_password`    | Local PostgreSQL account password                                             |
| `database_url`         | Runtime URL to database `archboard`, user `archboard`, host `postgres:5432`   |
| `database_direct_url`  | Direct session URL to that same database; no transaction-pooling intermediary |
| `better_auth_secret`   | Random stable secret of at least 32 characters                                |
| `github_client_secret` | GitHub OAuth application secret                                               |

Percent-encode credentials when assembling database URLs. Protect these files with
host permissions and backups appropriate for credentials; Compose file secrets
are mounted files, not an encrypted secret vault. Make them readable by the container
user, never world-writable. The loader rejects conflicting plaintext/file sources,
empty, oversized and multiline files. Configuration validates production credentials,
exact HTTPS origins and bounded pools. The build context excludes environment files,
secrets, private tooling state, auth storage state, logs, dumps and dependency outputs.
No secret belongs in `VITE_*`, build arguments, a public artifact or evidence.

Point DNS at the selected host and make 80/443 reachable for Caddy certificate
issuance. Set the GitHub OAuth homepage to the HTTPS origin and callback to
`https://<host>/api/auth/callback/github`. The package derives web/API/WS origins
from the same hostname (`https`, `https`, `wss`), preserving Better Auth handler
ownership, secure HttpOnly SameSite cookies, Origin validation and `/ws/boards/:id`
upgrades. DNS/OAuth setup and HTTPS issuance have not been performed in this task.

## Source checks and eventual start

Database-free commands from the repository root:

```text
node ops/generate-security-headers.mjs
node scripts/ops/check-package.mjs
node --test scripts/ops/package-policy.node.test.mjs
node scripts/ops/check-caddy.mjs
```

The first command generates the checked-in Caddy headers from the web policy. The
package checker invokes native Compose parsing using only the committed nonsecret
example. It does not start Docker services. The Caddy checker needs a Docker daemon
and the pinned Caddy image; it runs only `caddy adapt --validate` with no network and
no application/database. Its unavailable/interrupted result remains UNRUN, not PASS.

The following are future operator commands, **not executed in this handoff**:

```text
docker compose --env-file ops/production.env -f ops/compose.yaml build
docker compose --env-file ops/production.env -f ops/compose.yaml up -d postgres
docker compose --env-file ops/production.env -f ops/compose.yaml run --rm --no-deps api node ops/load-secrets.mjs migrate
docker compose --env-file ops/production.env -f ops/compose.yaml up -d api caddy
docker compose --env-file ops/production.env -f ops/compose.yaml stop api
```

Before the explicit migration command, verify the intended database identity, backup
and compatible migration plan with all API writers stopped. `migrate` uses only the
direct connection and forward checked-in migrations in one transaction. It is a
separate operator action, never an automatic repair. Changing an initialized volume's
password file does not rotate its PostgreSQL role password; coordinate actual role
rotation and both URL files. Do not delete volumes to fix readiness or credentials.

## Routing, headers and logs

Caddy forwards API/auth/WS/health paths before app rewrites, without prefix stripping
or mutation retries. Recognized root/demo/board/checkpoint routes serve the shell;
invitation routes are no-store. Missing API, auth, WS, health and assets retain errors
instead of serving HTML. Fingerprinted assets are immutable; ordinary shell responses
revalidate. Error responses are no-store. Generated HTTP headers supply the exact
production CSP, no-referrer, nosniff and HSTS. Review
[the security policy](phase-8-security-recovery.md) for scoped WASM/style/worker needs.
WebSocket forwarding and timeout syntax follow the
[Caddy reverse proxy reference](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
Compose singleton/secret controls follow the
[Compose services reference](https://docs.docker.com/reference/compose-file/services/).

Caddy has no access log, and its default diagnostic threshold is FATAL to suppress
proxy errors containing request URLs. PostgreSQL SQL/error statement logging is
disabled and its container log driver is `none`. API/framework logs emit safe fixed
events, booleans, counters, timings and allowlisted error codes; they omit exception
text, SQL, bodies, identities, cookies and tokens. API/Caddy container logs are size
bounded. This trades detailed proxy/SQL diagnostics for privacy: use status probes,
safe counters and explicit target-verified diagnostics during an incident. Do not
enable raw proxy/access/SQL logs as a shortcut. Verify synthetic token/body canaries
against actual container output at final package proof, retaining only safe counts.

## Readiness and lifecycle

`GET /health/live` is process-only and does no DB work. `/health/ready` succeeds only
with initialized DB access, dedicated writer ownership, current migration history,
all mapped product/auth tables and required column types/keys, and accepting admission.
Startup runs the same read-only compatibility check before opening the listener;
incompatible schemas terminate startup. Runtime checks never create migration tables
or apply migrations. Compatibility detects missing/current/newer histories and
mapped-column/key/auth-FK drift; it is not a substitute for migration/constraint
integration verification or proof that arbitrary schema changes are safe.

SIGTERM/SIGINT immediately stop admission and readiness. Product/auth HTTP requests
and WebSocket upgrades are refused; sockets close for reconnect. Shared product
transactions reject new work and count admitted work until runner release. Already
admitted transactions can commit during graceful drain, and readiness probes during
drain preserve that commit fence. Validation workers, upgrades, gateway tasks,
maintenance and transactions settle before rooms are disposed and application
shutdown releases the dedicated session lock. Existing commit-before-ACK uncertainty
is resolved by retrying the same update ID and exact bytes against retained receipts.
An uncommitted transaction never qualifies for ACK or broadcast.

Collaboration drain has a 20-second watchdog; complete process shutdown has a
25-second watchdog, inside Compose's 30-second stop grace. A stuck task terminates
the process while it still owns the lock, allowing PostgreSQL to roll back/release
the terminated session. It never unlocks beneath live admitted work. Unexpected
dedicated connection error/end or failed heartbeat immediately fences commits and
exits with status 1; ownership cannot reopen within that process. Restart must
reacquire ownership and pass schema compatibility before accepting requests.

| Signal                                                                            | Operator action                                                                                                            |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `runtime.admission` accepting=false / readiness 503                               | Check deployment/schema/ownership state using safe diagnostics; stop new traffic while unavailable                         |
| `runtime.writer_lost` / repeated startup fatal                                    | Check direct connection reachability, singleton contention and pooler mode; recover connectivity, then restart one process |
| `runtime.shutdown_started/complete` with duration / `shutdown_timeout`            | Wait for drain within the bounds; investigate stuck work after termination before restart                                  |
| `collaboration.admission_reject`, room/validation queue depth, validation timeout | Reduce request pressure and inspect bounded capacities; keep retry/export preservation available                           |
| `collaboration.db_write`, `ack` timings / update rejection codes                  | Compare DB and worker stages; retry durable uncertainty using the same ID/bytes                                            |
| `collaboration.compaction` duration/snapshot bytes                                | Investigate growing logs or slow compaction; preserve receipts and committed data                                          |
| Missing/failed daily backup signal                                                | Backup/schedule implementation belongs to P8-08; no successful schedule or recovery objective is claimed here              |

There is no paid monitoring service or public metrics endpoint. Aggregate the safe
events in the host's chosen protected monitoring sink and retain the verified release
identity with observations. Readiness status belongs to deployment health, never a
claim that every browser, restore or release acceptance requirement passed.

## Upgrade and rollback

Retain the previous source/image digests and protected configuration. Take and verify
a consistent backup under the P8-08 procedure, stop the sole API writer, inspect the
intended target and schema compatibility, apply only approved forward migrations,
then start the new single process. Test health, authenticated reopening, receipts and
direct routes against that exact release. Do not run old and new writers concurrently.

Rollback the image only when its expected migration history/schema remains compatible.
This runtime deliberately refuses unknown newer history. An incompatible migration
requires a reviewed forward fix or isolated verified restore; no automatic down
migration, production-volume replacement or browser cache reset is provided. Restoring
older state can roll back receipts and sessions while clients retain newer pending
bytes: preserve local work, review uncertain intents and follow the restore/retry
policy rather than relabeling local state as committed.

## Prepared final proof

Every database-dependent row remains **UNRUN (deferred by user — until Version 1
implementation is complete)**; browser rows remain **UNRUN (deferred by user)**.

| Command/source                                      | Setup and proof boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node apps/api/scripts/p8-07-process-proof.mjs`     | Linux and built API/packages; local disposable DB name ending `_test`, `P8_OPS_DATABASE_URL`, exact `P8_OPS_CONFIRM_DATABASE`, and `P8_RUN_DATABASE_PROOF=implementation-complete`. Creates/migrates a fresh random schema and synthetic authenticated owner/board, cleans only that schema. Dedicated advisory lock is DB-wide; reserve a database with no other Archboard process. Tests startup/refusal, duplicate process, pre/post-commit literal SIGKILL, reopened graph, receipt/sequence retry, peer delivery/no early ACK, idle/admitted SIGTERM, hung-task timeout, lock connection termination with an admitted transaction, schema refusal and restart. Credentials/child output are never persisted. |
| `node scripts/ops/host-proof.mjs`                   | Actual isolated HTTPS Caddy package, `P8_OPS_HOST_ORIGIN`, identical `P8_OPS_CONFIRM_ORIGIN`, same final-implementation flag; verifies headers, direct demo/board/checkpoint/invite routes, API/auth/WS/health/static error types, readiness and immutable assets. Does not prove authenticated WS forwarding or browser CSP execution.                                                                                                                                                                                                                                                                                                                                                                           |
| Actual image/package smoke and log-canary procedure | Build both images and record digests, verify runtime SQL/worker/nonroot/secret artifacts, start isolated package with synthetic data, run host proof, independently authenticate two clients and forward WSS through Caddy, exercise OAuth/cookies and scan API/Caddy output for synthetic canaries without retaining raw logs. Bind results to image digests and source.                                                                                                                                                                                                                                                                                                                                         |
| `node scripts/security/release-host.browser.mjs`    | Existing served production security harness after explicit browser resumption: actual CSP execution/referrer/cache/fallback and protected requests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

The IPC fault child wraps existing application failpoints only in a test process and
imports the actual compiled `main.js`. It is excluded from runtime images. No production
fault endpoint or environment switch was added. Unit doubles prove local fences and
timeouts only; the prepared literal process/DB/socket cases must establish their real
durability boundaries later.
