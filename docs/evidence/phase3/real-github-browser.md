# Real GitHub and Chrome follow-up

Status: **PASS for the recorded Phase 3 provider/browser gate**, based on the user's interactive
Chrome observations and the API observations below. This follow-up occurred after P3-13 when the
user configured a development GitHub OAuth application. It does not change the historical P3-13
record of what was unrun at that commit.

## Configuration and run

- The ignored root `.env` contained nonempty GitHub client ID, client secret, Better Auth secret,
  pooled database URL, and direct database URL. Their values were not printed or committed.
- Effective local origins were `http://localhost:10000` for the API and
  `http://localhost:5173` for the web app. The user updated the GitHub callback to
  `http://localhost:10000/api/auth/callback/github`.
- `pnpm dev` started the API and Vite development server after sandbox access was granted.
  `/health/ready` and the web root both returned 200.
- The user completed real GitHub authorization in Chrome and reported that `/boards` loaded.
  After refresh it still loaded; sign-out returned to the landing page; direct `/boards` navigation
  after sign-out redirected to sign-in. The API's safe structured logs recorded `/api/v1/me` 200
  and `/api/v1/boards` 200 for the authenticated session. No callback URL, code, cookie, or user
  details were retained in this evidence.
- `pnpm --filter @archboard/web build --mode test` passed with local HTTP/WS origins. The built
  files were served through Vite preview at `http://localhost:5173/` with the real API. The user
  repeated GitHub sign-in in Chrome and reported `/boards` loaded after callback and refresh, then
  sign-out returned to the landing page. This second browser result is user-reported; a separate
  API request trace for that preview run was not captured.
- `node scripts/check-web-bundle.mjs` passed on 127 JS/CSS/HTML assets. A separate local scan
  checked those 127 text assets against the configured GitHub client ID and secret, Better Auth
  secret, and both database URLs without printing the values; it passed.
- The user reported that the spoken screen-reader check passed. The screen-reader product,
  version, and detailed path were not supplied, so this is a user-reported accessibility result,
  not an independently observed screen-reader transcript.
- Both local servers were stopped after the run. No functional source or dependency file changed.

## Limits

The Chrome version used for this interactive run was not captured. The previously recorded
Chrome 153.0.8010.53 version belongs to the P3-12 automated browser run and is not assigned to
this user-operated session. Expired-session handling remains covered by the existing API and
synthetic browser evidence; this live follow-up did not wait for an actual provider session to
expire. The separate [Phase 2 audit](../../phase-2-editor.md) remains open.
