# Vercel and Render routing

The Vercel frontend proxies `/api/*` to the Render API. Browser HTTP requests
therefore use the frontend origin, including cookie-based sign-in. The compiled
Content Security Policy permits the exact API and WebSocket origins configured
at build time, without allowing arbitrary hosts.

## Deployment settings

Import only `apps/web` into Vercel with the Vite preset. Its `vercel.json` contains
the API proxy and application route rewrites. Set these production variables:

```dotenv
VITE_API_ORIGIN=https://archboard-one.vercel.app
VITE_WS_ORIGIN=wss://archboard-x3z3.onrender.com
```

On Render, set both `PUBLIC_API_ORIGIN` and `ALLOWED_WEB_ORIGINS` to
`https://archboard-one.vercel.app`. Keep database and authentication secrets on
Render. Configure the GitHub OAuth callback as
`https://archboard-one.vercel.app/api/auth/callback/github`.

Push these source changes and redeploy Vercel after changing its variables; Vite
embeds them and the CSP during the build. Redeploy Render after updating its
variables. If either hosting URL changes, update the variables and the Render
destination in `apps/web/vercel.json`.

## Scope and verification

This addresses HTTP routing and the reported CSP rejection. Direct Render
WebSockets still need authentication that works across the two hosting domains;
the existing cookie-based WebSocket authentication is not established by this
proxy. Do not treat live board synchronization as verified by these changes.

Focused security and packaging Node tests: PASS (8 tests). Invite acceptance
Node tests with `--experimental-vm-modules`: PASS (13 tests). Frontend type check:
PASS. Production frontend build including service worker generation: PASS.
Changed-file lint and diff whitespace check: PASS. Generated production
HTML CSP scan with the production variables above: PASS.

Browser checks: **UNRUN (deferred by user)**. Database-dependent checks:
**UNRUN (deferred by user — until Version 1 implementation is complete)**.
These focused checks do not close browser, database, or release acceptance gates.
